/**
 * Host entry of `dsh-project-task`.
 *
 * Model-facing tools are intentionally absent: the command surface is the
 * global `ptask` CLI shipped by this package. The plugin keeps the Web view,
 * per-session project resolution, and one short dynamic summary so an agent
 * that never loaded the skill still knows a board exists.
 *
 * The summary is deliberately cheap: it reads only the active board (no
 * archive, org or tags), skips sub-agents, and is bounded to 160 characters.
 */
import { randomBytes } from 'node:crypto'
import { API_CHANNEL, injectToken, registerConnectionRoutes, registerHttp } from './lib/http.js'
import { resolveProjectRoot } from './lib/project.js'
import { storeFor } from './lib/store.js'
import { counts } from './lib/model.js'
import { renderSummary } from './lib/view.js'
import { configFor, normalizeConfig } from './lib/config.js'

export const name = 'dsh-project-task'
const HTTP_PREFIX = '/dsh-project-task'

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
    ctx.logger?.warn?.(`${name}: ${action}失败：${error?.message || error}；任务页接口会返回 404`)
    return () => {}
  }
}

/** True when this agent is a delegated sub-agent rather than the root session. */
function isSubagent(agent) {
  const header = agent?.session?.header
  if (!header) return false
  return header.origin === 'subagent' || Boolean(header.parentSession) || Number(header.delegationDepth || 0) > 0
}

/** Short summary for one root agent's prompt context. */
function agentTodoText(ctx, configOf, agent) {
  if (isSubagent(agent)) return ''
  try {
    const root = resolveProjectRoot(ctx, agent.session)
    const config = configOf(root)
    const board = storeFor(root, config).readSync()
    if (!board || !board.tasks.length) return ''
    return renderSummary({ board, counts: counts(board) }, { limit: 1, maxChars: 160 })
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
    // Portable path: exact Fetch routes on DSH's shared /api channel. A
    // shell-owned carrier (the desktop `dsh-app://` window) dispatches that
    // channel too, so the page needs no webServer port, origin or injected
    // token — only the client half's relative fetch below /api.
    ctx.inject(['connection'], (scoped) => {
      scoped.effect(() =>
        guarded(scoped, `注册 ${API_CHANNEL}${HTTP_PREFIX} 接口`, () =>
          registerConnectionRoutes(scoped, configOf, HTTP_PREFIX, token),
        ),
      )
    })

    // Legacy Web-carrier route: keeps an already-cached page and hosts that
    // predate the connection Fetch registry working when webServer exists.
    ctx.inject(['webServer'], (scoped) => {
      scoped.effect(() => guarded(scoped, `注册 ${HTTP_PREFIX} 路由`, () => registerHttp(scoped, configOf, HTTP_PREFIX, token)))
      scoped.effect(() => guarded(scoped, '注入面板令牌', () => injectToken(scoped, token)))
    })
  } else {
    // The Web half is off by config, so the tab would answer 404 forever.
    ctx.logger?.warn?.(
      `${name}: ui.enabled=false，未注册 Web 路由，任务页接口会返回 404；删除该配置或设为 true 后重启 DSH`,
    )
  }

  ctx.on('agent/created', (payload) => {
    const agent = payload && payload.agent
    if (!agent) return
    if (payload.source === 'compact') return
    if (isSubagent(agent)) return
    try {
      const disposer = agent.ctx.effect(() => {
        const systemPrompt = agent.ctx.get('systemPrompt')
        if (!systemPrompt) return () => {}
        return systemPrompt.context({
          name,
          order: 950,
          text: () => agentTodoText(ctx, configOf, agent),
        })
      })
      agentScopes.set(agent.id, disposer)
    } catch (error) {
      ctx.logger?.warn?.(`${name}: 无法注册会话上下文：${error.message}`)
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
