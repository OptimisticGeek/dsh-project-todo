import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { act, getState, getTask } from '../lib/service.js'
import { normalizeConfig } from '../lib/config.js'
import { orgStoreFor, initOrg } from '../lib/org.js'
import { exportMarkdown, parseMarkdownRows } from '../lib/transfer.js'

const CONFIG = normalizeConfig({
  markdown: { enabled: false },
  archive: { afterDays: 0 },
  version: { auto: false, require: false },
})

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-state-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('getState exposes milestones, stages, tags and derived task fields', async () => {
  await withRoot(async (root) => {
    await initOrg(root, CONFIG)
    const org = orgStoreFor(root, CONFIG)
    const created = await org.createMilestone({ name: 'Q4', stages: ['调研'] }, 'tester')
    const stageCode = created.result.stages[0].code
    await act(root, CONFIG, { action: 'create', title: '任务', stageCode, tags: ['REQ'], by: 'tester' }, 'tester')

    const state = await getState(root, CONFIG, {})
    assert.ok(state.milestones.some((entry) => entry.code === 'M-0001'))
    assert.equal(state.stages.find((entry) => entry.code === stageCode).progress.total, 1)
    assert.equal(state.tags.find((tag) => tag.code === 'REQ').status, 'draft')
    const task = state.board.tasks[0]
    assert.equal(task.stageCode, stageCode)
    assert.equal(task.milestoneCode, 'M-0001')
    assert.equal(task.effectiveStatus, 'open')
    assert.equal(task.isReady, true)
    assert.ok(Array.isArray(task.blocking))
    assert.ok(Array.isArray(task.preconditions))
  })
})

test('getTask returns evaluated preconditions, stage, milestone and commits array', async () => {
  await withRoot(async (root) => {
    await act(root, CONFIG, { action: 'create', title: 'A', by: 'tester' }, 'tester')
    await act(root, CONFIG, { action: 'pre_add', id: 'T-0001', type: 'manual_confirm' }, 'tester')
    const detail = await getTask(root, CONFIG, 'T-0001', {})
    assert.equal(detail.stage.code, 'default')
    assert.equal(detail.milestone.code, 'default')
    assert.equal(detail.preconditions[0].type, 'manual_confirm')
    assert.equal(detail.preconditions[0].satisfied, false)
    assert.ok(Array.isArray(detail.relatedCommits))
  })
})

test('markdown export includes stage and milestone columns', async () => {
  await withRoot(async (root) => {
    await initOrg(root, CONFIG)
    const org = orgStoreFor(root, CONFIG)
    const created = await org.createMilestone({ name: 'Q4', stages: ['调研'] }, 'tester')
    const stageCode = created.result.stages[0].code
    await act(root, CONFIG, { action: 'create', title: '导出任务', stageCode, by: 'tester' }, 'tester')
    const state = await getState(root, CONFIG, {})
    const text = exportMarkdown(state, 'active')
    const rows = parseMarkdownRows(text)
    assert.match(text, /\| 阶段 \| 里程碑 \|/)
    assert.match(rows[0]['阶段'], new RegExp(stageCode))
    assert.match(rows[0]['里程碑'], /M-0001/)
  })
})
