import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { act, getTimeline } from '../lib/service.js'

const CONFIG = {
  store: { path: '.dsh/todos.json' },
  archive: { path: '.dsh/archive.json', afterDays: 0 },
  markdown: { enabled: false, path: '.dsh/TODO.md', archivePath: '.dsh/ARCHIVE.md', doneLimit: 20 },
  import: { source: '开发计划/todo/TODO.md' },
  batch: { claimLimit: 3 },
  history: { enabled: true, path: '.dsh/logs/timeline.jsonl' },
  version: { auto: false, require: false, gitDir: '' },
  ui: { enabled: true, defaultTab: 'auto' },
}

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-timeline-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('timeline keeps its own log file, is newest-first and caps at 20', async () => {
  await withRoot(async (root) => {
    for (let index = 1; index <= 25; index += 1) {
      await act(root, CONFIG, { action: 'create', title: `任务${index}`, priority: 'P2' }, 'tester')
    }
    assert.ok(existsSync(path.join(root, '.dsh', 'logs', 'timeline.jsonl')))
    const data = await getTimeline(root, CONFIG, {})
    assert.equal(data.limit, 20)
    assert.equal(data.total, 25)
    assert.equal(data.matched, 25)
    assert.equal(data.entries.length, 20)
    assert.deepEqual(data.entries[0].taskIds, ['T-0025'])
    assert.equal(data.entries[19].taskIds[0], 'T-0006')
  })
})

test('timeline q matches task code or title fuzzily', async () => {
  await withRoot(async (root) => {
    for (let index = 1; index <= 12; index += 1) {
      await act(root, CONFIG, { action: 'create', title: `知识库任务${index}`, tags: ['KB'] }, 'tester')
    }
    const byCode = await getTimeline(root, CONFIG, { q: 't-0007' })
    assert.equal(byCode.matched, 1)
    assert.deepEqual(byCode.entries[0].taskIds, ['T-0007'])

    const byTitle = await getTimeline(root, CONFIG, { q: '知识库任务1' })
    assert.equal(byTitle.matched, 4) // T-0001, T-0010, T-0011, T-0012

    const byTag = await getTimeline(root, CONFIG, { q: 'kb' })
    assert.equal(byTag.matched, 12)

    const none = await getTimeline(root, CONFIG, { q: '不存在关键字' })
    assert.equal(none.matched, 0)
    assert.deepEqual(none.entries, [])
  })
})

test('timeline scope=task returns field-level changes', async () => {
  await withRoot(async (root) => {
    await act(root, CONFIG, { action: 'create', title: '原始标题' }, 'tester')
    await act(root, CONFIG, { action: 'claim', id: 'T-0001' }, 'alice')
    await act(root, CONFIG, { action: 'update', id: 'T-0001', title: '新标题' }, 'alice')
    const data = await getTimeline(root, CONFIG, { scope: 'task', taskId: 'T-0001' })
    assert.equal(data.entries.length, 3)
    const changes = data.entries[0].changes
    assert.deepEqual(changes, [{ id: 'T-0001', field: 'title', from: '原始标题', to: '新标题' }])
    assert.equal(data.entries[0].transitions.length, 0)
  })
})

test('timeline survives task purge because the log is independent', async () => {
  await withRoot(async (root) => {
    await act(root, CONFIG, { action: 'create', title: '会被彻底删除' }, 'tester')
    await act(root, CONFIG, { action: 'delete', id: 'T-0001', purge: true }, 'tester')
    const data = await getTimeline(root, CONFIG, { q: 't-0001' })
    assert.equal(data.matched, 2)
    assert.equal(data.entries[0].action, 'purge')
    assert.equal(data.entries[1].action, 'create')
    assert.match(JSON.stringify(data.entries[1]), /会被彻底删除/)
  })
})

test('clearing the timeline never touches tasks, archive or revision', async () => {
  await withRoot(async (root) => {
    for (let index = 1; index <= 5; index += 1) {
      await act(root, CONFIG, { action: 'create', title: `任务${index}` }, 'tester')
    }
    await assert.rejects(act(root, CONFIG, { action: 'timeline_clear' }, 'tester'), /confirm/)
    const cleared = await act(root, CONFIG, { action: 'timeline_clear', confirm: true }, 'tester')
    assert.equal(cleared.cleared, 5)
    assert.equal(await readFile(path.join(root, '.dsh', 'logs', 'timeline.jsonl'), 'utf8'), '')
    const data = await getTimeline(root, CONFIG, {})
    assert.equal(data.total, 0)
    const state = await act(root, CONFIG, { action: 'check' }, 'tester')
    assert.match(state.message, /共 5 个任务/)
    assert.equal(state.board.revision, 5)
    assert.ok(state.board.tasks.every((task) => task.status === 'open'))
    // The board keeps working after the log is gone.
    await act(root, CONFIG, { action: 'create', title: '清空后新建' }, 'tester')
    assert.equal((await getTimeline(root, CONFIG, {})).total, 1)
  })
})
