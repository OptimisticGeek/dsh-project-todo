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

test('the Web half requires only the webServer carrier', () => {
  const { ctx, injections, effects, warnings } = mockCtx()
  apply(ctx, {})

  const webInjections = injections.filter((services) => services.includes('webServer'))
  assert.equal(webInjections.length, 1)
  assert.deepEqual(webInjections[0], ['webServer'])
  assert.ok(!injections.some((services) => services.includes('agents')))
  assert.ok(!injections.some((services) => services.includes('workingDirectory')))
  assert.ok(!injections.some((services) => services.includes('tools')))

  // route + token + system prompt + root dispose
  assert.equal(effects.length, 4)
  for (const factory of effects) assert.equal(typeof factory(), 'function')
  // No carrier here, so both Web effects warn instead of throwing.
  assert.ok(warnings.some((message) => message.includes('路由')))
  assert.ok(warnings.some((message) => message.includes('面板令牌')))
})

test('the route is registered as soon as webServer exists, session services or not', () => {
  const routes = []
  const { ctx, effects } = mockCtx()
  ctx.webServer = {
    register: (route) => {
      routes.push(route)
      return () => {}
    },
    tapIndex: () => () => {},
    getOrigin: () => 'http://127.0.0.1:1',
  }
  apply(ctx, {})
  for (const factory of effects) factory()
  assert.equal(routes.length, 1)
  assert.deepEqual({ kind: routes[0].kind, path: routes[0].path }, { kind: 'prefix', path: '/dsh-project-todo' })
})

test('ui.enabled=false warns and mounts no Web route', () => {
  const { ctx, injections, warnings } = mockCtx()
  apply(ctx, { ui: { enabled: false } })
  assert.ok(!injections.some((services) => services.includes('webServer')))
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
