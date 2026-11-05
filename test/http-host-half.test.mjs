import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { API_CHANNEL, registerConnectionRoutes } from '../lib/http.js'
import { normalizeConfig } from '../lib/config.js'

/**
 * Mount the portable API on a fake shared Fetch registry. The handler resolves
 * `agents` / `workingDirectory` per request, so a missing service is a normal
 * case here, not a crash.
 */
function mount(services = {}) {
  const routes = new Map()
  const ctx = {
    get: (name) => services[name],
    connection: {
      fetch: {
        register: (route) => {
          routes.set(route.path, route)
          return async () => {}
        },
      },
    },
  }
  registerConnectionRoutes(ctx, () => normalizeConfig({}), '/dsh-project-todo', 'tok')
  return { routes, ctx }
}

const get = (routes, path) => routes.get(API_CHANNEL + '/dsh-project-todo' + path)

test('every endpoint is mounted as an exact route on the shared /api channel', () => {
  const { routes } = mount()
  const expected = ['/health', '/state', '/task', '/timeline', '/people', '/version', '/export', '/import', '/action', '/skills']
  assert.deepEqual(
    [...routes.keys()].sort(),
    expected.map((suffix) => `${API_CHANNEL}/dsh-project-todo${suffix}`).sort(),
  )
  assert.deepEqual(get(routes, '/action').methods, ['POST'])
  assert.deepEqual(get(routes, '/state').methods, ['GET'])
  assert.equal(get(routes, '/state').requestBody, 'buffered')
})

test('health reports the Host-half services through the Fetch channel', async () => {
  const { routes } = mount()
  const response = await get(routes, '/health').fetch(new Request('http://localhost/api/dsh-project-todo/health'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.match(body.version, /^\d+\.\d+\.\d+/)
  assert.deepEqual(body.services, { webServer: false, agents: false, workingDirectory: false })
  assert.match(body.hint, /缺少 agents 服务/)
})

test('a missing workingDirectory is survivable and reported as a fallback', async () => {
  const { routes } = mount({ agents: {} })
  const response = await get(routes, '/health').fetch(new Request('http://localhost/api/dsh-project-todo/health'))
  const body = await response.json()
  assert.deepEqual(body.services, { webServer: false, agents: true, workingDirectory: false })
  assert.match(body.hint, /回退到会话头/)
})

test('state resolves the project from the Session header when workingDirectory is absent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-http-root-'))
  try {
    const agent = { id: 'session-x', session: { id: 'session-x', header: { cwd: root } } }
    const { routes } = mount({ agents: { get: () => agent } })
    const response = await get(routes, '/state').fetch(
      new Request('http://localhost/api/dsh-project-todo/state?sessionId=session-x'),
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(path.resolve(body.root), path.resolve(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('health turns green once the session services exist', async () => {
  const { routes } = mount({ webServer: {}, agents: {}, workingDirectory: {} })
  const response = await get(routes, '/health').fetch(new Request('http://localhost/api/dsh-project-todo/health'))
  const body = await response.json()
  assert.deepEqual(body.services, { webServer: true, agents: true, workingDirectory: true })
  assert.equal(body.hint, '')
})

test('state without the agents service answers a readable NO_PROJECT, not a 404', async () => {
  const { routes } = mount()
  const response = await get(routes, '/state').fetch(
    new Request('http://localhost/api/dsh-project-todo/state?sessionId=abc'),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'NO_PROJECT')
  assert.match(body.message, /agents/)
})

test('POST action parses a JSON body from the Fetch request', async () => {
  const { routes } = mount()
  const response = await get(routes, '/action').fetch(
    new Request('http://localhost/api/dsh-project-todo/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'abc', kind: 'claim' }),
    }),
  )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.code, 'NO_PROJECT')
})

test('skills status and one-click install are served on the shared channel', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'ptodo-skills-http-'))
  const home = path.join(base, 'home')
  const previous = process.env.DSH_PROJECT_TODO_HOME
  process.env.DSH_PROJECT_TODO_HOME = home
  try {
    await mkdir(path.join(home, '.claude'), { recursive: true })
    const agent = { id: 'session-x', session: { id: 'session-x', header: { cwd: base } } }
    const { routes } = mount({ agents: { get: () => agent } })

    const status = await get(routes, '/skills').fetch(
      new Request('http://localhost/api/dsh-project-todo/skills?sessionId=session-x'),
    )
    assert.equal(status.status, 200)
    const before = await status.json()
    assert.equal(before.ok, true)
    assert.equal(before.firstRun, true, 'detected tool + nothing installed means first run')
    assert.equal(before.targets.find((row) => row.name === 'claude').detected, true)

    const install = await get(routes, '/skills').fetch(
      new Request('http://localhost/api/dsh-project-todo/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'session-x', action: 'install', targets: ['claude'] }),
      }),
    )
    const after = await install.json()
    assert.equal(after.ok, true)
    assert.equal(after.results[0].state, 'linked')
    assert.ok(existsSync(path.join(home, '.claude', 'skills', 'project-todo', 'SKILL.md')))
  } finally {
    if (previous === undefined) delete process.env.DSH_PROJECT_TODO_HOME
    else process.env.DSH_PROJECT_TODO_HOME = previous
    await rm(base, { recursive: true, force: true })
  }
})

test('an unregistered path is not claimed by this plugin', () => {
  const { routes } = mount()
  assert.equal(routes.has('/api/dsh-project-todo/nope'), false)
  assert.equal(routes.has('/dsh-project-todo/state'), false)
})
