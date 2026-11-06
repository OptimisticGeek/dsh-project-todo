import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../bin/ptodo.mjs', import.meta.url))

function cli(root, args, options = {}) {
  return spawnSync(process.execPath, [BIN, '--root', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  })
}

async function withRoot(options, runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-root-'))
  try {
    await runTest(root, options)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/**
 * Regression: an explicit `--root` with a typo used to silently create a whole
 * second board instead of failing. A write with no store must be refused.
 */
test('explicit --root without a store fails instead of creating a new board', async () => {
  await withRoot(null, async (unused) => {
    const root = path.join(unused, 'typo')
    const result = cli(root, ['task', 'create', '--title', '不该被创建'])
    assert.equal(result.status, 7)
    assert.match(result.stderr, /NO_PROJECT/)
    assert.match(result.stderr, /路径写错请修正 --root/)
    assert.equal(await directoryExists(root), false, 'no stray docs/ptodo was written')
  })
})

test('init is still allowed on an empty explicit --root', async () => {
  await withRoot(null, async (root) => {
    assert.equal(cli(root, ['init']).status, 0)
    const created = cli(root, ['task', 'create', '--title', '第一条'])
    assert.equal(created.status, 0, created.stderr)
    assert.match(created.stdout, /T-0001/)
  })
})

/** `person` must come from the target project's git repo, not the shell's cwd. */
test('person resolves from --root repository, not the shell cwd', async () => {
  await withRoot(null, async (unused) => {
    const cwdRepo = path.join(unused, 'shell-repo')
    const targetRepo = path.join(unused, 'target-repo')
    for (const [dir, name] of [
      [cwdRepo, 'ShellPerson'],
      [targetRepo, 'TargetPerson'],
    ]) {
      await mkdir(path.join(dir, '.git'), { recursive: true })
      await writeFile(path.join(dir, '.git', 'config'), `[user]\n\tname = ${name}\n`, 'utf8')
    }

    // Bootstrap is allowed on an empty explicit root.
    assert.equal(cli(targetRepo, ['init'], { cwd: cwdRepo }).status, 0)
    const who = cli(targetRepo, ['whoami', '--json'], { cwd: cwdRepo })
    assert.equal(who.status, 0, who.stderr)
    assert.equal(JSON.parse(who.stdout).person, 'TargetPerson')
  })
})

async function directoryExists(dir) {
  const { stat } = await import('node:fs/promises')
  try {
    await stat(dir)
    return true
  } catch {
    return false
  }
}
