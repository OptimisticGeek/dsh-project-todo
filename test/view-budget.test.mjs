import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { renderBrief, renderContext, renderList, renderSummary } from '../lib/view.js'

const BIN = fileURLToPath(new URL('../bin/ptask.mjs', import.meta.url))

function run(root, args) {
  return spawnSync(process.execPath, [BIN, '--root', root, ...args], { encoding: 'utf8', windowsHide: true })
}

async function withRoot(runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptask-view-'))
  try {
    await runTest(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function task(id, patch = {}) {
  return {
    id,
    title: `任务 ${id}`,
    status: 'open',
    priority: 'P2',
    urgency: 3,
    stageCode: 'default',
    context: { goal: '', progress: '', decisions: [], openLoops: [] },
    dependsOn: [],
    preconditions: [],
    resources: [],
    causedBy: [],
    ...patch,
  }
}

function state(tasks, archived = []) {
  return {
    board: { project: 'demo', revision: 1, tasks },
    archived,
    counts: {
      doing: tasks.filter((entry) => entry.status === 'doing').length,
      open: tasks.filter((entry) => entry.status === 'open').length,
      blocked: tasks.filter((entry) => entry.status === 'blocked').length,
      done: tasks.filter((entry) => entry.status === 'done').length,
      cancelled: 0,
      total: tasks.length,
    },
    stages: [{ code: 'default', name: '未分类', milestoneCode: 'default' }],
    milestones: [{ code: 'default', name: '默认' }],
  }
}

test('V0 summary is bounded and lists at most two picks', () => {
  const tasks = Array.from({ length: 12 }, (_, index) => task(`T-${String(index + 1).padStart(4, '0')}`))
  const text = renderSummary(state(tasks), { limit: 2, maxChars: 160 })
  assert.ok(text.length <= 160, `summary too long: ${text.length}`)
  assert.match(text, /任务：进行中 0/)
  assert.match(text, /优先 T-0001、T-0002/)
})

test('V1 list defaults to 20 rows and never includes notes', () => {
  const tasks = Array.from({ length: 25 }, (_, index) => task(`T-${String(index + 1).padStart(4, '0')}`, { notes: '长备注'.repeat(200) }))
  const text = renderList(tasks)
  assert.match(text, /任务列表（25 条，显示前 20）/)
  assert.match(text, /还有 5 条/)
  assert.doesNotMatch(text, /长备注/)
})

test('V2 brief is bounded and V3 context stays relational', () => {
  const parent = task('T-0001', { title: '父任务' })
  const child = task('T-0002', { title: '子任务', parentId: 'T-0001', status: 'doing' })
  const upstream = task('T-0003', { title: '上游', status: 'done' })
  const target = task('T-0004', {
    title: '目标',
    dependsOn: [{ id: 'T-0003', type: 'hard' }],
    blocking: [{ id: 'T-0005', type: 'hard' }],
    context: {
      goal: '目标说明'.repeat(100),
      progress: '进度说明'.repeat(100),
      decisions: [
        { text: '决策一'.repeat(80), by: 'tester' },
        { text: '决策二'.repeat(80), by: 'tester' },
        { text: '决策三'.repeat(80), by: 'tester' },
      ],
      openLoops: Array.from({ length: 6 }, (_, index) => ({ text: `循环 ${index}`.repeat(20) })),
    },
    resources: [{ id: 'res-0001', title: '资料', status: 'approved' }],
  })
  const data = state([parent, child, target, upstream, task('T-0005', { title: '下游' })])
  const brief = renderBrief(data, target)
  assert.ok(brief.length <= 800, `brief too long: ${brief.length}`)
  assert.match(brief, /下一步/)
  assert.doesNotMatch(brief, /循环 5/)

  const context = renderContext(data, target)
  assert.ok(context.length <= 2500, `context too long: ${context.length}`)
  assert.match(context, /上游依赖/)
  assert.match(context, /T-0003/)
  assert.match(context, /下游/)
  assert.match(context, /资料/)
})

test('CLI defaults: status compact, show brief, --full expands, no snapshots, reads do not write', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    assert.equal(run(root, ['create', '--title', 'A', '--notes', '长备注'.repeat(400)]).status, 0)
    assert.equal(run(root, ['create', '--title', 'B']).status, 0)
    assert.equal(run(root, ['create', '--title', 'C']).status, 0)
    assert.equal(run(root, ['create', '--title', 'D']).status, 0)

    const status = run(root, ['status'])
    assert.equal(status.status, 0, status.stderr)
    assert.ok(status.stdout.length <= 400, `status too long: ${status.stdout.length}`)

    const ready = run(root, ['ready'])
    assert.equal(ready.status, 0, ready.stderr)
    assert.match(ready.stdout, /显示前 3/)
    assert.equal((ready.stdout.match(/^T-/gm) || []).length, 3)

    const brief = run(root, ['show', 'T-0001'])
    assert.equal(brief.status, 0, brief.stderr)
    assert.doesNotMatch(brief.stdout, /共 1200 字/)
    assert.ok(brief.stdout.length <= 800, `show too long: ${brief.stdout.length}`)

    const full = run(root, ['show', 'T-0001', '--full'])
    assert.equal(full.status, 0, full.stderr)
    assert.match(full.stdout, /备注：/)

    const briefJson = JSON.parse(run(root, ['show', 'T-0001', '--json']).stdout)
    assert.equal(briefJson.view, 'brief')
    assert.equal(briefJson.task.id, 'T-0001')
    assert.equal(briefJson.notes, undefined)
    const fullJson = JSON.parse(run(root, ['show', 'T-0001', '--json', '--full']).stdout)
    assert.match(fullJson.task.notes, /长备注/)

    assert.equal(existsSync(path.join(root, '.dsh', 'TODO.md')), false)
    assert.equal(existsSync(path.join(root, '.dsh', 'ARCHIVE.md')), false)

    const files = ['tasks.json', 'history.jsonl', 'milestones.json', 'tags.json']
    const before = new Map()
    for (const name of files) {
      const file = path.join(root, 'docs', 'ptask', name)
      if (existsSync(file)) before.set(name, createHash('sha256').update(await readFile(file)).digest('hex'))
    }
    for (const args of [['status'], ['list'], ['ready'], ['show', 'T-0001'], ['show', 'T-0001', '--context']]) {
      assert.equal(run(root, args).status, 0, args.join(' '))
    }
    for (const [name, hash] of before) {
      const file = path.join(root, 'docs', 'ptask', name)
      const after = createHash('sha256').update(await readFile(file)).digest('hex')
      assert.equal(after, hash, `${name} must not change on read`)
    }
  })
})
