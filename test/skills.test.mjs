import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  SKILL_TARGETS,
  installSkill,
  installSkills,
  isFirstRun,
  removeSkills,
  skillState,
  skillStatus,
  skillTargets,
} from '../lib/skills.js'

async function withDirs(runTest) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'ptodo-skills-'))
  const root = path.join(base, 'project')
  const home = path.join(base, 'home')
  mkdirSync(root, { recursive: true })
  mkdirSync(home, { recursive: true })
  try {
    await runTest({ root, home })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

test('every tool target lives under the user home and detects an installed tool', async () => {
  await withDirs(async ({ root, home }) => {
    const map = skillTargets(root, home)
    assert.deepEqual(Object.keys(map).sort(), [...SKILL_TARGETS].sort())
    assert.equal(map.project, path.join(root, '.agents', 'skills', 'project-todo'))
    assert.equal(map.claude, path.join(home, '.claude', 'skills', 'project-todo'))
    mkdirSync(path.join(home, '.trae'), { recursive: true })
    const rows = skillStatus(root, home)
    assert.equal(rows.find((row) => row.name === 'trae').detected, true)
    assert.equal(rows.find((row) => row.name === 'codex').detected, false)
    assert.ok(rows.find((row) => row.name === 'trae').note)
  })
})

test('install links the skill, is idempotent, and reports first-run correctly', async () => {
  await withDirs(async ({ root, home }) => {
    mkdirSync(path.join(home, '.claude'), { recursive: true })
    const before = skillStatus(root, home)
    assert.equal(isFirstRun(before), true, 'a detected tool with nothing installed is first run')

    const map = skillTargets(root, home)
    assert.equal(installSkill(map.claude), 'linked')
    assert.equal(installSkill(map.claude), 'linked')
    assert.equal(skillState(map.claude).state, 'linked')
    assert.ok(existsSync(path.join(map.claude, 'SKILL.md')))

    assert.equal(isFirstRun(skillStatus(root, home)), false, 'an installed target ends first run')
  })
})

test('a foreign directory is refused without force and replaced with it', async () => {
  await withDirs(async ({ root, home }) => {
    const map = skillTargets(root, home)
    mkdirSync(map.codex, { recursive: true })
    writeFileSync(path.join(map.codex, 'SKILL.md'), '# someone else\n', 'utf8')
    assert.throws(() => installSkill(map.codex), (error) => error.code === 'CONFLICT')
    assert.equal(installSkill(map.codex, { force: true }), 'linked')
    assert.equal(skillState(map.codex).state, 'linked')
  })
})

test('installSkills keeps going after one target fails', async () => {
  await withDirs(async ({ root, home }) => {
    const map = skillTargets(root, home)
    mkdirSync(map.codex, { recursive: true })
    writeFileSync(path.join(map.codex, 'SKILL.md'), '# foreign\n', 'utf8')
    const results = installSkills(root, home, ['claude', 'codex', 'nope'])
    assert.equal(results.find((item) => item.name === 'claude').state, 'linked')
    assert.equal(results.find((item) => item.name === 'codex').state, 'conflict')
    assert.equal(results.find((item) => item.name === 'nope').state, 'invalid')
  })
})

test('remove only deletes entries this skill owns', async () => {
  await withDirs(async ({ root, home }) => {
    const map = skillTargets(root, home)
    installSkill(map.claude)
    mkdirSync(map.codex, { recursive: true })
    writeFileSync(path.join(map.codex, 'SKILL.md'), '# foreign\n', 'utf8')
    const results = removeSkills(root, home, ['claude', 'codex'])
    assert.equal(results.find((item) => item.name === 'claude').removed, true)
    assert.equal(results.find((item) => item.name === 'codex').removed, false)
    assert.ok(existsSync(path.join(map.codex, 'SKILL.md')))
  })
})
