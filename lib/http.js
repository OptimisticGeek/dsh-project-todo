/**
 * Same-origin JSON API used by the Web view. Only selected by sessionId; the
 * project root is resolved on the Host, so the browser never sends a path.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { act, getPeople, getState, getTask, getTimeline, getVersionInfo } from './service.js'
import { storeFor } from './store.js'
import { resolveProjectRoot } from './project.js'
import { resolveActor } from './actor.js'
import { exportData, importFromFile } from './transfer.js'
import { TodoError } from './model.js'

const SESSION_QUERY = 'sessionId'

export function registerHttp(ctx, configOf, prefix, token) {
  const handler = createHandler(ctx, configOf, prefix, token)
  return ctx.webServer.register({ kind: 'prefix', path: prefix, handler })
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
  if (!agents) throw new TodoError('NO_PROJECT', 'agents 服务不可用')
  if (!sessionId) throw new TodoError('NO_PROJECT', '缺少 sessionId')
  const agent = agents.get(sessionId)
  if (!agent) throw new TodoError('NO_PROJECT', '该会话未在运行，无法解析项目')
  return agent
}

/** Session working directory used to resolve the completion git version. */
function sessionCwd(ctx, agent) {
  try {
    const workingDirectory = ctx.get('workingDirectory')
    return workingDirectory ? workingDirectory.get(agent.session) || '' : ''
  } catch {
    return ''
  }
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
        sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: 'not found' })
        return
      }
      const sub = url.pathname.slice(prefix.length).replace(/^\/+/, '')
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
        const agent = resolveAgent(ctx, url.searchParams.get(SESSION_QUERY))
        const root = resolveProjectRoot(ctx, agent.session)
        const scope = ['active', 'archive', 'all'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'active'
        const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'md'
        const state = await getState(root, configOf(root))
        sendAttachment(res, await exportData(state, scope, format, configOf(root)))
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
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: 'not found' })
    } catch (error) {
      const code = error instanceof TodoError ? error.code : 'IO_ERROR'
      sendJson(res, error instanceof TodoError ? 200 : 500, { ok: false, code, message: error.message || String(error) })
    }
  }
}
