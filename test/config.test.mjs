import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { configFor, normalizeConfig, pathsOf } from '../lib/config.js'
import { resolveProjectRootFromCwd } from '../lib/project.js'
import { shortHashFromGitDir } from '../lib/version.js'

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-config-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('defaults point at docs/ptodo and keep snapshots in .dsh', () => {
  const config = normalizeConfig({})
  assert.equal(config.store.path, 'docs/ptodo/todos.json')
  assert.equal(config.archive.path, 'docs/ptodo/archive.json')
  assert.equal(config.history.path, 'docs/ptodo/todos.history.jsonl')
  assert.equal(config.markdown.path, '.dsh/TODO.md')
  assert.equal(config.markdown.archivePath, '.dsh/ARCHIVE.md')
  assert.equal(config.version.docDir, '')
  const paths = pathsOf('E:/demo', config)
  assert.match(paths.store, /docs[\\/]ptodo[\\/]todos\.json$/)
})

test('version.docDir is kept as a project-relative string', async () => {
  await withRoot(async (root) => {
    assert.equal(normalizeConfig({ version: { docDir: 'release/notes' } }).version.docDir, 'release/notes')
    assert.equal(normalizeConfig({ version: { docDir: '  release/notes  ' } }).version.docDir, 'release/notes')
    assert.equal(normalizeConfig({ version: { docDir: 42 } }).version.docDir, '')
    await mkdir(path.join(root, 'docs', 'ptodo'), { recursive: true })
    await writeFile(
      path.join(root, 'docs', 'ptodo', 'config.json'),
      JSON.stringify({ version: { docDir: 'utp/docs/version' } }),
      'utf8',
    )
    assert.equal(configFor(root, {}).version.docDir, 'utp/docs/version')
    assert.equal(configFor(root, { version: { docDir: 'custom/notes' } }).version.docDir, 'custom/notes')
  })
})

test('configFor merges docs/ptodo/config.json under defaults', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, 'docs', 'ptodo'), { recursive: true })
    await writeFile(
      path.join(root, 'docs', 'ptodo', 'config.json'),
      JSON.stringify({ archive: { afterDays: 0 }, batch: { claimLimit: 5 } }),
      'utf8',
    )
    const config = configFor(root, {})
    assert.equal(config.archive.afterDays, 0)
    assert.equal(config.batch.claimLimit, 5)
    assert.equal(config.store.path, 'docs/ptodo/todos.json')
  })
})

test('root resolution prefers a board over a nested git repository', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, 'docs', 'ptodo'), { recursive: true })
    await writeFile(path.join(root, 'docs', 'ptodo', 'todos.json'), '{}', 'utf8')
    const nested = path.join(root, 'utp', 'src')
    await mkdir(nested, { recursive: true })
    await mkdir(path.join(root, 'utp', '.git'), { recursive: true })
    assert.equal(resolveProjectRootFromCwd(nested), path.resolve(root))
  })
})

test('root resolution falls back to the nearest git root without a board', async () => {
  await withRoot(async (root) => {
    const repo = path.join(root, 'repo')
    await mkdir(path.join(repo, '.git'), { recursive: true })
    const nested = path.join(repo, 'src')
    await mkdir(nested, { recursive: true })
    assert.equal(resolveProjectRootFromCwd(nested), repo)
  })
})

test('pure git resolver reads loose refs and packed-refs without spawning', async () => {
  await withRoot(async (root) => {
    const loose = path.join(root, 'loose')
    await mkdir(path.join(loose, '.git', 'refs', 'heads'), { recursive: true })
    const sha = 'a'.repeat(40)
    await writeFile(path.join(loose, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
    await writeFile(path.join(loose, '.git', 'refs', 'heads', 'main'), `${sha}\n`, 'utf8')
    assert.equal(shortHashFromGitDir(loose), 'aaaaaaa')

    const packed = path.join(root, 'packed')
    await mkdir(path.join(packed, '.git'), { recursive: true })
    const packedSha = 'b'.repeat(40)
    await writeFile(path.join(packed, '.git', 'HEAD'), 'ref: refs/heads/feature\n', 'utf8')
    await writeFile(path.join(packed, '.git', 'packed-refs'), `# pack-refs\n${packedSha} refs/heads/feature\n`, 'utf8')
    assert.equal(shortHashFromGitDir(packed), 'bbbbbbb')

    const gitFile = path.join(root, 'gitfile')
    const realGit = path.join(root, 'real-git')
    await mkdir(path.join(realGit, 'refs', 'heads'), { recursive: true })
    const detached = 'c'.repeat(40)
    await writeFile(path.join(realGit, 'HEAD'), `${detached}\n`, 'utf8')
    await mkdir(gitFile, { recursive: true })
    await writeFile(path.join(gitFile, '.git'), `gitdir: ${realGit}\n`, 'utf8')
    assert.equal(shortHashFromGitDir(gitFile), 'ccccccc')

    assert.equal(shortHashFromGitDir(path.join(root, 'missing')), '')
  })
})
