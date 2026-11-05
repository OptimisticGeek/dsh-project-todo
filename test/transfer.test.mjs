import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTask, emptyArchive, emptyBoard } from '../lib/model.js'
import { TodoStore } from '../lib/store.js'
import { exportMarkdown, importRows, parseMarkdownRows, rowsOf } from '../lib/transfer.js'
import { reportOf } from '../lib/report.js'
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

test('XLSX export and parse are pure JavaScript', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-xlsx-'))
  try {
    const headers = ['ID', '标题', '标签']
    const rows = [
      { ID: 'T-0001', 标题: '表格任务', 标签: 'KB、交付' },
      { ID: 'T-0002', 标题: '=SUM(A1:A2)', 标签: 'x' },
      { ID: 'T-0003', 标题: '\u0000带控制字符', 标签: '' },
    ]
    const buffer = await buildXlsx({ headers, rows, sheet: 'todos' })
    assert.equal(buffer.subarray(0, 2).toString(), 'PK')
    const file = path.join(dir, 'out.xlsx')
    await writeFile(file, buffer)
    const parsed = await parseXlsx(file)
    assert.equal(parsed.length, 3)
    assert.equal(parsed[0]['标题'], '表格任务')
    assert.equal(parsed[0]['标签'], 'KB、交付')
    // Formula-looking text stays text (inline strings are never evaluated).
    assert.equal(parsed[1]['标题'], '=SUM(A1:A2)')
    // Illegal XML control characters are stripped, not written raw.
    assert.equal(parsed[2]['标题'], '带控制字符')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dashboard export round-trips through the detail sheet', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-xlsx-report-'))
  try {
    const headers = ['ID', '标题', '状态', '优先级', '完成日']
    const rows = [{ ID: 'T-0001', 标题: '带看板导出', 状态: '已完成', 优先级: 'P0', 完成日: '2026-11-04T12:36:18.060Z' }]
    const report = {
      project: 'demo',
      revision: 3,
      generatedAt: new Date('2026-11-05T02:00:00.000Z'),
      scope: 'all',
      total: 1,
      done: 1,
      doing: 0,
      open: 0,
      blocked: 0,
      cancelled: 0,
      rate: 1,
      statuses: [
        { key: 'done', label: '已完成', count: 1 },
        { key: 'doing', label: '进行中', count: 0 },
        { key: 'open', label: '未开始', count: 0 },
        { key: 'blocked', label: '阻塞', count: 0 },
        { key: 'cancelled', label: '已取消', count: 0 },
      ],
      priorities: [{ key: 'P0', count: 1 }],
      milestones: [{ code: 'M-0001', name: '一阶段', done: 1, total: 1, percent: 1 }],
      tags: [{ code: 'KB', count: 1 }],
    }
    const buffer = await buildXlsx({ headers, rows, report })
    const file = path.join(dir, 'report.xlsx')
    await writeFile(file, buffer)
    const parsed = await parseXlsx(file)
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0]['标题'], '带看板导出')
    assert.match(parsed[0]['完成日'], /^2026-11-04 \d{2}:\d{2}$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('tag registry names are exported and restored to codes on import', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tags-'))
  try {
    const board = emptyBoard('demo')
    createTask(board, { title: '标签任务', tags: ['AUTH', 'ARCH'] })
    const tagRegistry = [
      { code: 'AUTH', name: '账号权限', aliases: ['权限'] },
      { code: 'ARCH', name: '代码架构', aliases: [] },
    ]
    const state = { board, archived: [], tags: tagRegistry }
    const rows = rowsOf(state, 'active')
    assert.equal(rows[0]['标签'], '账号权限、代码架构')
    const report = reportOf(state, 'active')
    assert.equal(report.tags.find((tag) => tag.code === 'AUTH').name, '账号权限')

    const store = new TodoStore(root, CONFIG)
    const result = await importRows(store, [{ 标题: '回导任务', 标签: '账号权限、代码架构、权限' }], {
      by: 'tester',
      tags: tagRegistry,
    })
    assert.equal(result.imported, 1)
    const imported = (await store.read()).tasks.find((task) => task.title === '回导任务')
    assert.deepEqual(imported.tags.sort(), ['ARCH', 'AUTH'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
