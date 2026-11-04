import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../bin/ptodo.mjs', import.meta.url))

function run(root, args) {
  return spawnSync(process.execPath, [BIN, '--root', root, ...args], { encoding: 'utf8', windowsHide: true })
}

async function withRoot(runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-migrate-'))
  try {
    await runTest(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function v2Board() {
  return {
    version: 2,
    project: 'demo',
    nextId: 3,
    revision: 9,
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        id: 'T-0001',
        legacyId: 'A-1',
        parentId: null,
        title: '旧任务',
        status: 'open',
        priority: 'P1',
        urgency: 3,
        holder: null,
        size: 'M',
        notes: '',
        tags: ['REQ'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        statusChangedAt: '2026-01-01T00:00:00.000Z',
        claimedAt: null,
        archivedAt: null,
        archiveExempt: false,
        doneAt: null,
        doneVersion: null,
        doneEvidence: null,
      },
    ],
  }
}

test('in-place v2 → v3 migration backs up and preserves revision/nextId', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, 'docs', 'ptodo'), { recursive: true })
    const file = path.join(root, 'docs', 'ptodo', 'todos.json')
    await writeFile(file, JSON.stringify(v2Board()), 'utf8')

    const dry = run(root, ['migrate', '--dry-run', '--json'])
    assert.equal(dry.status, 0, dry.stderr)
    assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 2)

    const migrated = run(root, ['migrate', '--json'])
    assert.equal(migrated.status, 0, migrated.stderr)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.version, 3)
    assert.equal(saved.revision, 9)
    assert.equal(saved.nextId, 3)
    assert.equal(saved.tasks[0].stageCode, 'default')
    assert.equal(saved.tasks[0].legacyId, 'A-1')
    assert.ok(existsSync(path.join(root, 'docs', 'ptodo', 'milestones.json')))
    assert.ok(existsSync(path.join(root, 'docs', 'ptodo', 'tags.json')))
    assert.ok(existsSync(path.join(root, 'docs', 'ptodo', '.backup')))
  })
})

test('migrate is idempotent once the board is v3', async () => {
  await withRoot(async (root) => {
    assert.equal(run(root, ['init']).status, 0)
    const first = run(root, ['migrate', '--json'])
    assert.equal(first.status, 0, first.stderr)
    assert.equal(JSON.parse(first.stdout).migrated, false)
    const second = run(root, ['migrate', '--json'])
    assert.equal(second.status, 0, second.stderr)
    assert.equal(JSON.parse(second.stdout).migrated, false)
  })
})
