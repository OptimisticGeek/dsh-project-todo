import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { act, getPeople, getTask, repairPeople } from '../lib/service.js'
import { normalizeConfig } from '../lib/config.js'
import { initOrg } from '../lib/org.js'

const CONFIG = normalizeConfig({
  markdown: { enabled: false },
  archive: { afterDays: 0 },
  version: { auto: false, require: false },
})

const ACTOR = 'codex:alice'
const PERSON = 'alice'

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-person-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function call(root, payload) {
  return act(root, CONFIG, { by: ACTOR, ...payload }, ACTOR)
}

function create(root, title, extra = {}) {
  return call(root, { action: 'create', title, ...extra })
}

function start(root, id) {
  return call(root, { action: 'start', id })
}

function done(root, id, extra = {}) {
  return call(root, { action: 'done', id, evidence: '用例通过', ...extra })
}

function gitAvailable() {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0
  } catch {
    return false
  }
}

test('service stores person in createdBy/holder/doneBy while history keeps the actor', async () => {
  await withRoot(async (root) => {
    await initOrg(root, CONFIG)
    const plain = await create(root, '普通任务')
    assert.equal(plain.task.createdBy, PERSON)
    assert.equal(plain.task.holder, null, 'service create must not assign a holder implicitly')

    const assigned = await create(root, '显式负责人', { person: PERSON, holder: 'zhangsan' })
    assert.equal(assigned.task.createdBy, PERSON)
    assert.equal(assigned.task.holder, 'zhangsan')

    const claimed = await call(root, { action: 'claim', id: plain.task.id, holder: 'zhangsan' })
    assert.equal(claimed.board.tasks.find((task) => task.id === plain.task.id).holder, 'zhangsan')
    assert.equal(claimed.board.tasks.find((task) => task.id === plain.task.id).claimedBy, 'zhangsan')

    // release compares against the holder, so a different person needs --force
    await call(root, { action: 'release', id: plain.task.id, force: true })
    await start(root, plain.task.id)
    const finished = await done(root, plain.task.id)
    assert.equal(finished.board.tasks.find((task) => task.id === plain.task.id).doneBy, PERSON)

    const detail = await getTask(root, CONFIG, plain.task.id)
    assert.equal(detail.task.doneBy, PERSON)
    assert.equal(detail.history[0].by, ACTOR, 'history.by 仍是工具身份 actor')
  })
})

test('claim and start use an explicit holder over the person', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    const claimed = await call(root, { action: 'claim', id: 'T-0001', holder: 'lisi' })
    assert.equal(claimed.board.tasks[0].holder, 'lisi')
    const started = await call(root, { action: 'start', id: 'T-0001', holder: 'lisi' })
    assert.equal(started.task.holder, 'lisi')
    // A pre-assigned task can be started by that same person (create → start flow).
    const own = await create(root, 'B', { holder: 'wangwu' })
    const startedOwn = await call(root, { action: 'start', id: own.task.id, person: 'wangwu', holder: 'wangwu' })
    assert.equal(startedOwn.task.status, 'doing')
    assert.equal(startedOwn.task.holder, 'wangwu')
  })
})

test('getPeople merges board people with the current person, sorted and deduplicated', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await create(root, 'B', { person: PERSON, holder: 'bob' })
    await create(root, 'C', { person: 'carol', holder: 'dave' })
    const { person, people } = await getPeople(root, CONFIG, { person: PERSON })
    assert.equal(person, PERSON)
    const names = people.map((entry) => entry.name)
    assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right, 'zh-CN')))
    assert.deepEqual(names, ['alice', 'bob', 'carol', 'dave'])
    const alice = people.find((entry) => entry.name === 'alice')
    assert.equal(alice.source, 'me')
    assert.equal(alice.active, 2, 'alice 创建了 T-0001 且创建了 T-0002（person=alice）')
    assert.equal(alice.related, 2)
    const bob = people.find((entry) => entry.name === 'bob')
    assert.equal(bob.source, 'task')
    assert.equal(bob.active, 1)
    // A done task counts as done, not active; createdBy/doneBy of one task count once.
    await start(root, 'T-0001')
    await done(root, 'T-0001')
    const after = await getPeople(root, CONFIG, { person: PERSON })
    const aliceAfter = after.people.find((entry) => entry.name === 'alice')
    assert.equal(aliceAfter.done, 1)
    assert.equal(aliceAfter.active, 1)
    assert.equal(aliceAfter.related, 2)
  })
})

