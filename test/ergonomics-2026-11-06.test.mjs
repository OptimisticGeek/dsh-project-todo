import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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

async function withRoot(runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptask-erg-'))
  try {
    assert.equal(run(root, ['init']).status, 0)
    await runTest(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** `decision` appends, `progress` replaces — `--append` closes the gap. */
test('context progress --append preserves the existing snapshot', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['task', 'create', '--title', 'A']).status, 0)
    assert.equal(run(root, ['context', 'progress', 'T-0001', '第一段']).status, 0)
    assert.equal(run(root, ['context', 'progress', 'T-0001', '第二段']).status, 0)
    let context = json(root, ['context', 'get', 'T-0001']).data.context
    assert.equal(context.progress, '第二段', 'plain progress remains a snapshot (replace)')

    const appended = run(root, ['context', 'progress', 'T-0001', '第三段', '--append'])
    assert.equal(appended.status, 0, appended.stderr)
    assert.match(appended.stdout, /已追加进度/)
    context = json(root, ['context', 'get', 'T-0001']).data.context
    assert.equal(context.progress, '第二段\n第三段')
  })
})

/** Long notes must not push status/history off the screen. */
test('task get truncates long notes by default and --full restores them', async () => {
  await withRoot(async (root) => {
    const notes = '很长的备注'.repeat(120)
    assert.equal(run(root, ['task', 'create', '--title', 'A', '--notes', notes]).status, 0)
    const short = run(root, ['task', 'get', 'T-0001']).stdout
    assert.match(short, /共 600 字，--full 查看全文/)
    assert.ok(short.includes('创建 '), 'status fields must survive truncation')
    assert.doesNotMatch(run(root, ['task', 'get', 'T-0001', '--full']).stdout, /共 600 字/)
    assert.equal(json(root, ['task', 'get', 'T-0001']).data.task.notes, notes, 'JSON is never truncated')
  })
})

/** Scripts need a flat dependency id array and an upstream-blockers list. */
test('task get --json exposes dependsOnIds and blockers', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['task', 'create', '--title', 'A']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'B']).status, 0)
    assert.equal(run(root, ['task', 'dep', 'add', 'T-0002', '--blocked-by', 'T-0001']).status, 0)
    const detail = json(root, ['task', 'get', 'T-0002']).data
    assert.deepEqual(detail.task.dependsOnIds, ['T-0001'])
    assert.deepEqual(detail.blockers.map((entry) => entry.id), ['T-0001'])
    assert.equal(detail.task.dependsOn[0].type, 'hard', 'the detailed structure is preserved')
  })
})

/** Done parents silently reopening was an invisible state change. */
test('adding a child to a done parent warns and reopens it', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['task', 'create', '--title', '父任务']).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', '子任务', '--parent', 'T-0001']).status, 0)
    assert.equal(run(root, ['task', 'start', 'T-0002']).status, 0)
    const done = run(root, ['task', 'done', 'T-0002', '--evidence', 'ok', '--version', 'v1.0.0'])
    assert.equal(done.status, 0, done.stderr)
    assert.equal(json(root, ['task', 'get', 'T-0001']).data.task.status, 'done')

    const created = run(root, ['task', 'create', '--title', '新子任务', '--parent', 'T-0001'])
    assert.equal(created.status, 0, created.stderr)
    assert.match(created.stdout, /父任务 T-0001 已由 done 回退为 open/)
    assert.equal(json(root, ['task', 'get', 'T-0001']).data.task.status, 'open')
  })
})

/** Deprecated tag aliases used to drown the list. */
test('tag list hides deprecated tags unless --all is given', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['tag', 'add', '--name', '在用', '--code', 'LIVE']).status, 0)
    assert.equal(run(root, ['tag', 'add', '--name', '废弃', '--code', 'OLD']).status, 0)
    assert.equal(run(root, ['tag', 'deprecate', 'OLD']).status, 0)

    assert.doesNotMatch(run(root, ['tag', 'list']).stdout, /OLD/)
    assert.match(run(root, ['tag', 'list', '--all']).stdout, /OLD/)
    assert.match(run(root, ['tag', 'list', '--status', 'deprecated']).stdout, /OLD/)
  })
})

/** A repeated boolean flag must not silently disable --json. */
test('repeating --json still produces JSON', async () => {
  await withRoot(async (root) => {
    const result = run(root, ['task', 'list', '--json', '--json'])
    assert.equal(result.status, 0)
    assert.doesNotThrow(() => JSON.parse(result.stdout))
  })
})
