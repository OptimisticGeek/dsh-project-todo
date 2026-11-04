import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { act, getState, getTask } from '../lib/service.js'
import { normalizeConfig } from '../lib/config.js'

const CONFIG = normalizeConfig({
  markdown: { enabled: false },
  archive: { afterDays: 0 },
  version: { auto: false, require: false },
  context: { maxDecisions: 3, maxOpenLoops: 3 },
})

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-ctx-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function create(root, title) {
  return act(root, CONFIG, { action: 'create', title, by: 'tester' }, 'tester')
}

test('decisions fold to maxDecisions while keeping the newest entries', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    for (let index = 1; index <= 5; index += 1) {
      await act(root, CONFIG, { action: 'context_decision', id: 'T-0001', text: `决策${index}` }, 'tester')
    }
    const detail = await getTask(root, CONFIG, 'T-0001', {})
    assert.equal(detail.task.context.decisions.length, 3)
    assert.match(detail.task.context.decisions[0].text, /已折叠 3 条/)
    assert.deepEqual(
      detail.task.context.decisions.slice(1).map((entry) => entry.text),
      ['决策4', '决策5'],
    )
  })
})

test('required task_done precondition blocks readiness until the target is done', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await create(root, 'B')
    await act(root, CONFIG, { action: 'pre_add', id: 'T-0002', type: 'task_done', params: { taskId: 'T-0001' } }, 'tester')
    let state = await getState(root, CONFIG, {})
    assert.equal(state.board.tasks.find((task) => task.id === 'T-0002').effectiveStatus, 'blocked')
    await assert.rejects(
      act(root, CONFIG, { action: 'start', id: 'T-0002' }, 'tester'),
      (error) => error.code === 'NOT_READY',
    )
    await act(root, CONFIG, { action: 'start', id: 'T-0001' }, 'tester')
    await act(root, CONFIG, { action: 'done', id: 'T-0001', evidence: 'done', version: 'v1' }, 'tester')
    state = await getState(root, CONFIG, {})
    assert.equal(state.board.tasks.find((task) => task.id === 'T-0002').isReady, true)
  })
})

test('manual_confirm preconditions are satisfied only by explicit confirmation', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await act(root, CONFIG, { action: 'pre_add', id: 'T-0001', type: 'manual_confirm' }, 'tester')
    let detail = await getTask(root, CONFIG, 'T-0001', {})
    assert.equal(detail.preconditions[0].satisfied, false)
    await act(root, CONFIG, { action: 'pre_confirm', id: 'T-0001', preId: 'pc-0001', note: 'ok' }, 'tester')
    detail = await getTask(root, CONFIG, 'T-0001', {})
    assert.equal(detail.preconditions[0].satisfied, true)
    assert.equal(detail.task.isReady, true)
  })
})

test('superseding a resource marks it stale and adds an open loop', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await act(root, CONFIG, { action: 'res_add', id: 'T-0001', title: '设计稿', type: 'design' }, 'tester')
    await act(root, CONFIG, { action: 'res_add', id: 'T-0001', title: '设计稿 v2', type: 'design' }, 'tester')
    await act(root, CONFIG, { action: 'res_supersede', id: 'T-0001', resourceId: 'res-0001', byResource: 'res-0002' }, 'tester')
    const detail = await getTask(root, CONFIG, 'T-0001', {})
    assert.equal(detail.task.resources[0].status, 'superseded')
    assert.equal(detail.staleResources.length, 1)
    assert.ok(detail.task.context.openLoops.some((entry) => entry.text.includes('请复核')))
  })
})

test('causal edges mirror on tasks and chain walks both directions', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await create(root, 'B')
    await act(root, CONFIG, { action: 'cause_add', id: 'T-0002', type: 'task', ref: 'T-0001', note: 'A 是前提' }, 'tester')
    const board = (await getState(root, CONFIG, {})).board
    const a = board.tasks.find((task) => task.id === 'T-0001')
    const b = board.tasks.find((task) => task.id === 'T-0002')
    assert.equal(b.causedBy[0].ref, 'T-0001')
    assert.equal(a.causes[0].ref, 'T-0002')
    const chain = await act(root, CONFIG, { action: 'cause_chain', id: 'T-0001' }, 'tester')
    assert.deepEqual(chain.down.map((node) => node.id), ['T-0002'])
  })
})

test('context progress and open loops are updated through commands', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await act(root, CONFIG, { action: 'context_progress', id: 'T-0001', text: '一半' }, 'tester')
    await act(root, CONFIG, { action: 'context_loop', id: 'T-0001', text: '等评审' }, 'tester')
    let detail = await getTask(root, CONFIG, 'T-0001', {})
    assert.equal(detail.task.context.progress, '一半')
    assert.equal(detail.task.context.openLoops.length, 1)
    await act(root, CONFIG, { action: 'context_loop', id: 'T-0001', close: 1 }, 'tester')
    detail = await getTask(root, CONFIG, 'T-0001', {})
    assert.equal(detail.task.context.openLoops.length, 0)
  })
})
