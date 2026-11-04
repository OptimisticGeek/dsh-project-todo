import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TodoStore } from '../lib/store.js'
import { claimTask, completeTask, createTask } from '../lib/model.js'

const CONFIG = {
  store: { path: '.dsh/todos.json' },
  archive: { path: '.dsh/archive.json', afterDays: 3 },
  markdown: { enabled: true, path: '.dsh/TODO.md', archivePath: '.dsh/ARCHIVE.md', doneLimit: 20 },
  import: { source: '开发计划/todo/TODO.md' },
  batch: { claimLimit: 3 },
  history: { enabled: true },
  ui: { enabled: true, defaultTab: 'auto' },
}

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-todo-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function create(store, title, tags = []) {
  return store.mutate('create', 'tester', (board) => {
    const task = createTask(board, { title, priority: 'P0', tags })
    return { changedTasks: [task.id] }
  })
}

test('mutation persists board, markdown snapshot and history', async () => {
  await withRoot(async (root) => {
    const store = new TodoStore(root, CONFIG)
    assert.equal((await store.read()).tasks.length, 0)
    const mutated = await create(store, '第一个任务', ['KB'])
    assert.equal(mutated.board.revision, 1)
    const state = await store.read()
    assert.equal(state.tasks.length, 1)
    assert.deepEqual(state.tasks[0].tags, ['KB'])
    const markdown = await readFile(path.join(root, '.dsh', 'TODO.md'), 'utf8')
    assert.match(markdown, /第一个任务/)
    assert.match(markdown, /KB/)
    const history = await store.readHistory(5)
    assert.equal(history.length, 1)
    assert.equal(history[0].action, 'create')
    assert.deepEqual(history[0].transitions, [{ id: 'T-0001', from: null, to: 'open' }])
  })
})

test('completed tasks sweep into the separate archive and can be restored', async () => {
  await withRoot(async (root) => {
    const store = new TodoStore(root, CONFIG)
    await create(store, '要归档的任务', ['归档'])
    await store.mutate('claim', 'a', (board) => {
      claimTask(board, 'T-0001', 'a')
      return { changedTasks: ['T-0001'] }
    })
    await store.mutate('done', 'a', (board) => {
      completeTask(board, 'T-0001', 'a')
      return { changedTasks: ['T-0001'] }
    })
    await store.mutate('age', 'a', (board) => {
      const task = board.tasks.find((candidate) => candidate.id === 'T-0001')
      task.doneAt = new Date(Date.now() - 4 * 86_400_000).toISOString()
      return { changedTasks: ['T-0001'] }
    })
    const swept = await store.sweepArchive()
    assert.deepEqual(swept.moved, ['T-0001'])
    assert.equal((await store.read()).tasks.length, 0)
    const archive = await store.readArchive()
    assert.equal(archive.tasks.length, 1)
    assert.ok(archive.tasks[0].archivedAt)
    const archiveMarkdown = await readFile(path.join(root, '.dsh', 'ARCHIVE.md'), 'utf8')
    assert.match(archiveMarkdown, /要归档的任务/)
    const restored = await store.unarchiveTask('T-0001', 'a')
    assert.equal(restored.board.tasks.length, 1)
    assert.equal((await store.readArchive()).tasks.length, 0)
  })
})

test('two stores racing on one task: exactly one claim wins', async () => {
  await withRoot(async (root) => {
    const seed = new TodoStore(root, CONFIG)
    await create(seed, 'race')
    const one = new TodoStore(root, CONFIG)
    const two = new TodoStore(root, CONFIG)
    const results = await Promise.allSettled([
      one.mutate('claim', 'a', (board) => {
        claimTask(board, 'T-0001', 'a')
        return { changedTasks: ['T-0001'] }
      }),
      two.mutate('claim', 'b', (board) => {
        claimTask(board, 'T-0001', 'b')
        return { changedTasks: ['T-0001'] }
      }),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const final = await seed.read()
    assert.ok(['a', 'b'].includes(final.tasks[0].holder))
  })
})

test('invalid JSON refuses to write', async () => {
  await withRoot(async (root) => {
    const store = new TodoStore(root, CONFIG)
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(path.join(root, '.dsh'), { recursive: true })
    await writeFile(path.join(root, '.dsh', 'todos.json'), '{ broken', 'utf8')
    await assert.rejects(
      store.mutate('create', 'x', (board) => {
        createTask(board, { title: 'x' })
        return { changedTasks: [] }
      }),
      /PARSE_ERROR|合法 JSON/,
    )
    const text = await readFile(path.join(root, '.dsh', 'todos.json'), 'utf8')
    assert.equal(text, '{ broken')
  })
})
