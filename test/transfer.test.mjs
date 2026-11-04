import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTask, emptyArchive, emptyBoard } from '../lib/model.js'
import { TodoStore } from '../lib/store.js'
import { exportMarkdown, importRows, parseMarkdownRows } from '../lib/transfer.js'
import { buildXlsx, parseXlsx } from '../lib/xlsx.js'

const CONFIG = {
  store: { path: '.dsh/todos.json' },
  archive: { path: '.dsh/archive.json', afterDays: 3 },
  markdown: { enabled: true, path: '.dsh/TODO.md', archivePath: '.dsh/ARCHIVE.md', doneLimit: 20 },
  import: { source: '开发计划/todo/TODO.md' },
  batch: { claimLimit: 3 },
  history: { enabled: true },
  ui: { enabled: true, defaultTab: 'auto' },
}

test('Markdown export round-trips through parser and importRows', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-transfer-'))
  try {
    const board = emptyBoard('demo')
    createTask(board, { title: '导出任务', priority: 'P0', urgency: 5, tags: ['KB', '交付'], notes: '备注' })
    const state = { board, archived: [] }
    const text = exportMarkdown(state, 'active')
    const rows = parseMarkdownRows(text)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]['标题'], '导出任务')
    const store = new TodoStore(root, CONFIG)
    const result = await importRows(store, rows, { by: 'tester' })
    assert.equal(result.imported, 1)
    const imported = (await store.read()).tasks[0]
    assert.equal(imported.title, '导出任务')
    assert.equal(imported.priority, 'P0')
    assert.equal(imported.urgency, 5)
    assert.deepEqual(imported.tags.sort(), ['KB', '交付'])
    const again = await importRows(store, rows, { by: 'tester' })
    assert.equal(again.imported, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('XLSX export and parse use the Python helper', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-xlsx-'))
  try {
    const headers = ['ID', '标题', '标签']
    const rows = [{ ID: 'T-0001', 标题: '表格任务', 标签: 'KB、交付' }]
    const buffer = await buildXlsx({ headers, rows, sheet: 'todos' }, {})
    assert.ok(buffer.length > 100)
    const file = path.join(dir, 'out.xlsx')
    await writeFile(file, buffer)
    const parsed = await parseXlsx(file, {})
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0]['标题'], '表格任务')
    assert.equal(parsed[0]['标签'], 'KB、交付')
  } catch (error) {
    if (error.code === 'IO_ERROR') {
      // Environment without Python/openpyxl: the feature reports a clear error.
      return
    }
    throw error
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
