import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const BIN = fileURLToPath(new URL('../bin/ptodo.mjs', import.meta.url))

function run(root, args) {
  return spawnSync(process.execPath, [BIN, '--root', root, ...args], { encoding: 'utf8', windowsHide: true })
}

function done(root, version) {
  const created = run(root, ['task', 'create', '--title', `任务 ${version}`, '--by', 'tester', '--json'])
  assert.equal(created.status, 0, created.stderr)
  const id = JSON.parse(created.stdout).task.id
  const started = run(root, ['task', 'start', id, '--by', 'tester'])
  assert.equal(started.status, 0, started.stderr)
  const finished = run(root, ['task', 'done', id, '--version', version, '--evidence', '测试', '--by', 'tester'])
  assert.equal(finished.status, 0, finished.stderr)
}

async function withRoot(runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-doctor-version-'))
  try {
    await runTest(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('doctor warns about missing version notes without failing', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    done(root, '1.2.3')
    const doctor = run(root, ['doctor'])
    assert.equal(doctor.status, 0, doctor.stderr)
    assert.match(doctor.stdout, /版本文档缺失/)
    assert.match(doctor.stdout, /1\.2\.3（1 个任务）/)
    assert.match(doctor.stdout, /建议在 .*docs[\\/]version 创建 1\.2\.3\.md/) // 两个候选目录都不存在时建议 docs/version

    await mkdir(path.join(root, 'docs', 'version'), { recursive: true })
    await writeFile(path.join(root, 'docs', 'version', '1.2.3.md'), '# 1.2.3\n', 'utf8')
    const after = run(root, ['doctor'])
    assert.equal(after.status, 0, after.stderr)
    assert.doesNotMatch(after.stdout, /版本文档缺失/)
    assert.match(after.stdout, /版本文档齐全/)
  })
})

test('doctor aggregates tasks sharing one version and ignores git hashes', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    done(root, '9.9.9')
    done(root, '9.9.9')
    done(root, '7149357')
    const doctor = run(root, ['doctor'])
    assert.equal(doctor.status, 0, doctor.stderr)
    assert.match(doctor.stdout, /9\.9\.9（2 个任务）/)
    assert.doesNotMatch(doctor.stdout, /7149357\.md/)
  })
})

test('doctor recommends an existing utp/docs/version and honours version.docDir', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    await mkdir(path.join(root, 'utp', 'docs', 'version'), { recursive: true })
    done(root, '3.0.0')
    const defaults = run(root, ['doctor'])
    assert.equal(defaults.status, 0, defaults.stderr)
    assert.match(defaults.stdout, /建议在 .*utp[\\/]docs[\\/]version 创建 3\.0\.0\.md/)

    await mkdir(path.join(root, 'docs', 'ptodo'), { recursive: true })
    await writeFile(
      path.join(root, 'docs', 'ptodo', 'config.json'),
      JSON.stringify({ version: { docDir: 'release-notes' } }),
      'utf8',
    )
    const custom = run(root, ['doctor'])
    assert.equal(custom.status, 0, custom.stderr)
    assert.match(custom.stdout, /建议在 .*release-notes 创建 3\.0\.0\.md/)
    assert.doesNotMatch(custom.stdout, /utp[\\/]docs[\\/]version/)
    // The default tree does not satisfy a custom docDir: only the custom file counts.
    await mkdir(path.join(root, 'utp', 'docs', 'version'), { recursive: true })
    await writeFile(path.join(root, 'utp', 'docs', 'version', '3.0.0.md'), '# 3.0.0\n', 'utf8')
    const stillMissing = run(root, ['doctor'])
    assert.match(stillMissing.stdout, /版本文档缺失/)
    await mkdir(path.join(root, 'release-notes'), { recursive: true })
    await writeFile(path.join(root, 'release-notes', '3.0.0.md'), '# 3.0.0\n', 'utf8')
    const fixed = run(root, ['doctor'])
    assert.doesNotMatch(fixed.stdout, /版本文档缺失/)
    assert.match(fixed.stdout, /版本文档齐全/)
  })
})

test('doctor lists at most three missing versions and omits the rest', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    for (const version of ['1.0.1', '1.0.2', '1.0.3', '1.0.4']) done(root, version)
    const doctor = run(root, ['doctor'])
    assert.equal(doctor.status, 0, doctor.stderr)
    assert.doesNotMatch(doctor.stdout, /1\.0\.4/)
    assert.match(doctor.stdout, /等 4 个版本/)
  })
})

test('a never-archived project reports the archive as normal, not a warning', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    const doctor = run(root, ['doctor'])
    assert.equal(doctor.status, 0, doctor.stderr)
    assert.doesNotMatch(doctor.stdout, /⚠ archive/)
    assert.match(doctor.stdout, /尚未归档，首次归档时创建/)
  })
})