test('getPeople includes distinct git commit authors', async (t) => {
  await withRoot(async (root) => {
    if (!gitAvailable()) return t.skip('git 不可用')
    const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8', windowsHide: true })
    if (init.status !== 0) return t.skip('git init 失败')
    const commit = spawnSync(
      'git',
      ['-C', root, '-c', 'user.name=GitAuthor', '-c', 'user.email=git@example.com', 'commit', '--allow-empty', '-m', 'seed'],
      { encoding: 'utf8', windowsHide: true },
    )
    if (commit.status !== 0) return t.skip('git commit 失败')
    await create(root, 'A', { person: 'GitAuthor' })
    const { people } = await getPeople(root, CONFIG, { person: PERSON })
    const gitAuthor = people.find((entry) => entry.name === 'GitAuthor')
    assert.ok(gitAuthor, 'git 作者应出现在人员列表')
    assert.equal(gitAuthor.source, 'git')
    assert.equal(gitAuthor.related, 1)
  })
})

test('git projects only offer git authors as people', async (t) => {
  await withRoot(async (root) => {
    if (!gitAvailable()) return t.skip('git 不可用')
    const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8', windowsHide: true })
    if (init.status !== 0) return t.skip('git init 失败')
    const commit = spawnSync(
      'git',
      ['-C', root, '-c', 'user.name=GitAuthor', '-c', 'user.email=git@example.com', 'commit', '--allow-empty', '-m', 'seed'],
      { encoding: 'utf8', windowsHide: true },
    )
    if (commit.status !== 0) return t.skip('git commit 失败')
    await create(root, 'A', { person: 'GitAuthor', holder: 'GitAuthor' })
    const { people } = await getPeople(root, CONFIG, { person: 'GitAuthor' })
    assert.deepEqual(people.map((entry) => entry.name), ['GitAuthor'])
    assert.equal(people[0].source, 'me')
  })
})

test('repairPeople rewrites invalid person fields to a git author and leaves nulls alone', async (t) => {
  await withRoot(async (root) => {
    if (!gitAvailable()) return t.skip('git 不可用')
    // Seed invalid person values while the project has no git history.
    const bad = await create(root, '坏负责人', { person: 'bad:tool', holder: 'bad:tool' })
    await call(root, { action: 'start', id: bad.task.id, holder: 'bad:tool' })
    await done(root, bad.task.id, { person: 'bad:tool' })

    const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8', windowsHide: true })
    if (init.status !== 0) return t.skip('git init 失败')
    const commit = spawnSync(
      'git',
      ['-C', root, '-c', 'user.name=GoodPerson', '-c', 'user.email=git@example.com', 'commit', '--allow-empty', '-m', 'seed'],
      { encoding: 'utf8', windowsHide: true },
    )
    if (commit.status !== 0) return t.skip('git commit 失败')
    const clean = await create(root, '未指派', { person: 'GoodPerson' })

    const preview = await repairPeople(root, CONFIG, { person: 'GoodPerson', dryRun: true })
    assert.ok(preview.changes.some((change) => change.id === bad.task.id && change.field === 'holder'))
    assert.ok(preview.changes.some((change) => change.field === 'doneBy'))

    const repaired = await repairPeople(root, CONFIG, { person: 'GoodPerson' })
    assert.ok(repaired.changes.length >= 2)
    const board = await getTask(root, CONFIG, bad.task.id)
    assert.equal(board.task.holder, 'GoodPerson')
    assert.equal(board.task.doneBy, 'GoodPerson')
    assert.equal(board.task.claimedBy, 'GoodPerson')
    assert.equal(board.task.createdBy, 'GoodPerson')
    assert.equal((await getTask(root, CONFIG, clean.task.id)).task.holder, null)

    const { people } = await getPeople(root, CONFIG, { person: 'GoodPerson' })
    assert.deepEqual(people.map((entry) => entry.name), ['GoodPerson'])
  })
})

