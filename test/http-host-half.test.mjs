import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHttp } from '../lib/http.js'

/** Minimal Web carrier: one registered prefix route and its handler. */
function fakeServer() {
  const routes = []
  return {
    routes,
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
      getOrigin: () => 'http://127.0.0.1:1',
      tapIndex: () => () => {},
    },
  }
}

function fakeReq(url, method = 'GET') {
  return { url, method, socket: { remoteAddress: '127.0.0.1' }, headers: {} }
}

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '' }
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value
  }
  res.end = (body) => {
    res.body = body || ''
  }
  return res
}

/** Route handler for a context that has the carrier but no session services. */
function mount(services = {}) {
  const server = fakeServer()
  const ctx = { webServer: server.webServer, get: (name) => services[name] }
  registerHttp(ctx, () => ({}), '/dsh-project-todo', 'tok')
  assert.equal(server.routes.length, 1)
  assert.equal(server.routes[0].kind, 'prefix')
  return { server, ctx, handler: server.routes[0].handler }
}

test('health reports the Host-half services instead of failing', async () => {
  const { handler } = mount()
  const res = fakeRes()
  await handler(fakeReq('/dsh-project-todo/health'), res)
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.prefix, '/dsh-project-todo')
  assert.match(body.version, /^\d+\.\d+\.\d+/)
  assert.deepEqual(body.services, { webServer: false, agents: false, workingDirectory: false })
  assert.match(body.hint, /Host 半边缺少会话服务/)
})

test('health turns green once the session services exist', async () => {
  const { handler } = mount({ webServer: {}, agents: {}, workingDirectory: {} })
  const res = fakeRes()
  await handler(fakeReq('/dsh-project-todo/health'), res)
  const body = JSON.parse(res.body)
  assert.deepEqual(body.services, { webServer: true, agents: true, workingDirectory: true })
  assert.equal(body.hint, '')
})

test('state without the agents service answers an actionable NO_PROJECT, not a bare 404', async () => {
  const { handler } = mount()
  const res = fakeRes()
  await handler(fakeReq('/dsh-project-todo/state?sessionId=abc'), res)
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'NO_PROJECT')
  assert.match(body.message, /agents/)
  assert.match(body.message, /重启 DSH/)
})

test('an unknown subpath answers JSON naming the known endpoints', async () => {
  const { handler } = mount()
  const res = fakeRes()
  await handler(fakeReq('/dsh-project-todo/nope'), res)
  assert.equal(res.statusCode, 404)
  const body = JSON.parse(res.body)
  assert.equal(body.code, 'NOT_FOUND')
  assert.match(body.message, /health\/state/)
})

test('a request from another host is refused instead of resolved', async () => {
  const { handler } = mount()
  const res = fakeRes()
  await handler({ ...fakeReq('/dsh-project-todo/state'), socket: { remoteAddress: '10.0.0.7' } }, res)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).code, 'FORBIDDEN')
})
