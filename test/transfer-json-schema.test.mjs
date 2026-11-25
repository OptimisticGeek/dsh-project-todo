import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../bin/ptask.mjs', import.meta.url))

function run(root, args) {
  return spawnSync(process.execPath, [BIN, '--root', root, ...args], { encoding: 'utf8', windowsHide: true })
}

function json(root, args) {
  const result = run(root, [...args, '--json'])
  return { status: result.status, data: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr }
}

async function withRoots(count, runTest) {
  const roots = []
  try {
    for (let i = 0; i < count; i += 1) roots.push(await mkdtemp(path.join(os.tmpdir(), 'ptask-json-')))
    await runTest(...roots)
  } finally {
    for (const root of roots) await rm(root, { recursive: true, force: true })
  }
}

/** Build a small board and export it as JSON. Returns the payload. */
async function fixture(root) {
  assert.equal(run(root, ['init']).status, 0)
  assert.equal(run(root, ['task', 'create', '--title', '父任务', '--priority', 'P0', '--tags', 'KB']).status, 0)
  assert.equal(run(root, ['task', 'create', '--title', '子任务A', '--parent', 'T-0001', '--notes', '做什么 + 验收']).status, 0)
  assert.equal(run(root, ['task', 'create', '--title', '子任务B', '--parent', 'T-0001']).status, 0)
  assert.equal(run(root, ['task', 'dep', 'add', 'T-0003', '--blocked-by', 'T-0002']).status, 0)
  assert.equal(run(root, ['context', 'decision', 'T-0002', '决策一：复用 OCR']).status, 0)

  const exported = run(root, ['admin', 'export', '--format', 'json', '--scope', 'all'])
  assert.equal(exported.status, 0, exported.stderr)
  const file = exported.stdout.trim().split(/\r?\n/).pop().trim()
  return JSON.parse(await readFile(file, 'utf8'))
}

/**
 * Regression: `--help` used to print one global blob for every command, so the
 * flags of a specific action were undiscoverable without reading CLI source.
 */
test('help is per-action and schema exposes the full command surface', async () => {
  await withRoots(1, async (root) => {
    const overall = run(root, ['--help']).stdout
    const specific = run(root, ['task', 'update', '--help']).stdout
    assert.notEqual(overall, specific)
    assert.match(specific, /--notes/)
    assert.match(specific, /--urgency/)
    assert.match(overall, /schema --json/)

    const domain = run(root, ['task', '--help']).stdout
    assert.match(domain, /task dep add/)
    assert.match(domain, /task create/)

    const unknown = run(root, ['task', 'updata', '--help'])
    assert.equal(unknown.status, 2)
    assert.match(unknown.stdout, /没有子命令/)

    const schema = json(root, ['schema'])
    assert.equal(schema.status, 0, schema.stderr)
    const admin = schema.data.commands.find((entry) => entry.name === 'admin')
    assert.ok(admin.actions.some((entry) => entry.name === 'import-file'))
    assert.ok(admin.actions.some((entry) => entry.name === 'export'))
    assert.ok(schema.data.globalFlags.some((flag) => flag.name === '--root'))
  })
})

/** Export → import round-trip keeps parents, dependencies and decisions. */
test('JSON export/import round-trips structure and is idempotent', async () => {
  await withRoots(2, async (source, target) => {
    const payload = await fixture(source)
    assert.equal(payload.kind, 'ptask.tasks')
    assert.equal(payload.count, 3)
    assert.deepEqual(payload.tasks[2].dependsOn, ['T-0002'])

    const file = path.join(target, 'in.json')
    await writeFile(file, JSON.stringify(payload), 'utf8')
    assert.equal(run(target, ['init']).status, 0)

    const dry = json(target, ['admin', 'import-file', 'in.json', '--dry-run'])
    assert.equal(dry.status, 0, dry.stderr)
    assert.equal(dry.data.created, 3)
    assert.equal(dry.data.updated, 0)
    assert.equal(json(target, ['task', 'list']).data.tasks.length, 0, 'dry-run must not write')

    const go = json(target, ['admin', 'import-file', 'in.json'])
    assert.equal(go.status, 0, go.stderr)
    assert.deepEqual(go.data.rows.map((row) => row.result), ['created', 'created', 'created'])
    assert.deepEqual(go.data.rows.map((row) => row.id), ['T-0001', 'T-0002', 'T-0003'])

    const board = json(target, ['task', 'list'])
    assert.equal(board.data.tasks.length, 3)
    assert.equal(board.data.tasks[1].parentId, 'T-0001')
    assert.deepEqual(board.data.tasks[2].dependsOn.map((dep) => dep.id), ['T-0002'])
    assert.equal(board.data.tasks[1].context.decisions[0].text, '决策一：复用 OCR')

    const again = json(target, ['admin', 'import-file', 'in.json'])
    assert.equal(again.data.created, 0)
    assert.equal(again.data.updated, 0)
    assert.equal(again.data.unchanged, 3)
  })
})

