/**
 * Markdown / Excel transfer. Export is a flat table (no tree dependency) and
 * import accepts the same columns, so round-tripping works.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as model from './model.js'
import { buildXlsx, parseXlsx } from './xlsx.js'
import { orgStoreFor } from './org.js'
import { fail } from './model.js'

export const EXPORT_HEADERS = [
  'ID',
  '标题',
  '状态',
  '优先级',
  '紧急度',
  '标签',
  '持有',
  '备注',
  '父ID',
  '阶段',
  '里程碑',
  '完成日',
  '归档日',
  '版本',
  '证据',
]
const HEADER_ALIASES = {
  id: ['id', '编号', '任务id', '任务 id'],
  title: ['标题', '任务', '任务标题', 'title', 'task'],
  status: ['状态', 'status'],
  priority: ['优先级', 'priority'],
  urgency: ['紧急度', '紧急程度', 'urgency'],
  tags: ['标签', 'tags', 'tag'],
  group: ['分组', 'group'],
  holder: ['持有', '持有者', 'holder', '负责人'],
  notes: ['备注', 'notes', '说明'],
  parent: ['父id', '父任务', 'parentid', 'parent'],
  stage: ['阶段', 'stage', 'stagecode'],
  milestone: ['里程碑', 'milestone'],
  doneAt: ['完成日', '完成时间', 'doneat', 'done'],
  archivedAt: ['归档日', '归档时间', 'archivedat'],
  version: ['版本', 'version'],
  evidence: ['证据', 'evidence'],
}

const STATUS_MAP = {
  未开始: 'open',
  待办: 'open',
  open: 'open',
  进行中: 'doing',
  doing: 'doing',
  已完成: 'done',
  done: 'done',
  阻塞: 'blocked',
  blocked: 'blocked',
  已取消: 'cancelled',
  cancelled: 'cancelled',
}

const URGENCY_MAP = {
  非常紧急: 5,
  紧急: 4,
  普通: 3,
  不紧急: 2,
  可延后: 1,
}

function cell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
}

function splitTags(value) {
  return String(value || '')
    .split(/[,，、;；]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function tasksOfScope(state, scope) {
  if (scope === 'archive') return [...state.archived]
  if (scope === 'all') return [...state.board.tasks, ...state.archived]
  return [...state.board.tasks]
}

function stageOf(state, code) {
  const stages = state.stages || []
  return stages.find((stage) => stage.code === code) || null
}

export function rowsOf(state, scope) {
  return tasksOfScope(state, scope).map((task) => {
    const stage = stageOf(state, task.stageCode)
    const milestone = stage ? (state.milestones || []).find((entry) => entry.code === stage.milestoneCode) : null
    return {
      ID: task.id,
      标题: task.title,
      状态: model.STATUS_LABELS[task.status] || task.status,
      优先级: task.priority,
      紧急度: model.URGENCY_LABELS[task.urgency] || String(task.urgency),
      标签: (task.tags || []).join('、'),
      持有: task.holder || '',
      备注: task.notes || '',
      父ID: task.parentId || '',
      阶段: stage ? `${stage.code} ${stage.name}` : task.stageCode || '',
      里程碑: milestone ? `${milestone.code} ${milestone.name}` : '',
      完成日: task.doneAt || '',
      归档日: task.archivedAt || '',
      版本: task.doneVersion || '',
      证据: task.doneEvidence || '',
    }
  })
}

export function exportMarkdown(state, scope) {
  const rows = rowsOf(state, scope)
  const lines = []
  lines.push('# 待办导出')
  lines.push('')
  lines.push(`> 由 dsh-project-todo / ptodo 导出（${new Date().toLocaleString('zh-CN', { hour12: false })}），可直接用 ptodo admin import-file 导回。`)
  lines.push('')
  lines.push(`| ${EXPORT_HEADERS.join(' | ')} |`)
  lines.push(`|${EXPORT_HEADERS.map(() => '---').join('|')}|`)
  for (const row of rows) {
    lines.push(`| ${EXPORT_HEADERS.map((header) => cell(row[header])).join(' | ')} |`)
  }
  lines.push('')
  return lines.join('\n')
}

export async function exportData(state, scope, format, config) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
  if (format === 'xlsx') {
    const data = await buildXlsx({ headers: EXPORT_HEADERS, rows: rowsOf(state, scope), sheet: 'todos' }, config)
    return { filename: `todos-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data }
  }
  return { filename: `todos-${stamp}.md`, contentType: 'text/markdown; charset=utf-8', data: exportMarkdown(state, scope) }
}

/** Parse a Markdown table produced by exportMarkdown (or a legacy table). */
export function parseMarkdownRows(text) {
  const lines = String(text || '').split(/\r?\n/)
  const rows = []
  let headers = null
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .replace(/\\\|/g, '¦')
      .split('|')
      .map((value) => value.replace(/¦/g, '|').trim())
    if (!headers) {
      if (cells.some((cellValue) => /标题|任务|title/i.test(cellValue))) headers = cells
      continue
    }
    if (cells.every((cellValue) => /^:?-{2,}:?$/.test(cellValue))) continue
    const row = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] === undefined ? '' : cells[index]
    })
    if (Object.values(row).some((value) => String(value).trim())) rows.push(row)
  }
  if (!headers) fail('PARSE_ERROR', '没有找到表头（需要包含「标题」或「任务」列）')
  return rows
}

function pick(row, field) {
  const aliases = HEADER_ALIASES[field] || []
  for (const [key, value] of Object.entries(row)) {
    const normalized = String(key).trim().toLowerCase()
    if (aliases.includes(normalized)) return String(value == null ? '' : value).trim()
  }
  return ''
}

