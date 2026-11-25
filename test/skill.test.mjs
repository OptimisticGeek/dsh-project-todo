import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { skillCommand, skillReport, SKILL_SOURCE } from '../lib/cli/skill.mjs'
import { normalizeConfig } from '../lib/config.js'

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptask-skill-'))
  const home = await mkdtemp(path.join(os.tmpdir(), 'ptask-home-'))
  try {
    await run(root, home)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
}

function ctxOf(root) {
  return { root, actor: 'tester', config: normalizeConfig({}), cwd: root, tool: 'cli', positional: [] }
}

const readSkill = (name = 'SKILL.md') => readFile(path.join(SKILL_SOURCE, name), 'utf8')

test('skill install / status / remove work against an isolated home', async () => {
  await withRoot(async (root, home) => {
    const ctx = ctxOf(root)
    ctx.positional = ['install']
    await skillCommand(ctx, { home, targets: 'agents,zcode', json: true })

    for (const target of [
      path.join(home, '.agents', 'skills', 'project-task-board'),
      path.join(home, '.zcode', 'skills', 'project-task-board'),
    ]) {
      assert.ok(existsSync(path.join(target, 'SKILL.md')), target)
      assert.match(await readFile(path.join(target, 'SKILL.md'), 'utf8'), /name: project-task-board/)
    }

    const report = skillReport(ctx, { home, targets: 'agents,zcode' })
    assert.deepEqual(
      report.results.map((item) => item.state),
      ['linked', 'linked'],
    )

    ctx.positional = ['remove']
    await skillCommand(ctx, { home, targets: 'agents,zcode', json: true })
    assert.equal(existsSync(path.join(home, '.agents', 'skills', 'project-task-board')), false)
    assert.equal(existsSync(path.join(home, '.zcode', 'skills', 'project-task-board')), false)
  })
})

test('skill install --targets all covers every tool directory, including workbuddy', async () => {
  await withRoot(async (root, home) => {
    const ctx = ctxOf(root)
    ctx.positional = ['install']
    await skillCommand(ctx, { home, targets: 'all', json: true })

    const expected = {
      project: path.join(root, '.agents', 'skills', 'project-task-board'),
      claude: path.join(home, '.claude', 'skills', 'project-task-board'),
      codex: path.join(home, '.codex', 'skills', 'project-task-board'),
      workbuddy: path.join(home, '.workbuddy', 'skills', 'project-task-board'),
      zcode: path.join(home, '.zcode', 'skills', 'project-task-board'),
      trae: path.join(home, '.trae', 'skills', 'project-task-board'),
      dsh: path.join(home, '.dsh', 'skills', 'project-task-board'),
      agents: path.join(home, '.agents', 'skills', 'project-task-board'),
    }
    const report = skillReport(ctx, { home, targets: 'all' })
    assert.deepEqual(report.results.map((item) => item.name), Object.keys(expected))
    for (const [name, target] of Object.entries(expected)) {
      assert.equal(report.results.find((item) => item.name === name).state, 'linked', name)
      assert.ok(existsSync(path.join(target, 'SKILL.md')), target)
      assert.ok(existsSync(path.join(target, 'references', 'tools.md')), target)
    }

    ctx.positional = ['install']
    await skillCommand(ctx, { home, targets: 'all', json: true })
    assert.deepEqual(skillReport(ctx, { home, targets: 'all' }).results.map((item) => item.state), Array(8).fill('linked'))
  })
})

test('SKILL.md is a compact task-board protocol with progressive query levels', async () => {
  const skill = await readSkill()
  assert.match(skill, /^---\nname: project-task-board\ndescription: /)
  const front = skill.match(/^---\n([\s\S]*?)\n---/)
  assert.ok(front, 'frontmatter missing')
  const description = front[1].match(/^description: "(.*)"$/m)
  assert.ok(description, 'description must be a single-line YAML string')
  assert.ok(description[1].length <= 400, `description too long: ${description[1].length} chars`)
  assert.match(description[1], /任务/)
  assert.match(description[1], /不适用|不要用/)
  assert.doesNotMatch(description[1], /ptask [a-z]/, 'description must not be a CLI cheat sheet')
  for (const field of ['version:', 'license:', 'allowed-tools:', 'display_name:']) {
    assert.ok(front[1].includes(field), `missing frontmatter field: ${field}`)
  }
  assert.ok(Buffer.byteLength(skill) <= 10_000, `SKILL.md too large: ${Buffer.byteLength(skill)} bytes`)
  for (const heading of ['## 三套任务系统', '## 查询分级', '## 铁律', '### G0 开工', '### G0.5 需求校验', '### G1 认领', '### G2 进行中', '### G3 完成', '### G4 收尾', '## 跨工具执行', '## 身份与目录', '## 失败处理']) {
    assert.ok(skill.includes(heading), `missing section: ${heading}`)
  }
  for (const level of ['ptask show <id>', 'ptask show <id> --context', 'ptask show <id> --full', 'ptask ready --limit 3']) {
    assert.ok(skill.includes(level), `missing query level: ${level}`)
  }
  assert.match(skill, /todo_write/)
  assert.match(skill, /team_task/)
  assert.doesNotMatch(skill, /ptodo/)
  assert.doesNotMatch(skill, /\.dsh\/TODO\.md/)
})

test('index.js no longer injects a global policy or a snapshot header', async () => {
  const index = await readFile(path.join(SKILL_SOURCE, '..', '..', 'index.js'), 'utf8')
  assert.doesNotMatch(index, /POLICY_TEXT/)
  assert.doesNotMatch(index, /systemPrompt\.section/)
  assert.match(index, /isSubagent/)
  assert.match(index, /renderSummary/)
})

test('references are resolvable and point at the new CLI', async () => {
  const skill = await readSkill()
  for (const ref of skill.matchAll(/references\/([a-z]+\.md)/g)) {
    assert.ok(existsSync(path.join(SKILL_SOURCE, 'references', ref[1])), ref[1])
  }
  const tools = await readSkill(path.join('references', 'tools.md'))
  assert.ok(tools.includes('ptask skill status'))
  assert.ok(tools.includes('ptask whoami'))
  assert.ok(tools.includes('ptask doctor'))
  assert.ok(tools.includes('ptask ready'))
  assert.doesNotMatch(tools, /ptodo/)
})
