import test from 'node:test'
import assert from 'node:assert/strict'
import {
  claimBatch,
  claimTask,
  completeTask,
  counts,
  createTask,
  deleteTask,
  deriveParents,
  emptyBoard,
  setStatusTask,
  sortForPanel,
  updateTask,
  validateBoard,
} from '../lib/model.js'

test('parent status derives from children bottom-up', () => {
  const board = emptyBoard('demo')
  validateBoard(board)
  const parent = createTask(board, { title: 'parent', priority: 'P0' })
  const first = createTask(board, { title: 'first', parentId: parent.id, priority: 'P0' })
  const second = createTask(board, { title: 'second', parentId: parent.id, priority: 'P2' })
  deriveParents(board)
  validateBoard(board)
  assert.equal(parent.status, 'open')

  claimTask(board, first.id, 'a')
  deriveParents(board)
  validateBoard(board)
  assert.equal(parent.status, 'doing')
  assert.equal(parent.holder, null)

  claimTask(board, second.id, 'b')
  completeTask(board, first.id, 'a')
  deriveParents(board)
  assert.equal(parent.status, 'doing')

  completeTask(board, second.id, 'b')
  deriveParents(board)
  validateBoard(board)
  assert.equal(parent.status, 'done')
  assert.ok(parent.doneAt)
  assert.equal(counts(board).doing, 0)
})

test('containers cannot be claimed or completed directly', () => {
  const board = emptyBoard('demo')
  const parent = createTask(board, { title: 'parent' })
  createTask(board, { title: 'child', parentId: parent.id })
  deriveParents(board)
  assert.throws(() => claimTask(board, parent.id, 'a'), /父任务/)
  assert.throws(() => completeTask(board, parent.id, 'a'), /父任务/)
})

test('cycle and depth are rejected', () => {
  const board = emptyBoard('demo')
  const a = createTask(board, { title: 'a' })
  const b = createTask(board, { title: 'b', parentId: a.id })
  assert.throws(() => updateTask(board, a.id, { parentId: b.id }), /成环|自己的子任务|不能挂到/)
})

test('legacy group merges into tags', () => {
  const board = emptyBoard('demo')
  const task = createTask(board, { title: 'x', tags: ['A'] })
  task.group = 'KB'
  validateBoard(board)
  assert.deepEqual(task.tags, ['A', 'KB'])
  assert.equal('group' in task, false)
})

test('batch claim picks ranked open leaves of one tag', () => {
  const board = emptyBoard('demo')
  createTask(board, { title: 'p2', priority: 'P2', urgency: 3, tags: ['KB'] })
  createTask(board, { title: 'p0', priority: 'P0', urgency: 1, tags: ['KB'] })
  createTask(board, { title: 'p1', priority: 'P1', urgency: 5, tags: ['KB'] })
  createTask(board, { title: 'other', priority: 'P0', tags: ['AGENT'] })
  const outcome = claimBatch(board, 'worker', 'KB', 2)
  assert.equal(outcome.claimed.length, 2)
  assert.equal(outcome.available, 3)
  const claimed = board.tasks.filter((task) => outcome.claimed.includes(task.id))
  assert.deepEqual(claimed.map((task) => task.title).sort(), ['p0', 'p1'])
  assert.ok(claimed.every((task) => task.holder === 'worker' && task.status === 'doing'))
})

test('conflicting claim is rejected without force', () => {
  const board = emptyBoard('demo')
  const task = createTask(board, { title: 'x' })
  claimTask(board, task.id, 'a')
  assert.throws(() => claimTask(board, task.id, 'b'), /已被 a 持有/)
  claimTask(board, task.id, 'b', true)
  assert.equal(task.holder, 'b')
})

test('statusChangedAt moves on status transitions, not on description edits', () => {
  const board = emptyBoard('demo')
  const task = createTask(board, { title: 'x' })
  task.statusChangedAt = '2020-01-01T00:00:00.000Z'
  updateTask(board, task.id, { title: 'renamed' })
  assert.equal(task.statusChangedAt, '2020-01-01T00:00:00.000Z')
  claimTask(board, task.id, 'a')
  assert.notEqual(task.statusChangedAt, '2020-01-01T00:00:00.000Z')
})

test('panel order is claimed time first, then creation time', () => {
  const board = emptyBoard('demo')
  const first = createTask(board, { title: 'old unclaimed' })
  first.createdAt = '2026-01-01T00:00:00.000Z'
  const second = createTask(board, { title: 'claimed later' })
  second.claimedAt = '2026-03-01T00:00:00.000Z'
  const third = createTask(board, { title: 'new unclaimed' })
  const ordered = sortForPanel([first, second, third]).map((task) => task.title)
  assert.deepEqual(ordered, ['claimed later', 'old unclaimed', 'new unclaimed'])
})

test('status dropdown transitions through the canonical actions', () => {
  const board = emptyBoard('demo')
  const task = createTask(board, { title: 'x' })
  setStatusTask(board, task.id, 'doing', 'a')
  assert.equal(task.status, 'doing')
  assert.equal(task.holder, 'a')
  setStatusTask(board, task.id, 'done', 'a')
  assert.equal(task.status, 'done')
  assert.ok(task.doneAt)
  setStatusTask(board, task.id, 'open', 'a')
  assert.equal(task.status, 'open')
  assert.equal(task.holder, null)
  setStatusTask(board, task.id, 'cancelled', 'a')
  assert.equal(task.status, 'cancelled')
})

test('task codes are auto-allocated by the board and never reused', () => {
  const board = emptyBoard('demo')
  const first = createTask(board, { title: 'one', id: 'X-9999' })
  assert.equal(first.id, 'T-0001')
  assert.equal(createTask(board, { title: 'two' }).id, 'T-0002')
  deleteTask(board, 'T-0002', { purge: true })
  assert.equal(createTask(board, { title: 'three' }).id, 'T-0003')
})

test('completing through the status dropdown records version and evidence', () => {
  const board = emptyBoard('demo')
  const task = createTask(board, { title: 'x' })
  setStatusTask(board, task.id, 'done', 'a', false, { version: 'abc1234', evidence: '测试通过' })
  assert.equal(task.status, 'done')
  assert.equal(task.doneVersion, 'abc1234')
  assert.equal(task.doneEvidence, '测试通过')
})