function normalizePriority(value) {
  const text = String(value || '').trim()
  if (/^P[0-5]$/i.test(text)) return text.toUpperCase()
  if (/^[0-5]$/.test(text)) return `P${text}`
  const labels = { 最高: 'P0', 高: 'P1', 中: 'P2', 低: 'P3' }
  return labels[text] || 'P2'
}

function normalizeUrgency(value) {
  const text = String(value || '').trim()
  if (URGENCY_MAP[text]) return URGENCY_MAP[text]
  const number = Number.parseInt(text, 10)
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : 3
}

function normalizeStatus(value) {
  return STATUS_MAP[String(value || '').trim()] || 'open'
}

function normalizeDate(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Resolve an imported stage cell (code or name) to a stage code. */
function resolveStageCode(value, org) {
  const text = String(value || '').trim()
  if (!text) return 'default'
  const stages = org?.stages || []
  const byCode = stages.find((stage) => stage.code === text)
  if (byCode) return byCode.code
  const byName = stages.find((stage) => stage.name === text)
  if (byName) return byName.code
  // "S-0001 未分类" style cells: take the first token.
  const token = text.split(/\s+/)[0]
  if (stages.some((stage) => stage.code === token)) return token
  return 'default'
}

/**
 * Create tasks from flat rows. Skips rows whose ID/legacyId/title already exist.
 * @returns {Promise<{imported:number, skipped:number, dryRun:boolean, board?:object}>}
 */
export async function importRows(store, rows, options = {}) {
  const board = await store.read()
  const existingIds = new Set(board.tasks.map((task) => task.id))
  const existingLegacy = new Set(board.tasks.map((task) => task.legacyId).filter(Boolean))
  const existingTitles = new Set(board.tasks.map((task) => task.title.toLowerCase()))
  const prepared = []
  const skipped = []
  for (const row of rows) {
    const title = pick(row, 'title')
    if (!title) {
      skipped.push({ reason: '缺少标题' })
      continue
    }
    const externalId = pick(row, 'id')
    if (externalId && (existingIds.has(externalId) || existingLegacy.has(externalId))) {
      skipped.push({ id: externalId, reason: '已存在' })
      continue
    }
    if (existingTitles.has(title.toLowerCase())) {
      skipped.push({ title, reason: '同名任务已存在' })
      continue
    }
    const tags = splitTags(pick(row, 'tags'))
    const group = pick(row, 'group')
    if (group && !tags.includes(group)) tags.push(group)
    prepared.push({
      externalId,
      parentExternalId: pick(row, 'parent'),
      title,
      status: normalizeStatus(pick(row, 'status')),
      priority: normalizePriority(pick(row, 'priority')),
      urgency: normalizeUrgency(pick(row, 'urgency')),
      tags,
      stageCode: resolveStageCode(pick(row, 'stage'), options.org),
      holder: pick(row, 'holder'),
      notes: pick(row, 'notes'),
      doneAt: normalizeDate(pick(row, 'doneAt')),
      version: pick(row, 'version'),
      evidence: pick(row, 'evidence'),
    })
  }
  if (options.dryRun) return { imported: prepared.length, skipped: skipped.length, dryRun: true }
  if (!prepared.length) return { imported: 0, skipped: skipped.length, dryRun: false, board }
  let mutated
  try {
    mutated = await store.mutate('import', options.by || 'import', (current) => {
      const byExternal = new Map()
      const changedTasks = []
      for (const row of prepared) {
        const task = model.createTask(current, {
          title: row.title,
          priority: row.priority,
          urgency: row.urgency,
          tags: row.tags,
          notes: row.notes,
          legacyId: row.externalId || null,
          stageCode: row.stageCode || 'default',
        })
        if (row.status === 'doing') {
          task.status = 'doing'
          task.holder = row.holder || options.by || 'import'
          task.claimedAt = model.nowIso()
          task.statusChangedAt = model.nowIso()
        } else if (row.status === 'done') {
          task.status = 'done'
          task.doneAt = row.doneAt || model.nowIso()
          task.doneVersion = row.version || null
          task.doneEvidence = row.evidence || null
          task.statusChangedAt = model.nowIso()
        } else if (row.status === 'blocked') {
          task.status = 'blocked'
          task.statusChangedAt = model.nowIso()
        } else if (row.status === 'cancelled') {
          task.status = 'cancelled'
          task.statusChangedAt = model.nowIso()
        }
        if (row.externalId) byExternal.set(row.externalId, task.id)
        changedTasks.push(task.id)
      }
      for (const row of prepared) {
        const parentId = row.parentExternalId
          ? byExternal.get(row.parentExternalId) || (existingIds.has(row.parentExternalId) ? row.parentExternalId : null)
          : null
        if (!parentId) continue
        const task = current.tasks.find((candidate) => candidate.id === (row.externalId ? byExternal.get(row.externalId) : null))
        if (task) task.parentId = parentId
      }
      return { changedTasks }
    })
  } catch (error) {
    if (error.code === 'INVALID' || error.code === 'CONFLICT' || error.code === 'NOT_FOUND') throw error
    throw error
  }
  return { imported: prepared.length, skipped: skipped.length, dryRun: false, board: mutated.board, warning: mutated.warning }
}

/** Import from a concrete file path. */
export async function importFromFile(store, config, file, options = {}) {
  const format = options.format || (String(file).toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'md')
  const org = options.org || (await orgStoreFor(store.root || process.cwd(), config).read())
  if (format === 'xlsx') {
    const rows = await parseXlsx(file, config)
    return importRows(store, rows, { ...options, org })
  }
  const text = await readFile(file, 'utf8')
  return importRows(store, parseMarkdownRows(text), { ...options, org })
}

/** Resolve a user-provided path against the project root. */
export function resolveProjectPath(root, file) {
  return path.isAbsolute(file) ? file : path.resolve(root, file)
}
