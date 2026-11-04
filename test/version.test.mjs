import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { act, getVersionInfo } from '../lib/service.js'
import { resolveDoneVersion, versionDirs } from '../lib/version.js'

const HAS_GIT = spawnSync('git', ['--version'], { windowsHide: true }).status === 0

const CONFIG = {
  store: { path: '.dsh/todos.json' },
  archive: { path: '.dsh/archive.json', afterDays: 0 },
  markdown: { enabled: false, path: '.dsh/TODO.md', archivePath: '.dsh/ARCHIVE.md', doneLimit: 20 },
  import: { source: '开发计划/todo/TODO.md' },
  batch: { claimLimit: 3 },
  history: { enabled: true, path: '.dsh/todos.history.jsonl' },
  version: { auto: true, require: true, gitDir: '' },
  ui: { enabled: true, defaultTab: 'auto' },
}

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-version-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function initRepo(dir) {
  execFileSync('git', ['init', '--quiet', dir], { windowsHide: true })
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { windowsHide: true })
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Tester'], { windowsHide: true })
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '--quiet', '-m', 'init'], { windowsHide: true })
  return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { windowsHide: true, encoding: 'utf8' }).trim()
}

test('explicit version wins over git detection', async () => {
  await withRoot(async (root) => {
    const resolved = await resolveDoneVersion(root, CONFIG, { version: ' 1.0.147 ' })
    assert.deepEqual(resolved, { version: '1.0.147', source: 'manual', dir: '' })
  })
})

test('resolveDoneVersion falls back to the session cwd repository', { skip: !HAS_GIT }, async () => {
  await withRoot(async (root) => {
    const repo = path.join(root, 'utp')
    await mkdir(repo)
    const hash = initRepo(repo)
    assert.ok(versionDirs(root, CONFIG, { cwd: repo }).includes(repo))
    const resolved = await resolveDoneVersion(root, CONFIG, { cwd: repo })
    assert.equal(resolved.version, hash)
    assert.equal(resolved.source, 'git')
    assert.equal(path.resolve(resolved.dir), path.resolve(repo))
  })
})

test('configured version.gitDir also resolves', { skip: !HAS_GIT }, async () => {
  await withRoot(async (root) => {
    const repo = path.join(root, 'platform')
    await mkdir(repo)
    const hash = initRepo(repo)
    const config = { ...CONFIG, version: { ...CONFIG.version, gitDir: 'platform' } }
    const resolved = await resolveDoneVersion(root, config, {})
    assert.equal(resolved.version, hash)
  })
})

test('completing a done task stamps the git short hash', { skip: !HAS_GIT }, async () => {
  await withRoot(async (root) => {
    const hash = initRepo(root)
    await act(root, CONFIG, { action: 'create', title: '带版本完成' }, 'Tester')
    await act(root, CONFIG, { action: 'claim', id: 'T-0001' }, 'Tester')
    const done = await act(root, CONFIG, { action: 'done', id: 'T-0001' }, 'Tester')
    assert.equal(done.version, hash)
    assert.match(done.message, new RegExp(`版本 ${hash}`))
    const task = done.board.tasks.find((candidate) => candidate.id === 'T-0001')
    assert.equal(task.status, 'done')
    assert.equal(task.doneVersion, hash)
    assert.ok(task.doneAt)
  })
})

test('update status=done also stamps the version', { skip: !HAS_GIT }, async () => {
  await withRoot(async (root) => {
    const hash = initRepo(root)
    await act(root, CONFIG, { action: 'create', title: '下拉完成' }, 'Tester')
    const result = await act(root, CONFIG, { action: 'update', id: 'T-0001', status: 'done' }, 'Tester')
    assert.equal(result.task.doneVersion, hash)
  })
})

test('a finished task keeps its version correctable', { skip: !HAS_GIT }, async () => {
  await withRoot(async (root) => {
    initRepo(root)
    await act(root, CONFIG, { action: 'create', title: '可修正版本' }, 'Tester')
    await act(root, CONFIG, { action: 'claim', id: 'T-0001' }, 'Tester')
    await act(root, CONFIG, { action: 'done', id: 'T-0001' }, 'Tester')
    const result = await act(
      root,
      CONFIG,
      { action: 'update', id: 'T-0001', status: 'done', version: 'manual-fix', evidence: '补录证据' },
      'Tester',
    )
    assert.equal(result.task.doneVersion, 'manual-fix')
    assert.equal(result.task.doneEvidence, '补录证据')
    assert.equal(result.task.status, 'done')
  })
})

test('require=true refuses completion without a resolvable version', async () => {
  await withRoot(async (root) => {
    await act(root, CONFIG, { action: 'create', title: '无仓库' }, 'Tester')
    await act(root, CONFIG, { action: 'claim', id: 'T-0001' }, 'Tester')
    await assert.rejects(act(root, CONFIG, { action: 'done', id: 'T-0001' }, 'Tester'), /git 短 hash/)
    const manual = await act(root, CONFIG, { action: 'done', id: 'T-0001', version: 'manual-1' }, 'Tester')
    assert.equal(manual.version, 'manual-1')
  })
})

test('version endpoint reports what the completion dialog will use', { skip: !HAS_GIT }, async () => {
  await withRoot(async (root) => {
    const hash = initRepo(root)
    const info = await getVersionInfo(root, CONFIG, {})
    assert.equal(info.version, hash)
    assert.equal(info.source, 'git')
    assert.equal(info.required, true)
    assert.match(info.message, new RegExp(hash))
  })
})
