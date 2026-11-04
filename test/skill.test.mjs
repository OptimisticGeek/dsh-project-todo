import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { skillCommand, skillReport, SKILL_SOURCE } from '../lib/cli/skill.mjs'
import { normalizeConfig } from '../lib/config.js'

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-skill-'))
  const home = await mkdtemp(path.join(os.tmpdir(), 'ptodo-home-'))
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
      path.join(home, '.agents', 'skills', 'project-todo'),
      path.join(home, '.zcode', 'skills', 'project-todo'),
    ]) {
      assert.ok(existsSync(path.join(target, 'SKILL.md')), target)
      assert.match(await readFile(path.join(target, 'SKILL.md'), 'utf8'), /name: project-todo/)
    }

    const report = skillReport(ctx, { home, targets: 'agents,zcode' })
    assert.deepEqual(
      report.results.map((item) => item.state),
      ['linked', 'linked'],
    )

    ctx.positional = ['remove']
    await skillCommand(ctx, { home, targets: 'agents,zcode', json: true })
    assert.equal(existsSync(path.join(home, '.agents', 'skills', 'project-todo')), false)
    assert.equal(existsSync(path.join(home, '.zcode', 'skills', 'project-todo')), false)
  })
})

test('skill install --targets all covers every tool directory, including workbuddy', async () => {
  await withRoot(async (root, home) => {
    const ctx = ctxOf(root)
    ctx.positional = ['install']
    await skillCommand(ctx, { home, targets: 'all', json: true })

    const expected = {
      project: path.join(root, '.agents', 'skills', 'project-todo'),
      agents: path.join(home, '.agents', 'skills', 'project-todo'),
      dsh: path.join(home, '.dsh', 'skills', 'project-todo'),
      zcode: path.join(home, '.zcode', 'skills', 'project-todo'),
      workbuddy: path.join(home, '.workbuddy', 'skills', 'project-todo'),
      claude: path.join(home, '.claude', 'skills', 'project-todo'),
      codex: path.join(home, '.codex', 'skills', 'project-todo'),
    }
    const report = skillReport(ctx, { home, targets: 'all' })
    assert.deepEqual(report.results.map((item) => item.name), Object.keys(expected))
    for (const [name, target] of Object.entries(expected)) {
      assert.equal(report.results.find((item) => item.name === name).state, 'linked', name)
      assert.ok(existsSync(path.join(target, 'SKILL.md')), target)
      assert.ok(existsSync(path.join(target, 'references', 'tools.md')), target)
    }

    // Re-running install is idempotent and must not downgrade links.
    ctx.positional = ['install']
    await skillCommand(ctx, { home, targets: 'all', json: true })
    assert.deepEqual(skillReport(ctx, { home, targets: 'all' }).results.map((item) => item.state), Array(7).fill('linked'))
  })
})

test('SKILL.md keeps the cross-tool protocol and G0-G4 gates', async () => {
  const skill = await readSkill()
  assert.match(skill, /^---\nname: project-todo\ndescription: /)
  for (const heading of ['## 铁律', '### G0 开工', '### G0.5 需求校验', '### G1 认领', '### G2 进行中', '### G3 完成', '### G4 收尾', '## 跨工具执行', '### ptodo 不在 PATH 时', '## 身份与目录', '## 失败处理']) {
    assert.ok(skill.includes(heading), `missing section: ${heading}`)
  }
  // Four-step self-check, in order, inside the cross-tool section.
  const crossTool = skill.slice(skill.indexOf('## 跨工具执行'), skill.indexOf('## 失败处理'))
  assert.ok(crossTool.length > 0, 'cross-tool section missing')
  const selfCheck = ['ptodo skill status', 'ptodo whoami', 'ptodo doctor', 'ptodo task ready']
  const positions = selfCheck.map((command) => crossTool.indexOf(command))
  assert.ok(positions.every((index) => index >= 0), 'self-check commands missing')
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'self-check order changed')
  // Actor must be <tool>:<name>; colon, not dash.
  assert.match(skill, /--by wb:/)
  assert.match(skill, /PTODO_ACTOR/)
  assert.match(skill, /没有冒号/)
  // PATH fallback that works from any tool.
  assert.match(skill, /node "\$\(npm root -g\)\/@local\/dsh-project-todo\/bin\/ptodo\.mjs"/)
  // G0.5 must degrade instead of blocking when a project has no PRD registry.
  assert.match(skill, /无需求资产/)
  assert.match(skill, /不得.{0,4}阻塞/)
  // Non-git projects need an explicit version.
  assert.match(skill, /--version <版本>/)
  // Exit codes other tools consume.
  for (const code of ['`3 NOT_FOUND`', '`4 CONFLICT`', '`5 INVALID`', '`7 NO_PROJECT`', '`10 NOT_READY`']) {
    assert.ok(skill.includes(code), `missing exit code: ${code}`)
  }
  // References must all be resolvable relative to SKILL.md.
  for (const ref of skill.matchAll(/references\/([a-z]+\.md)/g)) {
    assert.ok(existsSync(path.join(SKILL_SOURCE, 'references', ref[1])), ref[1])
  }
})

