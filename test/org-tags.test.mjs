import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { act, getState } from '../lib/service.js'
import { normalizeConfig } from '../lib/config.js'
import { orgStoreFor, initOrg } from '../lib/org.js'
import { tagStoreFor } from '../lib/tags.js'
import { TodoError } from '../lib/model.js'

const CONFIG = normalizeConfig({
  markdown: { enabled: false },
  archive: { afterDays: 0 },
  version: { auto: false, require: false },
})

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-org-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('milestone create auto-creates stages and keeps the default inbox deletable-safe', async () => {
  await withRoot(async (root) => {
    await initOrg(root, CONFIG)
    const store = orgStoreFor(root, CONFIG)
    const created = await store.createMilestone({ name: 'Q4', stages: ['调研', '实现'] }, 'tester')
    assert.equal(created.result.milestone.code, 'M-0001')
    assert.deepEqual(created.result.stages.map((stage) => stage.name), ['调研', '实现'])
    assert.equal(created.result.stages[0].status, 'active')
    assert.equal(created.result.stages[1].status, 'pending')

    await assert.rejects(store.deleteMilestone('default', {}, 'tester'), /默认里程碑/)
    await assert.rejects(store.deleteStage('default', {}, 'tester'), /默认阶段/)
  })
})

test('stage dependencies mark blocked_by_upstream but never block tasks', async () => {
  await withRoot(async (root) => {
    await initOrg(root, CONFIG)
    const store = orgStoreFor(root, CONFIG)
    const created = await store.createMilestone({ name: 'Q4', stages: ['调研', '实现'] }, 'tester')
    const [research, build] = created.result.stages
    await store.addStageDep(build.code, research.code, 'stage', '', 'tester')
    await act(root, CONFIG, { action: 'create', title: '实现任务', stageCode: build.code, by: 'tester' }, 'tester')

    const state = await getState(root, CONFIG, {})
    const stage = state.stages.find((entry) => entry.code === build.code)
    assert.equal(stage.effectiveStatus, 'blocked_by_upstream')
    const task = state.board.tasks.find((entry) => entry.title === '实现任务')
    assert.equal(task.isReady, true)
  })
})

test('milestone dependencies block org status and cycles are rejected', async () => {
  await withRoot(async (root) => {
    await initOrg(root, CONFIG)
    const store = orgStoreFor(root, CONFIG)
    const first = await store.createMilestone({ name: 'M1' }, 'tester')
    const second = await store.createMilestone({ name: 'M2' }, 'tester')
    await store.addMilestoneDep(second.result.milestone.code, first.result.milestone.code, '', 'tester')
    let state = await getState(root, CONFIG, {})
    assert.equal(state.milestones.find((entry) => entry.code === 'M-0002').effectiveStatus, 'blocked_by_upstream')

    await assert.rejects(
      store.addMilestoneDep(first.result.milestone.code, second.result.milestone.code, '', 'tester'),
      (error) => error instanceof TodoError && error.code === 'DEPENDENCY_CYCLE',
    )
    state = await getState(root, CONFIG, {})
    assert.equal(state.milestones.find((entry) => entry.code === 'M-0001').dependsOnMilestone.length, 0)
  })
})

test('tags auto-register as draft, deprecate with a replacement and enforce strict mode', async () => {
  await withRoot(async (root) => {
    const store = tagStoreFor(root, CONFIG)
    const ensured = await store.ensure(['REQ'], 'tester')
    assert.deepEqual(ensured.codes, ['REQ'])
    assert.deepEqual(ensured.created, ['REQ'])
    const tag = await store.read()
    assert.equal(tag.tags[0].status, 'draft')

    await store.add({ name: '协议', code: 'PROTO', status: 'active' }, 'tester')
    await store.deprecate('REQ', 'PROTO', 'tester')
    const warned = await store.ensure(['REQ'], 'tester')
    assert.ok(warned.warnings.some((line) => line.includes('已废弃')))

    const strict = normalizeConfig({ ...CONFIG, tag: { strict: true } })
    await assert.rejects(
      tagStoreFor(root, strict).ensure(['UNKNOWN'], 'tester', { strict: true }),
      (error) => error instanceof TodoError && error.code === 'TAG_NOT_FOUND',
    )
  })
})

test('tag usage is derived from active and archived tasks', async () => {
  await withRoot(async (root) => {
    await act(root, CONFIG, { action: 'create', title: 'A', tags: ['REQ'], by: 'tester' }, 'tester')
    await act(root, CONFIG, { action: 'create', title: 'B', tags: ['REQ'], by: 'tester' }, 'tester')
    const state = await getState(root, CONFIG, {})
    assert.equal(state.tags.find((tag) => tag.code === 'REQ').usageCount, 2)
  })
})
