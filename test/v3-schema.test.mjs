import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TodoStore } from '../lib/store.js'
import { initOrg, orgStoreFor } from '../lib/org.js'
import { normalizeConfig } from '../lib/config.js'
import { emptyBoard, normalizeBoard, validateBoard } from '../lib/model.js'

const CONFIG = normalizeConfig({})

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-v3-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function v2Task() {
  return {
    id: 'T-0001',
    legacyId: null,
    parentId: null,
    title: 'v2 任务',
    status: 'open',
    priority: 'P1',
    urgency: 3,
    holder: null,
    size: null,
    notes: '',
    tags: ['REQ'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    claimedAt: null,
    archivedAt: null,
    archiveExempt: false,
    doneAt: null,
    doneVersion: null,
    doneEvidence: null,
  }
}

test('reading a v2 board normalizes it to v3 in memory', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, 'docs', 'ptodo'), { recursive: true })
    const v2 = { version: 2, project: 'demo', nextId: 2, revision: 7, updatedAt: '2026-01-01T00:00:00.000Z', tasks: [v2Task()] }
    await writeFile(path.join(root, 'docs', 'ptodo', 'todos.json'), JSON.stringify(v2), 'utf8')
    const store = new TodoStore(root, CONFIG)
    const board = await store.read()
    assert.equal(board.version, 3)
    assert.equal(board.revision, 7)
    assert.equal(board.tasks[0].stageCode, 'default')
    assert.deepEqual(board.tasks[0].dependsOn, [])
    assert.deepEqual(board.tasks[0].context, { goal: null, progress: null, decisions: [], openLoops: [] })
    assert.equal(board.tasks[0].createdBy, null)
    assert.equal(board.tasks[0].revision, 0)
  })
})

test('initOrg writes the default milestone and stage', async () => {
  await withRoot(async (root) => {
    const org = await initOrg(root, CONFIG)
    assert.equal(org.milestones[0].code, 'default')
    assert.equal(org.stages[0].code, 'default')
    assert.equal(org.stages[0].milestoneCode, 'default')
    const saved = JSON.parse(await readFile(path.join(root, 'docs', 'ptodo', 'milestones.json'), 'utf8'))
    assert.equal(saved.milestones[0].name, '默认')
    assert.equal(saved.stages[0].status, 'active')
  })
})

test('createTask defaults the stage and validateBoard can enforce stage existence', () => {
  const board = emptyBoard('demo')
  const task = {
    ...v2Task(),
    stageCode: 'S-9999',
  }
  board.tasks.push(task)
  assert.throws(() => validateBoard(board, { stageCodes: ['default'] }), /阶段不存在/)
})

test('first v3 write backs up a v2 file', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, 'docs', 'ptodo'), { recursive: true })
    const v2 = { version: 2, project: 'demo', nextId: 2, revision: 2, updatedAt: '2026-01-01T00:00:00.000Z', tasks: [v2Task()] }
    const file = path.join(root, 'docs', 'ptodo', 'todos.json')
    await writeFile(file, JSON.stringify(v2), 'utf8')
    const store = new TodoStore(root, CONFIG)
    await store.mutate('update', 'tester', (board) => {
      board.tasks[0].notes = 'changed'
      return { changedTasks: ['T-0001'] }
    })
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.version, 3)
    const backupDir = path.join(root, 'docs', 'ptodo', '.backup')
    assert.ok(existsSync(backupDir))
  })
})

test('org store synthesizes defaults without writing when the file is missing', async () => {
  await withRoot(async (root) => {
    const store = orgStoreFor(root, CONFIG)
    const org = await store.read()
    assert.equal(org.milestones.length, 1)
    assert.equal(org.stages.length, 1)
    assert.equal(existsSync(path.join(root, 'docs', 'ptodo', 'milestones.json')), false)
  })
})

test('normalizeBoard keeps unknown task fields but fills v3 defaults', () => {
  const board = { version: 2, tasks: [{ ...v2Task(), custom: 'x' }] }
  normalizeBoard(board)
  assert.equal(board.version, 3)
  assert.equal(board.tasks[0].custom, 'x')
  assert.equal(board.tasks[0].stageCode, 'default')
})
