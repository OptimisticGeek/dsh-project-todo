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
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-reg-'))
  try {
    await runTest(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** The human name this machine resolves to; `person` prefers git config. */
function me(root) {
  return json(root, ['whoami']).data.person
}

/**
 * Regression: NOT_READY used to report the downstream task (the one blocked by
 * us) instead of the upstream dependency that actually blocks us. With a chain
 * A <- B <- C, starting B must name A, never C.
 */
test('NOT_READY names the upstream dependency, never the downstream one', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'A']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'B']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'C']).status, 0)
    assert.equal(run(root, ['task', 'dep', 'add', 'T-0002', '--blocked-by', 'T-0001']).status, 0)
    assert.equal(run(root, ['task', 'dep', 'add', 'T-0003', '--blocked-by', 'T-0002']).status, 0)

    const start = run(root, ['task', 'start', 'T-0002'])
    assert.equal(start.status, 10)
    assert.match(start.stderr, /NOT_READY/)
    assert.match(start.stderr, /依赖 T-0001 未完成/)
    assert.doesNotMatch(start.stderr, /T-0003/, 'downstream task must not be reported as a blocker')
  })
})

/**
 * Regression: an open task carrying a holder could not be released at all —
 * release demanded `doing`, start was refused by NOT_READY, and update had no
 * --holder. That left the task permanently out of `ready`.
 */
test('release clears a holder on an open task and puts it back in ready', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    const who = me(root)
    const created = json(root, ['task', 'create', '--title', 'A', '--claim'])
    assert.equal(created.status, 0, created.stderr)
    assert.equal(created.data.task.holder, who)
    assert.equal(created.data.task.status, 'open')

    let ready = json(root, ['task', 'ready'])
    assert.deepEqual(ready.data.tasks.map((task) => task.id), [], 'assigned task must not be ready')

    const released = run(root, ['task', 'release', 'T-0001'])
    assert.equal(released.status, 0, released.stderr)

    const after = json(root, ['task', 'get', 'T-0001'])
    assert.equal(after.data.task.holder, null)
    assert.equal(after.data.task.status, 'open')

    ready = json(root, ['task', 'ready'])
    assert.deepEqual(ready.data.tasks.map((task) => task.id), ['T-0001'])
  })
})

test('release still refuses finished tasks', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'A']).status, 0)
    assert.equal(run(root, ['task', 'start', 'T-0001']).status, 0)
    assert.equal(run(root, ['task', 'done', 'T-0001', '--evidence', 'ok']).status, 0)

    const released = run(root, ['task', 'release', 'T-0001'])
    assert.notEqual(released.status, 0)
    assert.match(released.stderr, /已结束/)
  })
})

test('releasing an unassigned open task is a no-op, not an error', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'A']).status, 0)

    const released = run(root, ['task', 'release', 'T-0001'])
    assert.equal(released.status, 0, released.stderr)
    const after = json(root, ['task', 'get', 'T-0001'])
    assert.equal(after.data.task.status, 'open')
    assert.equal(after.data.task.releasedBy, null)
  })
})

test('create without --claim leaves the task in the ready queue', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    const created = json(root, ['task', 'create', '--title', 'A'])
    assert.equal(created.data.task.holder, null)
    assert.equal(created.data.task.createdBy, me(root))
    const ready = json(root, ['task', 'ready'])
    assert.deepEqual(ready.data.tasks.map((task) => task.id), ['T-0001'])
  })
})
