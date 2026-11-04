import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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

function json(root, args, env) {
  const result = run(root, [...args, '--json'], env)
  return { status: result.status, data: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr }
}

async function withRoot(runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-cli-person-'))
  const home = await mkdtemp(path.join(os.tmpdir(), 'ptodo-cli-person-home-'))
  // An empty home means no git user.name, so the person is the stripped --by.
  const env = { USERPROFILE: home, HOME: home }
  try {
    await runTest(root, env)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
}

test('whoami reports person and its source', async () => {
  await withRoot(async (root, env) => {
    assert.equal(run(root, ['init'], env).status, 0)
    const who = json(root, ['whoami', '--by', 'codex:alice'], env)
    assert.equal(who.status, 0, who.stderr)
    assert.equal(who.data.actor, 'codex:alice')
    assert.equal(who.data.person, 'alice')
    assert.equal(who.data.personSource, 'flag')
    const text = run(root, ['whoami', '--by', 'codex:alice'], env)
    assert.equal(text.status, 0, text.stderr)
    assert.match(text.stdout, /person\s+alice/)
  })
})

test('create assigns the person, start accepts it and done reports milestone completion', async () => {
  await withRoot(async (root, env) => {
    assert.equal(run(root, ['init'], env).status, 0)
    const created = json(root, ['task', 'create', '--title', '任务 A', '--by', 'codex:alice'], env)
    assert.equal(created.status, 0, created.stderr)
    assert.equal(created.data.task.holder, 'alice')
    assert.equal(created.data.task.createdBy, 'alice')
    assert.equal(run(root, ['task', 'create', '--title', '任务 B', '--by', 'codex:alice'], env).status, 0)

    const started = json(root, ['task', 'start', 'T-0001', '--by', 'codex:alice'], env)
    assert.equal(started.status, 0, started.stderr)
    assert.equal(started.data.task.holder, 'alice')

    const first = json(root, ['task', 'done', 'T-0001', '--version', 'v1', '--evidence', '通过', '--by', 'codex:alice'], env)
    assert.equal(first.status, 0, first.stderr)
    assert.deepEqual(first.data.milestone, { code: 'default', name: '默认', done: 1, total: 2, complete: false, archivable: false })

    assert.equal(run(root, ['task', 'start', 'T-0002', '--by', 'codex:alice'], env).status, 0)
    const text = run(root, ['task', 'done', 'T-0002', '--evidence', '通过', '--version', 'v2', '--by', 'codex:alice'], env)
    assert.equal(text.status, 0, text.stderr)
    // 默认里程碑不归档：complete 为真也不出归档提示。
    assert.doesNotMatch(text.stdout, /归档前先询问用户/)
    assert.doesNotMatch(text.stdout, /admin archive-batch/)
  })
})

test('done asks for archive only on a non-default milestone', async () => {
  await withRoot(async (root, env) => {
    assert.equal(run(root, ['init'], env).status, 0)
    assert.equal(run(root, ['milestone', 'create', '--name', '交付批次'], env).status, 0)
    const created = json(root, ['task', 'create', '--title', '任务 A', '--stage', 'S-0001', '--by', 'codex:alice'], env)
    assert.equal(created.status, 0, created.stderr)
    assert.equal(run(root, ['task', 'start', 'T-0001', '--by', 'codex:alice'], env).status, 0)
    const text = run(root, ['task', 'done', 'T-0001', '--evidence', '通过', '--version', 'v3', '--by', 'codex:alice'], env)
    assert.equal(text.status, 0, text.stderr)
    assert.match(text.stdout, /里程碑 M-0001 已全部完成/)
    assert.match(text.stdout, /归档前先询问用户/)
    assert.match(text.stdout, /admin archive-batch --milestone M-0001/)

    const data = json(root, ['task', 'get', 'T-0001'], env)
    assert.equal(data.status, 0, data.stderr)
  })
})

test('admin people lists the current person and task people', async () => {
  await withRoot(async (root, env) => {
    assert.equal(run(root, ['init'], env).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'A', '--by', 'codex:alice'], env).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'B', '--by', 'codex:alice', '--holder', 'bob'], env).status, 0)
    const people = json(root, ['admin', 'people', '--by', 'codex:alice'], env)
    assert.equal(people.status, 0, people.stderr)
    assert.equal(people.data.ok, true)
    assert.equal(people.data.action, 'people')
    assert.equal(people.data.person, 'alice')
    const names = people.data.people.map((entry) => entry.name)
    assert.ok(names.includes('alice'))
    assert.ok(names.includes('bob'))
    assert.equal(people.data.people.find((entry) => entry.name === 'alice').source, 'me')
    const text = run(root, ['admin', 'people', '--by', 'codex:alice'], env)
    assert.match(text.stdout, /当前人员：alice/)
  })
})

test('admin archive-batch reports moved, archived and skipped with reasonCode', async () => {
  await withRoot(async (root, env) => {
    assert.equal(run(root, ['init'], env).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'A', '--by', 'codex:alice'], env).status, 0)
    assert.equal(run(root, ['task', 'create', '--title', 'B', '--by', 'codex:alice'], env).status, 0)
    assert.equal(run(root, ['task', 'start', 'T-0001', '--by', 'codex:alice'], env).status, 0)
    assert.equal(run(root, ['task', 'done', 'T-0001', '--version', 'v1', '--by', 'codex:alice'], env).status, 0)

    const batch = json(root, ['admin', 'archive-batch', '--ids', 'T-0001,T-0002,T-9999', '--by', 'codex:alice'], env)
    assert.equal(batch.status, 0, batch.stderr)
    assert.deepEqual(batch.data.moved, ['T-0001'])
    assert.equal(batch.data.archived.length, 1)
    assert.equal(batch.data.archived[0].archivedBy, 'alice')
    const skipped = Object.fromEntries(batch.data.skipped.map((entry) => [entry.id, entry.reasonCode]))
    assert.equal(skipped['T-0002'], 'NOT_DONE')
    assert.equal(skipped['T-9999'], 'NOT_FOUND')

    const text = run(root, ['admin', 'archive-batch', '--milestone', 'default', '--by', 'codex:alice'], env)
    assert.equal(text.status, 0, text.stderr)
    assert.match(text.stdout, /没有可归档的任务/)
    const usage = run(root, ['admin', 'archive-batch'], env)
    assert.equal(usage.status, 5)
  })
})
