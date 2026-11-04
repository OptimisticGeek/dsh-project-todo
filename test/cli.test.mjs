import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const BIN = fileURLToPath(new URL('../bin/ptodo.mjs', import.meta.url))

function run(root, args, env) {
  return spawnSync(process.execPath, [BIN, '--root', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
  })
}

async function withRoot(runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-cli-'))
  try {
    await runTest(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('init creates docs/ptodo/todos.json and whoami reports it', async () => {
  await withRoot(async (root) => {
    const init = run(root, ['init'])
    assert.equal(init.status, 0, init.stderr)
    const board = JSON.parse(await readFile(path.join(root, 'docs', 'ptodo', 'todos.json'), 'utf8'))
    assert.equal(board.tasks.length, 0)
    const who = run(root, ['whoami', '--json'])
    assert.equal(who.status, 0, who.stderr)
    const data = JSON.parse(who.stdout)
    assert.equal(data.root, root)
    assert.match(data.paths.store, /docs[\\/]ptodo[\\/]todos\.json$/)
  })
})

test('create / next --limit / done / list keep one board', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    const first = run(root, ['create', '--title', '任务 A', '--priority', 'P0', '--tags', 'KB', '--by', 'tester', '--json'])
    assert.equal(first.status, 0, first.stderr)
    assert.equal(JSON.parse(first.stdout).task.id, 'T-0001')
    assert.equal(run(root, ['create', '--title', '任务 B', '--priority', 'P1', '--by', 'tester']).status, 0)

    const next = run(root, ['next', '--limit', '2', '--json', '--by', 'tester'])
    assert.equal(next.status, 0, next.stderr)
    const claimed = JSON.parse(next.stdout)
    assert.deepEqual(claimed.claimed, ['T-0001', 'T-0002'])

    const done = run(root, ['done', 'T-0001', '--version', 'test-1', '--evidence', '用例通过', '--json', '--by', 'tester'])
    assert.equal(done.status, 0, done.stderr)
    assert.equal(JSON.parse(done.stdout).version, 'test-1')

    const listed = run(root, ['list', '--json'])
    const data = JSON.parse(listed.stdout)
    assert.equal(data.tasks.length, 2)
    assert.equal(data.tasks.find((task) => task.id === 'T-0001').status, 'done')
    assert.equal(data.tasks.find((task) => task.id === 'T-0002').status, 'doing')
  })
})

test('conflict and invalid usage map to stable exit codes', async () => {
  await withRoot(async (root) => {
    // Two different humans: without a git identity the person falls back to
    // the stripped `--by`, so an empty HOME makes the two names distinct.
    const home = await mkdtemp(path.join(os.tmpdir(), 'ptodo-cli-home-'))
    const env = { USERPROFILE: home, HOME: home }
    try {
      assert.equal(run(root, ['init']).status, 0)
      assert.equal(run(root, ['create', '--title', '独占任务', '--by', 'a'], env).status, 0)
      assert.equal(run(root, ['claim', 'T-0001', '--by', 'a'], env).status, 0)
      const conflict = run(root, ['claim', 'T-0001', '--by', 'b', '--json'], env)
      assert.equal(conflict.status, 4)
      const error = JSON.parse(conflict.stderr)
      assert.equal(error.code, 'CONFLICT')
    } finally {
      await rm(home, { recursive: true, force: true })
    }

    const missing = run(root, ['get', 'T-9999', '--json'])
    assert.equal(missing.status, 3)
    assert.equal(JSON.parse(missing.stderr).code, 'NOT_FOUND')

    const usage = run(root, ['create'])
    assert.equal(usage.status, 5)
  })
})

test('root resolution finds the workspace board from a nested repository', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    const nested = path.join(root, 'utp', 'src')
    await mkdir(nested, { recursive: true })
    await mkdir(path.join(root, 'utp', '.git'), { recursive: true })
    const who = spawnSync(process.execPath, [BIN, 'whoami', '--json'], {
      cwd: nested,
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.equal(who.status, 0, who.stderr)
    assert.equal(JSON.parse(who.stdout).root, root)
  })
})

test('migrate moves .dsh data to docs/ptodo and deletes the old JSON', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, '.dsh'), { recursive: true })
    const board = {
      version: 2,
      project: 'demo',
      nextId: 3,
      revision: 7,
      updatedAt: new Date().toISOString(),
      tasks: [
        {
          id: 'T-0001',
          title: '旧任务',
          status: 'doing',
          priority: 'P0',
          urgency: 4,
          holder: 'old',
          tags: ['KB'],
          parentId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          statusChangedAt: new Date().toISOString(),
          claimedAt: new Date().toISOString(),
          notes: '',
          legacyId: null,
          doneAt: null,
          doneVersion: null,
          doneEvidence: null,
        },
      ],
    }
    await writeFile(path.join(root, '.dsh', 'todos.json'), `${JSON.stringify(board, null, 2)}\n`)
    await writeFile(
      path.join(root, '.dsh', 'archive.json'),
      `${JSON.stringify({ version: 1, project: 'demo', revision: 0, updatedAt: new Date().toISOString(), tasks: [] }, null, 2)}\n`,
    )
    await writeFile(path.join(root, '.dsh', 'todos.history.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), action: 'create', by: 'old', taskIds: ['T-0001'], transitions: [] })}\n`)

    const dry = run(root, ['migrate', '--dry-run'])
    assert.equal(dry.status, 0, dry.stderr)
    assert.ok(existsSync(path.join(root, '.dsh', 'todos.json')))

    const migrated = run(root, ['migrate'])
    assert.equal(migrated.status, 0, migrated.stderr)
    assert.ok(existsSync(path.join(root, 'docs', 'ptodo', 'todos.json')))
    assert.equal(existsSync(path.join(root, '.dsh', 'todos.json')), false)
    const saved = JSON.parse(await readFile(path.join(root, 'docs', 'ptodo', 'todos.json'), 'utf8'))
    assert.equal(saved.revision, 7)
    assert.equal(saved.tasks[0].title, '旧任务')
    assert.equal(saved.tasks[0].holder, 'old')
    assert.equal(await readFile(path.join(root, 'docs', 'ptodo', 'todos.history.jsonl'), 'utf8'), '')
  })
})
