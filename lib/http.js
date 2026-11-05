/**
 * Same-origin JSON API used by the Web view. Only selected by sessionId; the
 * project root is resolved on the Host, so the browser never sends a path.
 *
 * Two carriers serve the same handler:
 * - `registerConnectionRoutes` mounts exact routes on DSH's shared `/api`
 *   Fetch channel. Both the Web carrier and a shell-owned carrier (the
 *   desktop `dsh-app://` window) dispatch that channel, so this is the
 *   portable path and needs no port, origin or injected token.
 * - `registerHttp` keeps the legacy `webServer` prefix route for hosts that
 *   predate the connection Fetch registry and for already-cached pages.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { act, getPeople, getState, getTask, getTimeline, getVersionInfo } from './service.js'
import { storeFor } from './store.js'
import { resolveProjectRoot, sessionCwdOf } from './project.js'
import { SKILL_SOURCE, SKILL_TARGETS, installSkills, isFirstRun, removeSkills, skillStatus } from './skills.js'
import { resolveActor } from './actor.js'
import { exportData, importFromFile } from './transfer.js'
import { TodoError } from './model.js'

const SESSION_QUERY = 'sessionId'
/** Shared DSH channel dispatched by every carrier; plugin routes sit below it. */
export const API_CHANNEL = '/api'

export function registerHttp(ctx, configOf, prefix, token) {
  const handler = createHandler(ctx, configOf, prefix, token)
  return ctx.webServer.register({ kind: 'prefix', path: prefix, handler })
}

/** Exact endpoints exposed on the shared channel, with their HTTP methods. */
const CONNECTION_ROUTES = [
  ['/health', ['GET']],
  ['/state', ['GET']],
  ['/task', ['GET']],
  ['/timeline', ['GET']],
  ['/people', ['GET']],
  ['/version', ['GET']],
  ['/export', ['GET']],
  ['/import', ['POST']],
  ['/action', ['POST']],
  ['/skills', ['GET', 'POST']],
]

/**
 * Mount the API on the shared `/api` Fetch channel so one code path works in a
 * browser tab (Web carrier) and in the desktop `dsh-app://` window (shell-owned
 * carrier), without depending on `webServer`, a port, or an injected token.
 * @param {object} ctx - plugin context carrying `connection`.
 * @param {(root: string) => object} configOf - per-project config resolver.
 * @param {string} prefix - legacy path prefix, now mounted below {@link API_CHANNEL}.
 * @param {string} token - launch token (the carrier already authenticates).
 * @returns {() => void} disposer for every route registered here.
 */
export function registerConnectionRoutes(ctx, configOf, prefix, token) {
  const handler = createHandler(ctx, configOf, prefix, token)
  const disposers = CONNECTION_ROUTES.map(([suffix, methods]) =>
    ctx.connection.fetch.register({
      path: `${API_CHANNEL}${prefix}${suffix}`,
      methods,
      requestBody: 'buffered',
      fetch: (request) => serveFetch(handler, prefix, suffix, request),
    }),
  )
  return () => {
    for (const dispose of disposers) {
      try {
        Promise.resolve(dispose()).catch(() => {})
      } catch {
        /* already disposed with the plugin context */
      }
    }
  }
}

/** Headers a Fetch response may carry from the shared handler. */
const RESPONSE_HEADERS = ['content-type', 'content-length', 'cache-control', 'content-disposition']

/** Adapt one Fetch request onto the existing node-style handler. */
async function serveFetch(handler, prefix, suffix, request) {
  const url = new URL(request.url, 'http://localhost')
  let body = null
  if (request.method === 'POST') body = Buffer.from(await request.arrayBuffer())
  try {
    const result = await callNodeHandler(handler, {
      method: request.method,
      url: `${prefix}${suffix}${url.search}`,
      headers: {
        ...Object.fromEntries(request.headers),
        'x-dsh-project-todo-client': '1',
      },
      body,
    })
    const headers = Object.fromEntries(
      RESPONSE_HEADERS.filter((name) => result.headers[name] !== undefined).map((name) => [name, String(result.headers[name])]),
    )
    return new Response(result.body, { status: result.status, headers })
  } catch (error) {
    return Response.json({ ok: false, code: 'IO_ERROR', message: error?.message || String(error) }, { status: 500 })
  }
}