/** Invalid rows are reported individually and make the batch fail loudly. */
test('JSON import reports per-row failures and exits non-zero', async () => {
  await withRoots(1, async (root) => {
    const payload = await fixture(root)
    payload.tasks[1].priority = 'P9'
    payload.tasks[2].notes = '改了描述'
    await writeFile(path.join(root, 'bad.json'), JSON.stringify(payload), 'utf8')

    const result = run(root, ['admin', 'import-file', 'bad.json'])
    assert.equal(result.status, 1, 'a batch with a failed row must be non-zero')
    assert.match(result.stdout, /失败 1/)
    assert.match(result.stdout, /优先级非法：P9/)

    const machine = json(root, ['admin', 'import-file', 'bad.json'])
    assert.equal(machine.data.ok, false)
    assert.equal(machine.data.rows.filter((row) => row.result === 'failed').length, 1)
  })
})

/** Dependency-only changes must not be silently dropped. */
test('JSON import applies a dependency change even when nothing else changed', async () => {
  await withRoots(1, async (root) => {
    const payload = await fixture(root)
    payload.tasks[2].dependsOn = ['T-0002', 'T-0001']
    payload.tasks[2].dependsOnDetail = [
      { id: 'T-0002', type: 'hard', note: '' },
      { id: 'T-0001', type: 'soft', note: '' },
    ]
    await writeFile(path.join(root, 'dep.json'), JSON.stringify(payload), 'utf8')

    const first = json(root, ['admin', 'import-file', 'dep.json'])
    assert.equal(first.status, 0, first.stderr)
    assert.deepEqual(first.data.rows[2].changes, ['dependsOn'])
    const deps = json(root, ['task', 'get', 'T-0003']).data.task.dependsOn
    assert.deepEqual(deps.map((dep) => dep.id), ['T-0002', 'T-0001'])
    assert.equal(deps[1].type, 'soft')

    const second = json(root, ['admin', 'import-file', 'dep.json'])
    assert.equal(second.data.updated, 0, 'a repeat must be a no-op')
  })
})

/** Unknown dependency ids are reported, not silently ignored. */
test('JSON import warns about unresolvable dependencies', async () => {
  await withRoots(1, async (root) => {
    const payload = await fixture(root)
    payload.tasks[2].dependsOn = ['T-9999']
    await writeFile(path.join(root, 'missing.json'), JSON.stringify(payload), 'utf8')

    const dry = json(root, ['admin', 'import-file', 'missing.json', '--dry-run'])
    assert.deepEqual(dry.data.rows[2].missingDeps, ['T-9999'])
  })
})

/** `--create-only` copies rows from another project without clobbering by id. */
test('--create-only never updates an existing task with the same id', async () => {
  await withRoots(1, async (root) => {
    const payload = await fixture(root)
    payload.tasks[0].title = '别的项目里也叫 T-0001'
    await writeFile(path.join(root, 'copy.json'), JSON.stringify(payload), 'utf8')

    const result = json(root, ['admin', 'import-file', 'copy.json', '--create-only'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.data.created, 3)
    assert.equal(result.data.updated, 0)

    const board = json(root, ['task', 'list'])
    assert.equal(board.data.tasks.length, 6)
    assert.equal(board.data.tasks[0].title, '父任务', 'the original must be untouched')
    assert.equal(board.data.tasks[3].legacyId, 'T-0001')
  })
})
