import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveProjectRoot, sessionCwdOf } from '../lib/project.js'

async function withRoot(runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-project-fallback-'))
  try {
    await runTest(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const sessionWith = (cwd) => ({ id: 'session-x', header: { cwd } })

test('a host without the workingDirectory service resolves from the Session header', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, '.git'))
    const ctx = { get: () => undefined }
    const session = sessionWith(path.join(root, 'sub'))
    assert.equal(sessionCwdOf(ctx, session), path.join(root, 'sub'))
    assert.equal(resolveProjectRoot(ctx, session), path.resolve(root))
  })
})

test('the workingDirectory service wins over the Session header', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, '.git'))
    const ctx = { get: (name) => (name === 'workingDirectory' ? { get: () => root } : undefined) }
    assert.equal(sessionCwdOf(ctx, sessionWith('C:/elsewhere')), root)
    assert.equal(resolveProjectRoot(ctx, sessionWith('C:/elsewhere')), path.resolve(root))
  })
})

test('a board above the session directory wins over the git root', async () => {
  await withRoot(async (root) => {
    const project = path.join(root, 'project')
    await mkdir(path.join(project, 'docs', 'ptodo'), { recursive: true })
    await mkdir(path.join(project, '.git'))
    const nested = path.join(project, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    const ctx = { get: () => undefined }
    assert.equal(resolveProjectRoot(ctx, sessionWith(nested)), path.resolve(project))
  })
})

test('no directory anywhere is an actionable NO_PROJECT', () => {
  const ctx = { get: () => undefined }
  assert.throws(
    () => resolveProjectRoot(ctx, { id: 'session-x', header: {} }),
    (error) => error.code === 'NO_PROJECT' && /工作目录/.test(error.message),
  )
})

test('a throwing workingDirectory service falls back instead of failing', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, '.git'))
    const ctx = {
      get: (name) => (name === 'workingDirectory' ? { get: () => { throw new Error('boom') } } : undefined),
    }
    assert.equal(resolveProjectRoot(ctx, sessionWith(root)), path.resolve(root))
  })
})
