import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { act, getState, getTask, getTimeline } from '../lib/service.js'
import { normalizeConfig } from '../lib/config.js'
import { TodoError } from '../lib/model.js'

const CONFIG = normalizeConfig({
  markdown: { enabled: false },
  archive: { afterDays: 0 },
  version: { auto: false, require: false },
})

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-deps-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function create(root, title, extra = {}) {
  return act(root, CONFIG, { action: 'create', title, by: 'tester', ...extra }, 'tester')
}

test('hard dependency hides a task from ready and unlocks it on done', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await create(root, 'B')
    await act(root, CONFIG, { action: 'dep_add', id: 'T-0002', dependsOn: 'T-0001', type: 'hard' }, 'tester')

    let state = await getState(root, CONFIG, {})
    assert.deepEqual(state.board.tasks.filter((task) => task.isReady).map((task) => task.id), ['T-0001'])
    assert.equal(state.counts.ready, 1)
    assert.equal(state.counts.blockedEffective, 1)

    await assert.rejects(
      act(root, CONFIG, { action: 'start', id: 'T-0002' }, 'tester'),
      (error) => error instanceof TodoError && error.code === 'NOT_READY',
    )

    await act(root, CONFIG, { action: 'start', id: 'T-0001' }, 'tester')
    const done = await act(root, CONFIG, { action: 'done', id: 'T-0001', evidence: '通过', version: 'v1' }, 'tester')
    assert.deepEqual(done.unlocked, ['T-0002'])

    state = await getState(root, CONFIG, {})
    assert.deepEqual(state.board.tasks.filter((task) => task.isReady).map((task) => task.id), ['T-0002'])

    const log = await getTimeline(root, CONFIG, { type: 'dependency' })
    assert.ok(log.entries.some((entry) => entry.action === 'dependency_resolved'))
  })
})

test('task dependency cycles are rejected with DEPENDENCY_CYCLE', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await create(root, 'B')
    await act(root, CONFIG, { action: 'dep_add', id: 'T-0002', dependsOn: 'T-0001' }, 'tester')
    await assert.rejects(
      act(root, CONFIG, { action: 'dep_add', id: 'T-0001', dependsOn: 'T-0002' }, 'tester'),
      (error) => error instanceof TodoError && error.code === 'DEPENDENCY_CYCLE',
    )
  })
})

test('release records interrupted progress, a handoff note and resets holder', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await act(root, CONFIG, { action: 'start', id: 'T-0001' }, 'tester')
    const released = await act(root, CONFIG, { action: 'release', id: 'T-0001', note: '等评审' }, 'tester')
    assert.match(released.handoff.progress, /中断于/)
    const detail = await getTask(root, CONFIG, 'T-0001', {})
    assert.equal(detail.task.status, 'open')
    assert.equal(detail.task.holder, null)
    assert.ok(detail.task.context.openLoops.some((entry) => entry.text === '等评审'))
    assert.equal(detail.task.releasedBy, 'tester')
  })
})

test('manual block keeps the task out of ready and stores the reason', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    const blocked = await act(root, CONFIG, { action: 'block', id: 'T-0001', reason: '等客户' }, 'tester')
    assert.equal(blocked.board.tasks[0].status, 'blocked')
    const state = await getState(root, CONFIG, {})
    assert.equal(state.board.tasks[0].isReady, false)
    assert.equal(state.board.tasks[0].effectiveStatus, 'blocked')
    assert.ok(state.board.tasks[0].context.openLoops.some((entry) => entry.text === '等客户'))
  })
})

test('soft dependencies do not block readiness', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await create(root, 'B')
    await act(root, CONFIG, { action: 'dep_add', id: 'T-0002', dependsOn: 'T-0001', type: 'soft' }, 'tester')
    const state = await getState(root, CONFIG, {})
    assert.deepEqual(state.board.tasks.filter((task) => task.isReady).map((task) => task.id).sort(), ['T-0001', 'T-0002'])
  })
})

test('release_batch releases every task held by the actor', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await create(root, 'B')
    await act(root, CONFIG, { action: 'start', id: 'T-0001' }, 'tester')
    await act(root, CONFIG, { action: 'start', id: 'T-0002' }, 'tester')
    const released = await act(root, CONFIG, { action: 'release_batch' }, 'tester')
    assert.deepEqual(released.released.sort(), ['T-0001', 'T-0002'])
    const state = await getState(root, CONFIG, {})
    assert.ok(state.board.tasks.every((task) => task.holder === null && task.status === 'open'))
  })
})

test('start is idempotent for the current holder and returns a brief', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    const first = await act(root, CONFIG, { action: 'start', id: 'T-0001' }, 'tester')
    assert.equal(first.brief.task.id, 'T-0001')
    const again = await act(root, CONFIG, { action: 'start', id: 'T-0001' }, 'tester')
    assert.equal(again.message, '已在执行 T-0001')
  })
})