test('references/tools.md documents per-tool self-check, PATH fallback and actor', async () => {
  const tools = await readSkill(path.join('references', 'tools.md'))
  for (const tool of ['DSH', 'WorkBuddy', 'ZCode', 'Claude Code', 'Codex']) {
    assert.ok(tools.includes(tool), `missing tool: ${tool}`)
  }
  for (const command of ['ptodo skill status', 'ptodo whoami', 'ptodo doctor', 'ptodo task ready']) {
    assert.ok(tools.includes(command), `missing self-check command: ${command}`)
  }
  assert.match(tools, /npm root -g/)
  assert.match(tools, /--by wb:<名字>/)
  assert.match(tools, /--by zcode:<名字>/)
  assert.match(tools, /--by claude:<名字>/)
  assert.match(tools, /--by codex:<名字>/)
  // The old dash form may only appear as an explicit "wrong" example.
  assert.match(tools, /没有冒号/)
  assert.ok(tools.includes('--by wb:<名字>'), 'workbuddy actor form missing')
  for (const code of ['`3 NOT_FOUND`', '`4 CONFLICT`', '`5 INVALID`', '`7 NO_PROJECT`', '`10 NOT_READY`']) {
    assert.ok(tools.includes(code), `missing exit code: ${code}`)
  }
  assert.match(tools, /disableModelInvocation/)
  assert.match(tools, /无需求资产/)
  // person semantics, people list and milestone archive flow.
  assert.match(tools, /## 人（person）与人员列表/)
  assert.match(tools, /createdBy` \/ `holder` \/ `doneBy` \/ `archivedBy`/)
  assert.match(tools, /personSource/)
  assert.match(tools, /ptodo admin people/)
  assert.match(tools, /session-xxx/)
  assert.match(tools, /ptodo admin archive-batch --milestone/)
  assert.match(tools, /ptodo context loop <id> "里程碑 M-x 待归档/)
  assert.match(tools, /reasonCode/)
  assert.match(tools, /未指派/)
})

test('requirements.md scopes G0.5 to projects that own a PRD registry', async () => {
  const requirements = await readSkill(path.join('references', 'requirements.md'))
  assert.match(requirements, /适用范围/)
  assert.match(requirements, /不得因缺文档阻塞/)
})

test('SKILL.md separates person identity from --by and mandates the milestone archive ask', async () => {
  const skill = await readSkill()
  assert.match(skill, /### 人（person）与工具身份/)
  assert.match(skill, /git `user\.name`（person）/)
  assert.match(skill, /createdBy \/ holder \/ doneBy \/ archivedBy/)
  assert.match(skill, /person 由 CLI 计算/)
  assert.match(skill, /ptodo admin people/)
  assert.match(skill, /git log --format=%an/)
  // Archive ask is mandatory only when complete=true, never when milestone is null.
  assert.match(skill, /milestone\.complete=true/)
  assert.match(skill, /必须先问用户/)
  assert.match(skill, /未确认不得归档/)
  assert.match(skill, /milestone=null/)
  assert.match(skill, /ptodo admin archive-batch --milestone M-xxxx/)
  assert.match(skill, /里程碑 M-xxxx 待归档，用户暂不归档/)
  // 默认里程碑（收件箱）不归档：complete 只表示做完，不触发归档询问。
  assert.match(skill, /archivable/)
  assert.match(skill, /默认里程碑不归档/)
  assert.match(skill, /default` 里程碑不归档/)
  // Quick-reference table must teach the batch archive command and its flags.
  assert.match(skill, /里程碑\/阶段完成后归档/)
  assert.match(skill, /--stage S-0001/)
  assert.match(skill, /--ids T-0001,T-0002/)
  assert.match(skill, /skipped/)
  assert.match(skill, /reasonCode/)
  // `task ready` is the unassigned queue; assigned tasks must still start.
  assert.match(skill, /未指派/)
  assert.match(skill, /holder=你/)
})

test('POLICY_TEXT injects the archive-ask rule without touching other logic', async () => {
  const index = await readFile(path.join(SKILL_SOURCE, '..', '..', 'index.js'), 'utf8')
  const policy = index.slice(index.indexOf('const POLICY_TEXT'), index.indexOf('/** Short summary'))
  assert.match(policy, /milestone\.complete=true/)
  assert.match(policy, /先询问用户是否归档/)
  assert.match(policy, /ptodo admin archive-batch --milestone/)
  // 默认里程碑不归档，提示词里必须写死这条豁免。
  assert.match(policy, /archivable=true/)
  assert.match(policy, /默认里程碑/)
  assert.match(policy, /不要问归档/)
  // The pre-existing prompt injections stay intact.
  assert.match(policy, /项目待办唯一入口/)
  assert.match(policy, /禁止手改数据/)
})

test('SKILL.md carries the activation layer that decides whether it is invoked at all', async () => {
  const skill = await readSkill()
  const front = skill.match(/^---\n([\s\S]*?)\n---/)
  assert.ok(front, 'frontmatter missing')

  // L2: the model only sees name + description in the skill list.
  const description = front[1].match(/^description: "(.*)"$/m)
  assert.ok(description, 'description must be a single-quoted-line YAML string')
  assert.ok(description[1].length <= 400, `description too long: ${description[1].length} chars`)
  assert.match(description[1], /任务/, 'description must name the domain in natural language')
  assert.match(description[1], /不适用|不要用/, 'description must carry a negative boundary')
  assert.doesNotMatch(description[1], /ptodo [a-z]/, 'description must not be a CLI cheat sheet')
  assert.doesNotMatch(description[1], /\bANY\b/, 'description must not claim universal scope')

  // Metadata parity with peer skills in this ecosystem.
  for (const field of ['version:', 'license:', 'allowed-tools:', 'display_name:']) {
    assert.ok(front[1].includes(field), `missing frontmatter field: ${field}`)
  }

  // L3: the pre-activation sections must come before the protocol body.
  const headings = [
    '## 何时使用本技能',
    '## 何时不要使用',
    '## 与近邻技能的边界',
    '## 能力边界',
    '## 调用约定',
    '## 铁律',
    '## 执行门（必须按顺序）',
  ]
  const positions = headings.map((heading) => skill.indexOf(heading))
  assert.ok(positions.every((index) => index >= 0), 'activation sections missing')
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'activation sections out of order')

  // Every "when to use" signal must name the first step, so the model has a landing point.
  assert.match(skill, /能力边界/)
  assert.match(skill, /三条不可协商的契约/)

  const activation = await readSkill(path.join('references', 'activation.md'))
  assert.match(activation, /L1 注册/)
  assert.match(activation, /L2 选择/)
  assert.match(activation, /L3 执行/)
  assert.match(activation, /不适用/)
  assert.match(activation, /近邻诱饵/)
  assert.match(activation, /desc chars/)
})