/** Run the node-style handler with an in-memory request/response pair. */
function callNodeHandler(handler, { method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = new Readable({ read() {} })
    req.method = method
    req.url = url
    req.headers = headers
    req.socket = { remoteAddress: '127.0.0.1' }
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value
      },
      end(chunk) {
        const payload = chunk === undefined ? '' : chunk
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8'),
        })
      },
    }
    if (body && body.length) req.push(body)
    req.push(null)
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

export function injectToken(ctx, token) {
  return ctx.webServer.tapIndex((html) => {
    if (html.includes('__DSH_PROJECT_TODO_TOKEN__')) return html
    const tag = `<script>window.__DSH_PROJECT_TODO_TOKEN__=${JSON.stringify(token)}</script>`
    const at = html.indexOf('</head>')
    return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at)
  })
}

function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

function sendAttachment(res, { filename, contentType, data }) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
  res.statusCode = 200
  res.setHeader('content-type', contentType || 'application/octet-stream')
  res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', buffer.length)
  res.end(buffer)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 8 * 1024 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function resolveAgent(ctx, sessionId) {
  const agents = ctx.get('agents')
  if (!agents) {
    // The route is registered even without the session services: say why the
    // page cannot resolve a project instead of answering a bare 404 later.
    throw new TodoError(
      'NO_PROJECT',
      'Host 半边未就绪：agents 服务不可用（插件不在负责页面的进程/上下文里加载，或宿主仍在启动）；重启 DSH 后重试',
    )
  }
  if (!sessionId) throw new TodoError('NO_PROJECT', '缺少 sessionId')
  const agent = agents.get(sessionId)
  if (!agent) throw new TodoError('NO_PROJECT', '该会话未在运行，无法解析项目')
  return agent
}

/** Host-side diagnostics for the Web half; safe to call from any request. */
function hostHealth(ctx, prefix) {
  return {
    ok: true,
    version: pluginVersion(),
    prefix,
    services: {
      webServer: Boolean(ctx.get('webServer')),
      agents: Boolean(ctx.get('agents')),
      workingDirectory: Boolean(ctx.get('workingDirectory')),
    },
    hint:
      !ctx.get('agents')
        ? 'Host 半边缺少 agents 服务：待办页无法解析会话；重启 DSH 并确认插件行在 profile 的 dsh.profile.bundles 中'
        : !ctx.get('workingDirectory')
          ? 'workingDirectory 服务缺失，已回退到会话头记录的目录；如目录不对，请在会话里重新打开项目目录'
          : '',
  }
}

/** User home for skill installs; the env override exists for tests. */
function homeDir() {
  return process.env.DSH_PROJECT_TODO_HOME ? path.resolve(process.env.DSH_PROJECT_TODO_HOME) : os.homedir()
}

/** Plugin package version, for the health reply; '' when unreadable. */
function pluginVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || ''
  } catch {
    return ''
  }
}

/** Session working directory used to resolve the completion git version. */
function sessionCwd(ctx, agent) {
  return sessionCwdOf(ctx, agent.session)
}

