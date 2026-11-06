import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-cap-'))
  try {
    assert.equal(run(root, ['init']).status, 0)
    await runTest(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** B5: historical completions must be registrable without a fake start. */
test('done --backfill completes an open task and is marked as a backfill', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['task', 'create', '--title', 'A']).status, 0)
    const missing = run(root, ['task', 'done', 'T-0001', '--backfill'])
    assert.equal(missing.status, 5)
    assert.match(missing.stderr, /需要显式 --version/)

    const done = run(root, ['task', 'done', 'T-0001', '--backfill', '--version', 'v1.0.9', '--evidence', '历史证据'])
    assert.equal(done.status, 0, done.stderr)
    const task = json(root, ['task', 'get', 'T-0001']).data.task
    assert.equal(task.status, 'done')
    assert.equal(task.doneVersion, 'v1.0.9')
    assert.equal(task.holder, null)

    const timeline = json(root, ['timeline', '--all', '--limit', '20']).data
    assert.ok(timeline.entries.some((entry) => entry.action === 'backfill' && entry.category === 'admin'))
    assert.ok(!timeline.entries.some((entry) => entry.action === 'start'), 'no fake start event')
  })
})

/** C3: one recommendation with an explicit ranking reason, and `next` explains itself. */
test('task suggest explains its pick; next carries a reason too', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['task', 'create', '--title', '低', '--priority', 'P2']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', '高', '--priority', 'P0', '--urgency', '5']).status, 0)

    const pick = json(root, ['task', 'suggest']).data
    assert.equal(pick.task.id, 'T-0002')
    assert.ok(pick.reasons.some((reason) => /P0/.test(reason)))
    assert.equal(pick.queueSize, 2)
    assert.equal(pick.alternatives[0].id, 'T-0001')
    assert.match(run(root, ['task', 'suggest']).stdout, /理由：/)

    // suggest is read-only: nothing was claimed.
    assert.equal(json(root, ['task', 'get', 'T-0002']).data.task.status, 'open')

    const next = json(root, ['next']).data
    assert.deepEqual(next.claimed, ['T-0002'])
    assert.match(next.reason, /优先级 → 紧急度 → 创建时间/)
  })
})

/** B3: legacy parents (including archived children) can be reconciled. */
test('task sync-parents closes a stale parent with aggregated version and evidence', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['task', 'create', '--title', '父']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', '子', '--parent', 'T-0001']).status, 0)
    assert.equal(run(root, ['task', 'start', 'T-0002']).status, 0)
    assert.equal(run(root, ['task', 'done', 'T-0002', '--evidence', '12/12 通过', '--version', 'v1.0.7']).status, 0)
    assert.equal(run(root, ['admin', 'archive', 'T-0002']).status, 0)

    // Simulate a legacy board where the parent was left open.
    const file = path.join(root, 'docs', 'ptodo', 'todos.json')
    const board = JSON.parse(await readFile(file, 'utf8'))
    const parent = board.tasks.find((task) => task.id === 'T-0001')
    Object.assign(parent, { status: 'open', doneAt: null, doneVersion: null, doneEvidence: null })
    await writeFile(file, JSON.stringify(board, null, 2), 'utf8')

    const dry = json(root, ['task', 'sync-parents', '--dry-run']).data
    assert.equal(dry.dryRun, true)
    assert.equal(dry.count, 1)
    assert.equal(dry.changes[0].archivedChildren, 1)
    assert.equal(json(root, ['task', 'get', 'T-0001']).data.task.status, 'open')

    const applied = json(root, ['task', 'sync-parents']).data
    assert.equal(applied.count, 1)
    const after = json(root, ['task', 'get', 'T-0001']).data.task
    assert.equal(after.status, 'done')
    assert.equal(after.doneVersion, 'v1.0.7')
    assert.match(after.doneEvidence, /12\/12 通过/)
    assert.equal(json(root, ['task', 'sync-parents']).data.count, 0, 'second run is a no-op')
  })
})

/** C6: clearing a stale holder is an admin event, hidden from the default feed. */
test('holder_fix is hidden by default and exposed via --all / --type admin', async () => {
  await withRoot(async (root) => {
    const created = run(root, ['task', 'create', '--title', 'A', '--claim'])
    assert.equal(created.status, 0, created.stderr)
    const released = run(root, ['task', 'release', 'T-0001'])
    assert.equal(released.status, 0, released.stderr)
    assert.match(released.stdout, /已清除占用/)
    assert.doesNotMatch(released.stdout, /中断于/, 'a holder fix must not fabricate a handoff')

    const plain = json(root, ['timeline', '--limit', '30']).data
    assert.ok(!plain.entries.some((entry) => entry.action === 'holder_fix'))
    const all = json(root, ['timeline', '--all', '--limit', '30']).data
    assert.ok(all.entries.some((entry) => entry.action === 'holder_fix' && entry.category === 'admin'))
    const admin = json(root, ['timeline', '--type', 'admin', '--limit', '30']).data
    assert.ok(admin.entries.some((entry) => entry.action === 'holder_fix'))
  })
})

/** E: explicit container role is exportable and reversible. */
test('role:container is enforced, exportable and reversible', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['task', 'create', '--title', '容器', '--container']).status, 0)
    let task = json(root, ['task', 'get', 'T-0001']).data.task
    assert.equal(task.role, 'container')
    assert.equal(task.isReady, false)
    assert.equal(run(root, ['task', 'start', 'T-0001']).status, 5)

    assert.equal(run(root, ['task', 'update', 'T-0001', '--role', 'task']).status, 0)
    task = json(root, ['task', 'get', 'T-0001']).data.task
    assert.equal(task.role, 'task')
    assert.equal(task.isReady, true)

    // Derived containers (a task with children) also export role=container.
    assert.equal(run(root, ['task', 'create', '--title', '父']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', '子', '--parent', 'T-0002']).status, 0)
    const exported = run(root, ['admin', 'export', '--format', 'json', '--scope', 'all'])
    assert.equal(exported.status, 0, exported.stderr)
    const file = exported.stdout.trim().split(/\r?\n/).pop().trim()
    const payload = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(payload.tasks.find((entry) => entry.id === 'T-0002').role, 'container')
    assert.equal(payload.tasks.find((entry) => entry.id === 'T-0001').role, undefined)
  })
})
