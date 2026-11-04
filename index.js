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
  '里程碑下最后一个任务完成时（done 返回 milestone.complete=true），先询问用户是否归档，确认后再执行 ptodo admin archive-batch --milestone <M-x>。' +
  '禁止手改数据、禁止维护第二份待办。' +
  '用户说「继续开发」「继续开发待办」且无上下文时，先 ptodo task ready --limit 3，再 ptodo task start <id>。' +
  '（兼容旧口令：ptodo status / ptodo continue。）'

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
    ctx.inject(['webServer', 'agents', 'workingDirectory'], (scoped) => {
      scoped.effect(() => registerHttp(scoped, configOf, HTTP_PREFIX, token))
      scoped.effect(() => injectToken(scoped, token))
    })
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
