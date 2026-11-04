import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TodoStore } from '../lib/store.js'
import { importLegacy, parseLegacyTodo } from '../lib/import.js'

const CONFIG = {
  store: { path: '.dsh/todos.json' },
  archive: { path: '.dsh/archive.json', afterDays: 3 },
  markdown: { enabled: true, path: '.dsh/TODO.md', archivePath: '.dsh/ARCHIVE.md', doneLimit: 20 },
  import: { source: '开发计划/todo/TODO.md' },
  batch: { claimLimit: 3 },
  history: { enabled: true },
  ui: { enabled: true, defaultTab: 'auto' },
}

const LEGACY = `# 待办

## \`KB\` 知识库线 —— 未完成 2/2

> 共享载体：同一套语料

| ID | 优先级 | 规模 | 任务 | 状态 | 持有 | 备注 |
|---|---|---|---|---|---|---|
| \`B-2-2_2\` | P1 | S | 模型对比服务接入 | 进行中 | wb-agent @15:54 |  |
| \`B-2-2_6\` | P2 | M | 精度与显存合并报表 | 待办 |  | 依赖 B-2-2_2 |
`

test('parses legacy rows with group, holder and priority', () => {
  const rows = parseLegacyTodo(LEGACY)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, 'B-2-2_2')
  assert.equal(rows[0].group, 'KB')
  assert.equal(rows[0].priority, 'P1')
  assert.equal(rows[1].status, '待办')
})

test('import is idempotent, maps status/holder and turns group into tag', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-import-'))
  try {
    await mkdir(path.join(root, '开发计划', 'todo'), { recursive: true })
    await writeFile(path.join(root, '开发计划', 'todo', 'TODO.md'), LEGACY, 'utf8')
    const store = new TodoStore(root, CONFIG)

    const preview = await importLegacy(store, CONFIG, root, { dryRun: true })
    assert.equal(preview.willImport, 2)

    const first = await importLegacy(store, CONFIG, root, {})
    assert.equal(first.imported, 2)
    const board = await store.read()
    assert.equal(board.tasks.length, 2)
    const doing = board.tasks.find((task) => task.legacyId === 'B-2-2_2')
    assert.equal(doing.status, 'doing')
    assert.equal(doing.holder, 'wb-agent')
    assert.deepEqual(doing.tags, ['KB'])

    const second = await importLegacy(store, CONFIG, root, {})
    assert.equal(second.imported, 0)
    assert.equal(second.skipped, 2)
    assert.equal((await store.read()).tasks.length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
