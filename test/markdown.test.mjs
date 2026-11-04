import test from 'node:test'
import assert from 'node:assert/strict'
import { claimTask, completeTask, createTask, deriveParents, emptyBoard, emptyArchive } from '../lib/model.js'
import { renderArchiveMarkdown, renderMarkdown } from '../lib/markdown.js'

const CONFIG = { markdown: { enabled: true, path: '.dsh/TODO.md', archivePath: '.dsh/ARCHIVE.md', doneLimit: 20 } }

test('active markdown is one table with tags, no group sections', () => {
  const board = emptyBoard('demo')
  createTask(board, { title: '父任务', priority: 'P0', urgency: 5, tags: ['KB'] })
  const childDone = createTask(board, { title: '已完成子任务', parentId: 'T-0001', priority: 'P1', urgency: 4, tags: ['KB'] })
  createTask(board, { title: '未开始子任务', parentId: 'T-0001', priority: 'P2', urgency: 3, tags: ['KB'] })
  createTask(board, { title: '智能体任务', priority: 'P5', urgency: 4, tags: ['AGENT'] })
  claimTask(board, childDone.id, 'a')
  completeTask(board, childDone.id, 'a')
  deriveParents(board)
  const text = renderMarkdown(board, CONFIG)
  assert.match(text, /\| ID \| 优先级 \| 紧急度 \| 状态 \| 任务 \| 标签 \|/)
  assert.match(text, /\| T-0001 \| P0 \| 非常紧急 \| 未开始 1\/2 \| 父任务 \| KB \|/)
  assert.match(text, /↳ T-0002 \| P1 \| 紧急 \| 已完成 \| 已完成子任务 \| KB \|/)
  assert.match(text, /\| T-0004 \| P5 \| 紧急 \| 未开始 \| 智能体任务 \| AGENT \|/)
  assert.doesNotMatch(text, /^## /m)
})

test('active markdown header routes agents to the skill instead of the raw JSON', () => {
  const board = emptyBoard('demo')
  createTask(board, { title: '随便一条', priority: 'P2', urgency: 3 })
  const text = renderMarkdown(board, CONFIG)
  // 实测发现：没有技能的 agent 会读这个文件、然后直接读 todos.json，绕过 G0-G4。
  // 头部必须给出唯一入口，并明确禁止「以读 JSON 代替认领」。
  assert.match(text, /工作入口/)
  assert.match(text, /project-todo/)
  assert.match(text, /ptodo task ready/)
  assert.match(text, /不要直接编辑/)
  assert.match(text, /以读 JSON 代替认领/)
  // 归档路径必须取配置，不能写死旧路径（本仓已从 .dsh 迁到 docs/ptodo）。
  const custom = renderMarkdown(board, {
    markdown: { enabled: true, path: 'docs/ptodo/TODO.md', archivePath: 'docs/ptodo/ARCHIVE.md', doneLimit: 20 },
  })
  assert.match(custom, /docs\/ptodo\/ARCHIVE\.md/)
  assert.doesNotMatch(custom, /\.dsh\/ARCHIVE\.md/)
})

test('archive markdown lists archived tasks separately', () => {
  const board = emptyBoard('demo')
  const task = createTask(board, { title: '归档任务', priority: 'P1', urgency: 3, tags: ['归档'] })
  claimTask(board, task.id, 'a')
  completeTask(board, task.id, 'a')
  const archive = emptyArchive('demo')
  archive.tasks.push({ ...task, archivedAt: new Date().toISOString(), archivedBy: 'manual' })
  archive.revision = 1
  const text = renderArchiveMarkdown(archive, CONFIG)
  assert.match(text, /# 已归档待办/)
  assert.match(text, /\| T-0001 \| P1 \| 普通 \| 归档任务 \| 归档 \|/)
  assert.match(text, /共 1 条/)
})
