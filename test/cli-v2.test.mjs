import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../bin/ptodo.mjs', import.meta.url))

function run(root, args) {
  return spawnSync(process.execPath, [BIN, '--root', root, ...args], { encoding: 'utf8', windowsHide: true })
}

function json(root, args) {
  const result = run(root, [...args, '--json'])
  return { status: result.status, data: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr }
}

async function withRoot(runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-cli2-'))
  try {
    await runTest(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('agent flow: create assigns the person → start → done via the new CLI', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    const created = json(root, ['task', 'create', '--title', '任务 A', '--priority', 'P0', '--tags', 'REQ'])
    assert.equal(created.status, 0, created.stderr)
    assert.equal(created.data.task.id, 'T-0001')
    // A CLI create belongs to the current person by default (new-task holder).
    assert.equal(created.data.task.holder.length > 0, true)

    // `ready` is the unassigned queue, so an assigned task is not listed there.
    const ready = json(root, ['task', 'ready'])
    assert.equal(ready.status, 0, ready.stderr)
    assert.deepEqual(ready.data.tasks.map((task) => task.id), [])

    const started = json(root, ['task', 'start', 'T-0001'])
    assert.equal(started.status, 0, started.stderr)
    assert.equal(started.data.brief.task.id, 'T-0001')
    assert.equal(started.data.task.holder, created.data.task.holder)

    const done = json(root, ['task', 'done', 'T-0001', '--evidence', '通过', '--version', 'v1'])
    assert.equal(done.status, 0, done.stderr)
    assert.equal(done.data.version, 'v1')
    assert.equal(done.data.milestone.complete, true)
  })
})

test('not-ready tasks exit 10 and blocked tasks do not appear in ready', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'A']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'B']).status, 0)
    assert.equal(run(root, ['task', 'dep', 'add', 'T-0002', '--blocked-by', 'T-0001']).status, 0)
    const start = run(root, ['task', 'start', 'T-0002'])
    assert.equal(start.status, 10)
    assert.match(start.stderr, /NOT_READY/)
    const listed = json(root, ['task', 'list'])
    assert.equal(listed.data.tasks.find((task) => task.id === 'T-0002').effectiveStatus, 'blocked')
    const ready = json(root, ['task', 'ready'])
    assert.deepEqual(ready.data.tasks.map((task) => task.id), [])
  })
})

test('milestone / stage / tag / context / pre / res / cause commands work', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'A']).status, 0)

    const milestone = json(root, ['milestone', 'create', '--name', 'Q4', '--stages', '调研,实现'])
    assert.equal(milestone.status, 0, milestone.stderr)
    assert.equal(milestone.data.milestone.code, 'M-0001')
    const stages = json(root, ['stage', 'list'])
    assert.equal(stages.data.stages.filter((stage) => stage.milestoneCode === 'M-0001').length, 2)

    assert.equal(run(root, ['tag', 'add', '--name', '协议', '--code', 'PROTO']).status, 0)
    const tags = json(root, ['tag', 'list'])
    assert.ok(tags.data.tags.some((tag) => tag.code === 'PROTO'))

    assert.equal(run(root, ['context', 'decision', 'T-0001', '先做 A']).status, 0)
    assert.equal(run(root, ['context', 'progress', 'T-0001', '一半']).status, 0)
    assert.equal(run(root, ['context', 'loop', 'T-0001', '等评审']).status, 0)
    const context = json(root, ['context', 'get', 'T-0001'])
    assert.equal(context.data.context.progress, '一半')

    assert.equal(run(root, ['pre', 'add', 'T-0001', '--type', 'manual_confirm']).status, 0)
    assert.equal(run(root, ['pre', 'confirm', 'T-0001', 'pc-0001']).status, 0)
    const pre = json(root, ['pre', 'list', 'T-0001'])
    assert.equal(pre.data.preconditions[0].satisfied, true)

    assert.equal(run(root, ['res', 'add', 'T-0001', '--title', '设计稿']).status, 0)
    assert.equal(run(root, ['res', 'add', 'T-0001', '--title', '设计稿 v2']).status, 0)
    assert.equal(run(root, ['res', 'supersede', 'T-0001', 'res-0001', '--by-resource', 'res-0002']).status, 0)
    const resources = json(root, ['res', 'list', 'T-0001'])
    assert.equal(resources.data.resources[0].status, 'superseded')

    assert.equal(run(root, ['task', 'create', '--title', 'B']).status, 0)
    assert.equal(run(root, ['cause', 'add', 'T-0002', '--type', 'task', '--ref', 'T-0001']).status, 0)
    const chain = json(root, ['cause', 'chain', 'T-0001'])
    assert.deepEqual(chain.data.down.map((node) => node.id), ['T-0002'])
  })
})

test('task block requires a reason and exits 5 without one', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'A']).status, 0)
    const blocked = run(root, ['task', 'block', 'T-0001'])
    assert.equal(blocked.status, 5)
    assert.match(blocked.stderr, /INVALID/)
  })
})

test('timeline --type only returns the requested domain', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'A']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'B']).status, 0)
    assert.equal(run(root, ['task', 'dep', 'add', 'T-0002', '--blocked-by', 'T-0001']).status, 0)
    const timeline = json(root, ['timeline', '--type', 'dependency'])
    assert.ok(timeline.data.entries.every((entry) => entry.action.startsWith('dep')))
    assert.ok(timeline.data.entries.length >= 1)
  })
})
