import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveActor, gitUserName, stripToolPrefix } from '../lib/actor.js'

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-actor-'))
  const home = await mkdtemp(path.join(os.tmpdir(), 'ptodo-home-'))
  try {
    await run(root, home)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
}

function fakeEnv(values = {}) {
  return { ...values }
}

test('explicit --by wins over env and git, but person still prefers git user.name', async () => {
  await withRoot(async (root, home) => {
    await mkdir(path.join(root, '.git'))
    await writeFile(path.join(root, '.git', 'config'), '[user]\n\tname = Alice\n', 'utf8')
    const info = resolveActor({ by: 'codex:alice', root, cwd: root, home, env: fakeEnv({ PTODO_ACTOR: 'env:alice' }) })
    assert.equal(info.actor, 'codex:alice')
    assert.equal(info.source, 'flag')
    assert.equal(info.hasPrefix, true)
    assert.equal(info.person, 'Alice')
    assert.equal(info.personSource, 'git')
  })
})

test('PTODO_ACTOR wins over git user.name for actor; git still wins for person', async () => {
  await withRoot(async (root, home) => {
    await mkdir(path.join(root, '.git'))
    await writeFile(path.join(root, '.git', 'config'), '[user]\n\tname = Alice\n', 'utf8')
    const info = resolveActor({ root, cwd: root, home, env: fakeEnv({ PTODO_ACTOR: 'workbuddy:alice' }) })
    assert.equal(info.actor, 'workbuddy:alice')
    assert.equal(info.source, 'env')
    assert.equal(info.person, 'Alice')
  })
})

test('person strips one <tool>: prefix when no git user.name exists', async () => {
  await withRoot(async (root, home) => {
    const flag = resolveActor({ by: 'codex:alice', root, cwd: root, home, env: fakeEnv() })
    assert.equal(flag.person, 'alice')
    assert.equal(flag.personSource, 'flag')
    const env = resolveActor({ root, cwd: root, home, env: fakeEnv({ PTODO_ACTOR: 'dsh:skill-portability' }) })
    assert.equal(env.actor, 'dsh:skill-portability')
    assert.equal(env.person, 'skill-portability')
    assert.equal(env.personSource, 'env')
    assert.equal(stripToolPrefix('a:b:c'), 'b:c')
    assert.equal(stripToolPrefix('alice'), 'alice')
    assert.equal(stripToolPrefix('a:'), 'a:')
  })
})

test('git user.name is read from .git/config without spawning git', async () => {
  await withRoot(async (root, home) => {
    await mkdir(path.join(root, '.git'))
    await writeFile(path.join(root, '.git', 'config'), '[remote "origin"]\n\turl = x\n[user]\n\tname = Bob\n', 'utf8')
    assert.equal(gitUserName(root, home), 'Bob')
    const info = resolveActor({ root, cwd: root, home, env: fakeEnv() })
    assert.equal(info.actor, 'Bob')
    assert.equal(info.source, 'git')
    assert.equal(info.hasPrefix, false)
    assert.equal(info.person, 'Bob')
    assert.equal(info.personSource, 'git')
  })
})

test('global ~/.gitconfig is used when the repository has no user.name', async () => {
  await withRoot(async (root, home) => {
    await writeFile(path.join(home, '.gitconfig'), '[user]\n\tname = GlobalUser\n', 'utf8')
    assert.equal(gitUserName(root, home), 'GlobalUser')
  })
})

test('worktree .git file and commondir are handled', async () => {
  await withRoot(async (root, home) => {
    const worktree = path.join(root, 'wt')
    const gitDir = path.join(root, 'repo-git', 'worktrees', 'wt')
    await mkdir(worktree, { recursive: true })
    await mkdir(gitDir, { recursive: true })
    await writeFile(path.join(worktree, '.git'), `gitdir: ${gitDir}\n`, 'utf8')
    await writeFile(path.join(gitDir, 'commondir'), '../..\n', 'utf8')
    await writeFile(path.join(root, 'repo-git', 'config'), '[user]\n\tname = WorktreeUser\n', 'utf8')
    assert.equal(gitUserName(worktree, home), 'WorktreeUser')
  })
})

test('session id and fallback are used when git name is absent', async () => {
  await withRoot(async (root, home) => {
    const session = resolveActor({ root, cwd: root, home, env: fakeEnv({ DSH_SESSION_ID: 'session-1' }) })
    assert.equal(session.actor, 'session-1')
    assert.equal(session.source, 'session')
    assert.equal(session.person, 'session-1')
    assert.equal(session.personSource, 'session')
    const fallback = resolveActor({ root, cwd: root, home, env: fakeEnv() })
    assert.equal(fallback.source, 'fallback')
    assert.match(fallback.actor, /^cli-/)
    assert.equal(fallback.person, fallback.actor)
  })
})