test('SKILL.md documents version docs for batch completion / push and links them via done --version', async () => {
  const skill = await readSkill()
  const start = skill.indexOf('## 版本文档（批量完成 / push 前）')
  assert.ok(start > 0, 'version-doc section missing')
  const section = skill.slice(start, skill.indexOf('## 命令速查'))
  // Trigger and merge rules.
  assert.match(section, /批量完成|完成多个任务/)
  assert.match(section, /push \/ 交付/)
  assert.match(section, /同批任务共用一份/)
  assert.match(section, /追加到最近一份/)
  // Paths: project-specific first, generic fallback, docDir override.
  assert.match(section, /utp\/docs\/version\//)
  assert.match(section, /docs\/version\/<x\.y\.z>\.md/)
  assert.match(section, /docDir/)
  assert.match(section, /"docDir": "utp\/docs\/version"/)
  assert.match(section, /文件名 = `done --version` 原值 \+ `\.md`/)
  // Fixed template: version/date/tasks/changes/verification/risks (+ optional SQL).
  assert.match(section, /# 版本 x\.y\.z/)
  assert.match(section, /\*\*时间\*\*/)
  assert.match(section, /\*\*关联任务\*\*/)
  assert.match(section, /## 一、变更摘要/)
  assert.match(section, /## 二、验证与证据/)
  assert.match(section, /## 三、风险与待办/)
  assert.match(section, /## 四、SQL \/ 制品（可选）/)
  // Todo linkage and doctor warning.
  assert.match(section, /done --version <同一文档号>/)
  assert.match(section, /版本文档缺失/)
  assert.match(section, /只提醒，不阻断/)
  assert.match(section, /版本文档齐全/)
  assert.match(section, /doneVersion/)
  assert.match(section, /最多列 3 个版本/)
  assert.match(section, /checks\[\]/)
  assert.match(section, /done 行为不变/)
  assert.match(skill, /ptodo doctor/)
  // G3 must carry one step for it, not only the standalone section.
  const g3 = skill.slice(skill.indexOf('### G3 完成'), skill.indexOf('### G4 收尾'))
  assert.match(g3, /版本文档（批量完成 \/ push 前）/)
  assert.match(g3, /--version <文档号>/)
})