test('create and claim reject owners outside git history', async (t) => {
  await withRoot(async (root) => {
    if (!gitAvailable()) return t.skip('git 不可用')
    const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8', windowsHide: true })
    if (init.status !== 0) return t.skip('git init 失败')
    const commit = spawnSync(
      'git',
      ['-C', root, '-c', 'user.name=GoodPerson', '-c', 'user.email=git@example.com', 'commit', '--allow-empty', '-m', 'seed'],
      { encoding: 'utf8', windowsHide: true },
    )
    if (commit.status !== 0) return t.skip('git commit 失败')
    await assert.rejects(create(root, '非法', { person: 'GoodPerson', holder: 'bad:tool' }), /git 记录中的人员/)
    const ok = await create(root, '合法', { person: 'GoodPerson', holder: 'GoodPerson' })
    assert.equal(ok.task.holder, 'GoodPerson')
    await assert.rejects(call(root, { action: 'claim', id: ok.task.id, holder: 'bad:tool' }), /git 记录中的人员/)
  })
})

test('archive_batch moves done leaves and reports skipped with reasonCode', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await create(root, 'B')
    await create(root, 'C')
    await start(root, 'T-0001')
    await done(root, 'T-0001')
    await start(root, 'T-0002')
    await done(root, 'T-0002')
    const result = await call(root, { action: 'archive_batch', ids: ['T-0001', 'T-0002', 'T-0003', 'T-9999'] })
    assert.deepEqual(result.moved, ['T-0001', 'T-0002'])
    assert.equal(result.archived.length, 2)
    for (const task of result.archived) assert.equal(task.archivedBy, PERSON)
    const skipped = Object.fromEntries(result.skipped.map((entry) => [entry.id, entry.reasonCode]))
    assert.equal(skipped['T-0003'], 'NOT_DONE')
    assert.equal(skipped['T-9999'], 'NOT_FOUND')
    assert.match(result.skipped.find((entry) => entry.id === 'T-9999').reason, /没有任务 T-9999/)

    const again = await call(root, { action: 'archive_batch', ids: ['T-0001'] })
    assert.deepEqual(again.moved, [])
    assert.equal(again.skipped[0].reasonCode, 'ARCHIVED')

    const parent = await create(root, '父任务')
    const child = await create(root, '子任务', { parentId: parent.task.id })
    await start(root, child.task.id)
    await done(root, child.task.id)
    const withParent = await call(root, { action: 'archive_batch', ids: [parent.task.id, child.task.id] })
    assert.deepEqual(withParent.moved, [child.task.id])
    assert.equal(withParent.skipped[0].reasonCode, 'HAS_CHILDREN')
  })
})

test('archive_batch selects done leaves by milestone/stage and honours doneOnly', async () => {
  await withRoot(async (root) => {
    await create(root, 'A')
    await create(root, 'B')
    await create(root, 'C')
    await start(root, 'T-0001')
    await done(root, 'T-0001')
    await start(root, 'T-0002')
    await done(root, 'T-0002')
    const scoped = await call(root, { action: 'archive_batch', milestoneCode: 'default' })
    assert.deepEqual(scoped.moved, ['T-0001', 'T-0002'])
    assert.deepEqual(scoped.skipped, [])
    const nothing = await call(root, { action: 'archive_batch', stageCode: 'default' })
    assert.deepEqual(nothing.moved, [])

    await create(root, 'D')
    const withOpen = await call(root, { action: 'archive_batch', stageCode: 'default', doneOnly: false, ids: ['T-0003'] })
    assert.deepEqual(withOpen.moved, [])
    assert.equal(withOpen.skipped[0].reasonCode, 'NOT_DONE')
  })
})

test('done returns milestone completion, counting archived done tasks', async () => {
  await withRoot(async (root) => {
    await initOrg(root, CONFIG)
    await create(root, 'A')
    await create(root, 'B')
    await start(root, 'T-0001')
    const first = await done(root, 'T-0001')
    assert.deepEqual(first.milestone, { code: 'default', name: '默认', done: 1, total: 2, complete: false })
    await call(root, { action: 'archive', id: 'T-0001' })
    await start(root, 'T-0002')
    const second = await done(root, 'T-0002')
    assert.deepEqual(second.milestone, { code: 'default', name: '默认', done: 2, total: 2, complete: true })
    // A milestone with no active leaf task is not "complete".
    await call(root, { action: 'archive_batch', milestoneCode: 'default' })
    const empty = await call(root, { action: 'check' })
    assert.equal(empty.ok, true)
  })
})
