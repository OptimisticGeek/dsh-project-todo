import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply } from '../index.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Cordis-shaped context that records injection, effects and warnings. */
function mockCtx() {
  const injections = []
  const effects = []
  const warnings = []
  const systemPrompt = { section: () => () => {}, context: () => () => {} }
  const ctx = {
    inject: (services, callback) => {
      injections.push(services)
      if (typeof callback === 'function') callback(ctx)
    },
    on: () => {},
    effect: (factory) => {
      effects.push(factory)
      return () => {}
    },
    get: (name) => (name === 'systemPrompt' ? systemPrompt : undefined),
    logger: { warn: (message) => warnings.push(message) },
  }
  ctx.systemPrompt = systemPrompt
  return { ctx, injections, effects, warnings }
}

test('the Web half needs the shared connection channel and, optionally, webServer', () => {
  const { ctx, injections, effects, warnings } = mockCtx()
  apply(ctx, {})

  const connectionInjections = injections.filter((services) => services.includes('connection'))
  assert.equal(connectionInjections.length, 1)
  assert.deepEqual(connectionInjections[0], ['connection'])
  const webInjections = injections.filter((services) => services.includes('webServer'))
  assert.equal(webInjections.length, 1)
  assert.deepEqual(webInjections[0], ['webServer'])
  assert.ok(!injections.some((services) => services.includes('agents')))
  assert.ok(!injections.some((services) => services.includes('workingDirectory')))
  assert.ok(!injections.some((services) => services.includes('tools')))

  // connection routes + legacy route + token + system prompt + root dispose
  assert.equal(effects.length, 5)
  for (const factory of effects) assert.equal(typeof factory(), 'function')
  // No carrier here, so every registration warns instead of throwing.
  assert.ok(warnings.some((message) => message.includes('/api')))
  assert.ok(warnings.some((message) => message.includes('面板令牌')))
})

test('the portable route is mounted on /api as soon as connection exists', () => {
  const webRoutes = []
  const fetchRoutes = []
  const { ctx, effects } = mockCtx()
  ctx.webServer = {
    register: (route) => {
      webRoutes.push(route)
      return () => {}
    },
    tapIndex: () => () => {},
    getOrigin: () => 'http://127.0.0.1:1',
  }
  ctx.connection = {
    fetch: {
      register: (route) => {
        fetchRoutes.push(route)
        return async () => {}
      },
    },
  }
  apply(ctx, {})
  for (const factory of effects) factory()
  assert.equal(webRoutes.length, 1)
  assert.deepEqual({ kind: webRoutes[0].kind, path: webRoutes[0].path }, { kind: 'prefix', path: '/dsh-project-todo' })
  assert.equal(fetchRoutes.length, 9)
  assert.ok(fetchRoutes.every((route) => route.path.startsWith('/api/dsh-project-todo/')))
  assert.ok(fetchRoutes.some((route) => route.path === '/api/dsh-project-todo/state'))
})

test('ui.enabled=false warns and mounts no Web route', () => {
  const { ctx, injections, warnings } = mockCtx()
  apply(ctx, { ui: { enabled: false } })
  assert.ok(!injections.some((services) => services.includes('webServer')))
  assert.ok(!injections.some((services) => services.includes('connection')))
  assert.ok(warnings.some((message) => message.includes('ui.enabled=false')))
})

test('plugin no longer registers model-facing ptodo_* tools', () => {
  assert.equal(existsSync(new URL('../lib/tools.js', import.meta.url)), false)
  const entry = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.doesNotMatch(entry, /buildTools/)
  assert.doesNotMatch(entry, /ctx\.inject\(\['tools'/)
  assert.match(entry, /ptodo status/)
  assert.match(entry, /ptodo continue/)
})

test('package exposes one global ptodo bin and ships the skill', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.deepEqual(pkg.bin, { ptodo: './bin/ptodo.mjs' })
  assert.ok(existsSync(new URL('../bin/ptodo.mjs', import.meta.url)))
  assert.ok(existsSync(new URL('../skill/project-todo/SKILL.md', import.meta.url)))
  assert.ok(ROOT)
})
