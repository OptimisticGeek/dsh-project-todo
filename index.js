/**
 * Host entry of `@local/dsh-project-todo`.
 *
 * Model-facing tools were removed on purpose: the one command surface is the
 * global `ptodo` CLI shipped by this same package. The plugin keeps the Web
 * view, the per-session project resolution and two short prompt injections so
 * an agent that never loaded the skill still knows where the board lives.
 */
import { randomBytes } from 'node:crypto'
import { injectToken, registerHttp } from './lib/http.js'
import { resolveProjectRoot } from './lib/project.js'
import { storeFor } from './lib/store.js'
import { orgStoreFor } from './lib/org.js'
import { tagStoreFor } from './lib/tags.js'
import { decorateState } from './lib/derive.js'
import { formatAgentSummary } from './lib/format.js'
import { configFor, normalizeConfig } from './lib/config.js'

export const name = 'project-todo'
const HTTP_PREFIX = '/dsh-project-todo'

const POLICY_TEXT =
  '项目待办唯一入口：终端 ptodo（数据 docs/ptodo/todos.json，页面同源）。' +
  '任何开发任务开工先 ptodo task ready 或 ptodo task start <id>；' +
  '完成 ptodo task done <id> --evidence；阻塞 ptodo task block <id> --reason；交接 ptodo task release <id> --note。' +
  '里程碑下最后一个任务完成时（done 返回 milestone.complete=true 且 archivable=true），先询问用户是否归档，确认后再执行 ptodo admin archive-batch --milestone <M-x>。' +
  '默认里程碑（code=default，收件箱）不参与归档：complete 只表示全做完了，不要问归档、不要执行 archive-batch。' +
  '禁止手改数据、禁止维护第二份待办。' +
  '用户说「继续开发」「继续开发待办」且无上下文时，先 ptodo task ready --limit 3，再 ptodo task start <id>。' +
  '（兼容旧口令：ptodo status / ptodo continue。）'

/**
 * Run one Web-half effect, keeping a readable reason in the host log instead of
 * letting the host half fail silently while the client half keeps the tab.
 * @param {object} ctx - scoped plugin context (needs `logger.warn`).
 * @param {string} action - what was being registered, for the message.
 * @param {() => Function} run - effect body returning its disposer.
 * @returns {Function} the effect disposer, or a no-op.
 */
function guarded(ctx, action, run) {
  try {
    return run()
  } catch (error) {
    ctx.logger?.warn?.(`project-todo: ${action}失败：${error?.message || error}；待办页接口会返回 404`)
    return () => {}
  }
}

/** Short summary for one agent's prompt context. */
function agentTodoText(ctx, configOf, agent) {
  try {
    const root = resolveProjectRoot(ctx, agent.session)
    const config = configOf(root)
    const store = storeFor(root, config)
    const board = store.readSync()
    if (!board || !board.tasks.length) return ''
    const archive = store.readArchiveSync()
    const org = orgStoreFor(root, config).readSync()
    const tags = tagStoreFor(root, config).readSync()
    const decorated = decorateState({ board, archive, org, tags, commitExists: () => false })
    const ready = decorated.board.tasks.filter((task) => task.isReady)
    const text = formatAgentSummary(decorated.board, 2, { ready })
    return text.length > 400 ? `${text.slice(0, 400)}…` : text
  } catch {
    return ''
  }
}

/**
 * @param {object} ctx - plugin context.
 * @param {object} rawConfig - the row's config.
 */
export function apply(ctx, rawConfig) {
  const base = normalizeConfig(rawConfig)
  const configOf = (root) => configFor(root, rawConfig)
  const token = randomBytes(16).toString('hex')
  const agentScopes = new Map()

  if (base.ui.enabled) {
    // Only the HTTP carrier is required to register the route: `agents` and
    // `workingDirectory` are read per request, so a late (or absent) session
    // service produces an actionable API error instead of the Web server's
    // bare 404 — the client half renders the tab either way.
    ctx.inject(['webServer'], (scoped) => {
      scoped.effect(() => guarded(scoped, `注册 ${HTTP_PREFIX} 路由`, () => registerHttp(scoped, configOf, HTTP_PREFIX, token)))
      scoped.effect(() => guarded(scoped, '注入面板令牌', () => injectToken(scoped, token)))
    })
  } else {
    // The Web half is off by config, so the tab would answer 404 forever.
    ctx.logger?.warn?.(
      'project-todo: ui.enabled=false，未注册 Web 路由，待办页接口会返回 404；删除该配置或设为 true 后重启 DSH',
    )
  }

  ctx.inject(['systemPrompt'], (scoped) => {
    scoped.effect(() =>
      scoped.systemPrompt.section({
        name: 'project-todo',
        order: 950,
        text: POLICY_TEXT,
      }),
    )
  })

  ctx.on('agent/created', (payload) => {
    const agent = payload && payload.agent
    if (!agent) return
    if (payload.source === 'compact') return
    try {
      const disposer = agent.ctx.effect(() => {
        const systemPrompt = agent.ctx.get('systemPrompt')
        if (!systemPrompt) return () => {}
        return systemPrompt.context({
          name: 'project-todo',
          order: 950,
          text: () => agentTodoText(ctx, configOf, agent),
        })
      })
      agentScopes.set(agent.id, disposer)
    } catch (error) {
      ctx.logger?.warn?.(`project-todo: 无法注册会话上下文：${error.message}`)
    }
  })

  ctx.on('agent/disposed', (payload) => {
    const agent = payload && payload.agent
    if (agent) agentScopes.delete(agent.id)
  })

  ctx.effect(() => () => {
    for (const disposer of agentScopes.values()) {
      try {
        disposer()
      } catch {
        /* already disposed with the agent */
      }
    }
    agentScopes.clear()
  })
}