function createHandler(ctx, configOf, prefix, token) {
  let origin = ''
  try {
    origin = ctx.webServer.getOrigin()
  } catch {
    /* listener not bound yet: token / sec-fetch-site still gate writes */
  }
  const authorized = (req) => {
    const presented = req.headers['x-dsh-project-todo-token']
    const sameOrigin = typeof req.headers.origin === 'string' && origin && req.headers.origin === origin
    const sameSite = req.headers['sec-fetch-site'] === 'same-origin'
    // A custom header cannot be attached by a cross-origin page without a
    // preflight, which this route never answers; it keeps the UI working
    // even when the index-injected token is unavailable (desktop shells).
    const sameClient = req.headers['x-dsh-project-todo-client'] === '1'
    return presented === token || sameOrigin || sameSite || sameClient
  }
  const actorFor = (agent) => {
    const cwd = sessionCwd(ctx, agent)
    const root = resolveProjectRoot(ctx, agent.session)
    return resolveActor({ root, cwd, env: process.env })
  }
  return async function handler(req, res) {
    try {
      if (!isLoopback(req)) {
        sendJson(res, 403, { ok: false, code: 'FORBIDDEN', message: '仅允许本机访问' })
        return
      }
      const url = new URL(req.url || '/', 'http://localhost')
      if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) {
        sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: `插件路由前缀应为 ${prefix}` })
        return
      }
      const sub = url.pathname.slice(prefix.length).replace(/^\/+/, '')
      if (sub === 'health' && req.method === 'GET') {
        sendJson(res, 200, hostHealth(ctx, prefix))
        return
      }
      if (sub === 'skills' && req.method === 'GET') {
        const agent = resolveAgent(ctx, url.searchParams.get(SESSION_QUERY))
        const root = resolveProjectRoot(ctx, agent.session)
        const targets = skillStatus(root, homeDir())
        sendJson(res, 200, { ok: true, action: 'skill_status', source: SKILL_SOURCE, firstRun: isFirstRun(targets), targets })
        return
      }
      if (sub === 'skills' && req.method === 'POST') {
        if (!authorized(req)) {
          sendJson(res, 403, { ok: false, code: 'FORBIDDEN', message: '面板令牌缺失，请刷新页面后重试' })
          return
        }
        const body = await readBody(req)
        const agent = resolveAgent(ctx, body.sessionId || url.searchParams.get(SESSION_QUERY))
        const root = resolveProjectRoot(ctx, agent.session)
        const names = Array.isArray(body.targets) && body.targets.length ? body.targets.map(String) : SKILL_TARGETS
        const unknown = names.filter((name) => !SKILL_TARGETS.includes(name))
        if (unknown.length) {
          sendJson(res, 200, { ok: false, code: 'INVALID', message: `未知技能目标：${unknown.join('、')}` })
          return
        }
        const removing = body.action === 'remove'
        const results = removing
          ? removeSkills(root, homeDir(), names)
          : installSkills(root, homeDir(), names, { force: body.force === true, copy: body.copy === true })
        sendJson(res, 200, {
          ok: true,
          action: removing ? 'skill_remove' : 'skill_install',
          source: SKILL_SOURCE,
          results,
        })
        return
      }
      if (sub === 'state' && req.method === 'GET') {
        const agent = resolveAgent(ctx, url.searchParams.get(SESSION_QUERY))
        const root = resolveProjectRoot(ctx, agent.session)
        const state = await getState(root, configOf(root), { cwd: sessionCwd(ctx, agent) })
        sendJson(res, 200, { ...state, actor: actorFor(agent) })
        return
      }
      if (sub === 'task' && req.method === 'GET') {
        const agent = resolveAgent(ctx, url.searchParams.get(SESSION_QUERY))
        const root = resolveProjectRoot(ctx, agent.session)
        sendJson(
          res,
          200,
          await getTask(root, configOf(root), String(url.searchParams.get('id') || ''), { cwd: sessionCwd(ctx, agent) }),
        )
        return
      }
      if (sub === 'timeline' && req.method === 'GET') {
        const agent = resolveAgent(ctx, url.searchParams.get(SESSION_QUERY))
        const root = resolveProjectRoot(ctx, agent.session)
        sendJson(
          res,
          200,
          await getTimeline(root, configOf(root), {
            scope: url.searchParams.get('scope') || 'project',
            tag: url.searchParams.get('tag') || undefined,
            taskId: url.searchParams.get('taskId') || undefined,
            q: url.searchParams.get('q') || undefined,
            type: url.searchParams.get('type') || undefined,
            limit: Number(url.searchParams.get('limit')) || 20,
          }),
        )
        return
      }
      if (sub === 'people' && req.method === 'GET') {
        const agent = resolveAgent(ctx, url.searchParams.get(SESSION_QUERY))
        const root = resolveProjectRoot(ctx, agent.session)
        const people = await getPeople(root, configOf(root), {
          person: actorFor(agent).person,
          cwd: sessionCwd(ctx, agent),
        })
        sendJson(res, 200, { ok: true, ...people })
        return
      }
      if (sub === 'version' && req.method === 'GET') {
        const agent = resolveAgent(ctx, url.searchParams.get(SESSION_QUERY))
        const root = resolveProjectRoot(ctx, agent.session)
        sendJson(res, 200, await getVersionInfo(root, configOf(root), { cwd: sessionCwd(ctx, agent) }))
        return
      }
      if (sub === 'export' && req.method === 'GET') {
        try {
          const agent = resolveAgent(ctx, url.searchParams.get(SESSION_QUERY))
          const root = resolveProjectRoot(ctx, agent.session)
          const scope = ['active', 'archive', 'all'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'active'
          const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'md'
          const state = await getState(root, configOf(root))
          sendAttachment(res, await exportData(state, scope, format, configOf(root)))
        } catch (error) {
          // A failed export must not look like a downloaded workbook. The
          // browser used to save this JSON body as `*.xlsx`.
          const code = error instanceof TodoError ? error.code : 'IO_ERROR'
          sendJson(res, 500, { ok: false, code, message: error.message || String(error) })
        }
        return
      }
      if (sub === 'import' && req.method === 'POST') {
        if (!authorized(req)) {
          sendJson(res, 403, { ok: false, code: 'FORBIDDEN', message: '面板令牌缺失，请刷新页面后重试' })
          return
        }
        const body = await readBody(req)
        const agent = resolveAgent(ctx, body.sessionId || url.searchParams.get(SESSION_QUERY))
        const root = resolveProjectRoot(ctx, agent.session)
        const format = body.format === 'xlsx' ? 'xlsx' : 'md'
        const data = Buffer.from(String(body.dataBase64 || ''), 'base64')
        if (!data.length) {
          sendJson(res, 200, { ok: false, code: 'INVALID', message: '导入内容为空' })
          return
        }
        const dir = path.join(root, '.dsh', 'imports')
        await mkdir(dir, { recursive: true })
        const safeName = `import-${Date.now()}.${format === 'xlsx' ? 'xlsx' : 'md'}`
        const file = path.join(dir, safeName)
        await writeFile(file, data)
        try {
          const result = await importFromFile(storeFor(root, configOf(root)), configOf(root), file, {
            format,
            dryRun: body.dryRun === true,
            by: agent.id,
          })
          sendJson(res, 200, { ok: true, ...result })
        } finally {
          await rm(file, { force: true }).catch(() => {})
        }
        return
      }
      if (sub === 'action' && req.method === 'POST') {
        if (!authorized(req)) {
          sendJson(res, 403, { ok: false, code: 'FORBIDDEN', message: '面板令牌缺失，请刷新页面后重试' })
          return
        }
        const body = await readBody(req)
        const agent = resolveAgent(ctx, body.sessionId || url.searchParams.get(SESSION_QUERY))
        const root = resolveProjectRoot(ctx, agent.session)
        const actor = body.by || actorFor(agent).actor
        sendJson(res, 200, await act(root, configOf(root), { ...body, by: actor }, actor, { cwd: sessionCwd(ctx, agent) }))
        return
      }
      sendJson(res, 404, {
        ok: false,
        code: 'NOT_FOUND',
        message: `未知接口 ${url.pathname}；可用：health/state/task/timeline/people/version/export/import/action`,
      })
    } catch (error) {
      const code = error instanceof TodoError ? error.code : 'IO_ERROR'
      sendJson(res, error instanceof TodoError ? 200 : 500, { ok: false, code, message: error.message || String(error) })
    }
  }
}
