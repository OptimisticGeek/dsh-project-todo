import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply } from '../index.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('apply no longer injects the tools service', () => {
  const injections = []
  const effects = []
  const ctx = {
    inject: (services) => injections.push(services),
    on: () => {},
    effect: (factory) => effects.push(factory),
    get: () => undefined,
    logger: { warn: () => {} },
  }
  apply(ctx, {})
  assert.ok(!injections.some((services) => services.includes('tools')))
  assert.ok(injections.some((services) => services.includes('webServer')))
  assert.equal(effects.length, 1)
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
  assert.equal(pkg.version, '2.0.2')
  assert.deepEqual(pkg.bin, { ptodo: './bin/ptodo.mjs' })
  assert.ok(existsSync(new URL('../bin/ptodo.mjs', import.meta.url)))
  assert.ok(existsSync(new URL('../skill/project-todo/SKILL.md', import.meta.url)))
  assert.ok(ROOT)
})

