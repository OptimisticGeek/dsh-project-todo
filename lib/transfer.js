/**
 * Markdown / Excel / JSON transfer.
 *
 * md and xlsx are flat tables (human-facing). JSON is the structured channel for
 * scripts and agents: full task records, `dependsOn` as an id array, and an
 * idempotent merge on import (same id ⇒ update instead of duplicate). Every
 * import row reports its own outcome so a batch never fails silently.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as model from './model.js'
import { buildXlsx, parseXlsx } from './xlsx.js'
import { reportOf } from './report.js'
import { orgStoreFor } from './org.js'
import { tagStoreFor } from './tags.js'
import { fail } from './model.js'
import { renderHtml } from './html-report.js'

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

/**
 * Tag registry lookups. The board stores tag *codes*; the UI and the export
 * show the registry `name` (falling back to the code when a tag has never been
 * translated). Import goes the other way, so a workbook that carries Chinese
 * names still restores the original codes.
 */
function tagNameMap(state) {
  const map = new Map()
  for (const tag of state.tags || []) map.set(tag.code, tag.name || tag.code)
  return map
}

function tagResolver(registry) {
  const map = new Map()
  for (const tag of registry || []) {
    const code = String(tag.code || '').trim()
    if (!code) continue
    map.set(code.toLowerCase(), code)
    if (tag.name) map.set(String(tag.name).trim().toLowerCase(), code)
    for (const alias of tag.aliases || []) {
      const text = String(alias).trim().toLowerCase()
      if (text) map.set(text, code)
    }
  }
  return (token) => {
    const text = String(token || '').trim()
    return map.get(text.toLowerCase()) || text
  }
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
  const names = tagNameMap(state)
  return tasksOfScope(state, scope).map((task) => {
    const stage = stageOf(state, task.stageCode)
    const milestone = stage ? (state.milestones || []).find((entry) => entry.code === stage.milestoneCode) : null
    return {
      ID: task.id,
      标题: task.title,
      状态: model.STATUS_LABELS[task.status] || task.status,
      优先级: task.priority,
      紧急度: model.URGENCY_LABELS[task.urgency] || String(task.urgency),
      标签: (task.tags || []).map((code) => names.get(code) || code).join('、'),
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

export async function exportData(state, scope, format, config, options = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
  if (format === 'html') {
    return {
      filename: `todos-${stamp}.html`,
      contentType: 'text/html; charset=utf-8',
      data: await renderHtml(state, scope, options),
    }
  }
  if (format === 'json') {
    return {
      filename: `todos-${stamp}.json`,
      contentType: 'application/json; charset=utf-8',
      data: `${JSON.stringify(exportJson(state, scope), null, 2)}\n`,
    }
  }
  if (format === 'xlsx') {
    const data = await buildXlsx({
      headers: EXPORT_HEADERS,
      rows: rowsOf(state, scope),
      sheet: 'todos',
      report: reportOf(state, scope),
    })
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
  const resolveTag = tagResolver(options.tags)
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
    const tags = splitTags(pick(row, 'tags')).map(resolveTag)
    const group = resolveTag(pick(row, 'group'))
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
  const lower = String(file).toLowerCase()
  const format = options.format || (lower.endsWith('.xlsx') ? 'xlsx' : lower.endsWith('.json') ? 'json' : 'md')
  const root = store.root || process.cwd()
  const org = options.org || (await orgStoreFor(root, config).read())
  const tags = options.tags || (await tagStoreFor(root, config).read()).tags || []
  if (format === 'json') {
    const text = await readFile(file, 'utf8')
    return importJsonRows(store, parseJsonTasks(text), { ...options, org, tags })
  }
  if (format === 'xlsx') {
    const rows = await parseXlsx(file, config)
    return importRows(store, rows, { ...options, org, tags })
  }
  const text = await readFile(file, 'utf8')
  return importRows(store, parseMarkdownRows(text), { ...options, org, tags })
}

/** Resolve a user-provided path against the project root. */
export function resolveProjectPath(root, file) {
  return path.isAbsolute(file) ? file : path.resolve(root, file)
}

/* ------------------------------------------------------------------- JSON */

export const JSON_EXPORT_KIND = 'ptodo.tasks'
export const JSON_EXPORT_SCHEMA = 1

/** Fields a JSON import is allowed to patch on an existing task. */
const JSON_MUTABLE = ['title', 'notes', 'priority', 'urgency', 'tags', 'stageCode', 'parentId', 'holder', 'role']

/**
 * Structured export: one record per task, `dependsOn` as an id array.
 *
 * `dependsOn` stays a plain id array (the table format already exposes the
 * detail); `dependsOnDetail` carries type/note for round-tripping.
 */
export function exportJson(state, scope) {
  const stages = state.stages || []
  const tasks = tasksOfScope(state, scope).map((task) => {
    const stage = stages.find((entry) => entry.code === task.stageCode) || null
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      effectiveStatus: task.effectiveStatus || task.status,
      priority: task.priority,
      urgency: task.urgency,
      tags: [...(task.tags || [])],
      stageCode: task.stageCode || model.DEFAULT_STAGE,
      milestoneCode: stage ? stage.milestoneCode : null,
      parentId: task.parentId || null,
      holder: task.holder || null,
      // Only explicit containers are emitted; `role: 'task'` on every row would
      // make a re-import look like a change on every task.
      ...(task.role === 'container' ? { role: 'container' } : {}),
      notes: task.notes || '',
      dependsOn: (task.dependsOn || []).map((dep) => dep.id),
      dependsOnDetail: (task.dependsOn || []).map((dep) => ({ id: dep.id, type: dep.type || 'hard', note: dep.note || '' })),
      context: {
        goal: task.context?.goal || '',
        progress: task.context?.progress || '',
        decisions: (task.context?.decisions || []).map((entry) => ({ text: entry.text, by: entry.by || null, at: entry.at || null })),
        openLoops: (task.context?.openLoops || []).map((entry) => ({ text: entry.text, by: entry.by || null, at: entry.at || null })),
      },
      doneAt: task.doneAt || null,
      doneVersion: task.doneVersion || null,
      doneEvidence: task.doneEvidence || null,
      createdAt: task.createdAt || null,
      updatedAt: task.updatedAt || null,
      statusChangedAt: task.statusChangedAt || null,
    }
  })
  return {
    kind: JSON_EXPORT_KIND,
    schema: JSON_EXPORT_SCHEMA,
    exportedAt: model.nowIso(),
    project: state.board.project || null,
    revision: state.board.revision,
    scope,
    count: tasks.length,
    tasks,
  }
}

/** Accept `{tasks: [...]}` or a bare array; anything else is a parse error. */
export function parseJsonTasks(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text || ''))
  } catch (error) {
    fail('PARSE_ERROR', `JSON 解析失败：${error.message}`)
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tasks) ? parsed.tasks : null
  if (!list) fail('PARSE_ERROR', 'JSON 需要是任务数组，或含 tasks 数组的对象')
  return list.filter((row) => row && typeof row === 'object' && !Array.isArray(row))
}

function normalizeJsonRow(raw) {
  const row = {}
  if (raw.id !== undefined && raw.id !== null && String(raw.id).trim()) row.id = String(raw.id).trim()
  if (raw.title !== undefined) row.title = String(raw.title).trim()
  if (raw.notes !== undefined) row.notes = String(raw.notes ?? '')
  if (raw.priority !== undefined) row.priority = String(raw.priority).toUpperCase()
  if (raw.urgency !== undefined) row.urgency = Number(raw.urgency)
  if (raw.tags !== undefined) {
    const source = Array.isArray(raw.tags) ? raw.tags : String(raw.tags).split(/[,，、;；]/)
    row.tags = source.map((tag) => String(tag).trim()).filter(Boolean)
  }
  if (raw.stageCode !== undefined) row.stageCode = String(raw.stageCode || model.DEFAULT_STAGE)
  if (raw.stage !== undefined && row.stageCode === undefined) row.stageCode = String(raw.stage || model.DEFAULT_STAGE)
  if (raw.parentId !== undefined) row.parentId = raw.parentId === null || raw.parentId === '' ? null : String(raw.parentId)
  if (raw.holder !== undefined) row.holder = raw.holder === null || String(raw.holder).trim() === '' ? null : String(raw.holder).trim()
  if (raw.status !== undefined) row.status = String(raw.status)
  if (raw.doneVersion !== undefined) row.doneVersion = raw.doneVersion === null ? null : String(raw.doneVersion)
  if (raw.doneEvidence !== undefined) row.doneEvidence = raw.doneEvidence === null ? null : String(raw.doneEvidence)
  if (raw.dependsOn !== undefined) row.dependsOn = Array.isArray(raw.dependsOn) ? raw.dependsOn.map(String) : []
  if (Array.isArray(raw.dependsOnDetail)) {
    row.dependsOnDetail = new Map(raw.dependsOnDetail.filter(Boolean).map((entry) => [String(entry.id), entry]))
  }
  if (raw.role === 'container') row.role = 'container'
  else if (raw.role === 'task' || raw.role === null) row.role = null
  if (raw.context && typeof raw.context === 'object') row.context = raw.context
  return row
}

function rowProblem(row) {
  if (row.title !== undefined && !row.title) return '标题不能为空'
  if (row.priority !== undefined && !model.PRIORITIES.includes(row.priority)) return `优先级非法：${row.priority}`
  if (row.urgency !== undefined && (!Number.isInteger(row.urgency) || row.urgency < 1 || row.urgency > 5)) {
    return `紧急度必须是 1..5 的整数：${row.urgency}`
  }
  if (row.stageCode !== undefined && !model.STAGE_CODE_RE.test(row.stageCode)) return `阶段编码非法：${row.stageCode}`
  if (row.status !== undefined && !model.STATUSES.includes(row.status)) return `状态非法：${row.status}`
  return null
}

function sameValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left || []) === JSON.stringify(right || [])
  return (left ?? null) === (right ?? null)
}

/** Which patch fields actually differ from the stored task. */
function changedFieldsOf(task, patch) {
  return Object.entries(patch)
    .filter(([field, value]) => !sameValue(task[field], value))
    .map(([field]) => field)
}

/** Decisions in `context` that the task does not have yet (matched by text). */
function newDecisionsOf(task, context) {
  const incoming = Array.isArray(context?.decisions) ? context.decisions : []
  const existing = new Set((task.context?.decisions || []).map((entry) => String(entry.text || '').trim()))
  return incoming
    .map((entry) => (typeof entry === 'string' ? { text: entry } : entry))
    .filter((entry) => entry && String(entry.text || '').trim())
    .filter((entry) => !existing.has(String(entry.text).trim()))
}

/**
 * Decide what each row would do, without mutating. Returned `results` are the
 * per-row report; `actions` drive the actual write.
 *
 * Matching: by task id, then by legacyId (an id imported from another project).
 */
export function planJsonImport(board, rows, options = {}) {
  const byId = new Map(board.tasks.map((task) => [task.id, task]))
  const byLegacy = new Map(board.tasks.filter((task) => task.legacyId).map((task) => [task.legacyId, task]))
  const actions = []
  const results = []
  /** One entry per input row, so pass two can escalate an `unchanged` row. */
  const pairs = []
  const resolvable = new Set(byId.keys())
  let predicted = Number(board.nextId) || 1

  for (const raw of rows) {
    const row = normalizeJsonRow(raw)
    const problem = rowProblem(row)
    const result = { id: row.id || null, title: row.title || '' }
    const push = (entry) => {
      pairs.push({ row, result, entry })
      results.push(result)
      if (entry) actions.push(entry)
    }
    if (problem) {
      Object.assign(result, { result: 'failed', reason: problem })
      push(null)
      continue
    }
    // `--create-only` skips id matching entirely: use it when copying rows from
    // another project, where the same id means a different task.
    const existing = row.id && !options.createOnly ? byId.get(row.id) || byLegacy.get(row.id) || null : null
    if (existing) {
      const patch = {}
      for (const field of JSON_MUTABLE) if (row[field] !== undefined) patch[field] = row[field]
      const fields = changedFieldsOf(existing, patch)
      const decisions = newDecisionsOf(existing, row.context)
      if (!fields.length && !decisions.length) {
        Object.assign(result, { id: existing.id, result: 'unchanged' })
        push(null)
        continue
      }
      const entry = {
        kind: 'update',
        row,
        targetId: existing.id,
        patch,
        decisions: decisions.length ? decisions : null,
        changed: [...fields, ...(decisions.length ? ['context.decisions'] : [])],
        resultIndex: results.length,
      }
      Object.assign(result, {
        id: existing.id,
        title: row.title || existing.title,
        result: 'updated',
        changes: [...entry.changed],
      })
      push(entry)
      continue
    }
    if (!row.title) {
      Object.assign(result, { result: 'failed', reason: '新建任务必须有 title' })
      push(null)
      continue
    }
    if (row.id) resolvable.add(row.id)
    // Code is allocated by the board, so the report shows the predicted code
    // (dry-run) or the real one (rewritten after the write) plus the external id.
    const predictedId = `T-${String(predicted).padStart(4, '0')}`
    predicted += 1
    const entry = { kind: 'create', row, resultIndex: results.length }
    Object.assign(result, {
      id: predictedId,
      externalId: row.id && row.id !== predictedId ? row.id : undefined,
      result: 'created',
    })
    push(entry)
  }

  // Pass two: dependencies. A row whose only change is a new dependency must
  // still become an action, otherwise the dependency would be silently dropped.
  for (const { row, result, entry } of pairs) {
    if (result.result === 'failed') continue
    const refs = row.dependsOn || []
    if (!refs.length) continue
    const missing = refs.filter((ref) => !resolvable.has(ref))
    if (missing.length) result.missingDeps = missing
    // Even an `unchanged` row has a stored task whose deps must be compared.
    const storedTask = byId.get(entry ? entry.targetId : result.id)
    const stored = (storedTask?.dependsOn || []).map((dep) => dep.id)
    const adds = refs.filter((ref) => resolvable.has(ref) && !stored.includes(ref))
    if (!adds.length) continue
    if (entry) {
      entry.depAdds = adds
      entry.changed = [...(entry.changed || []), 'dependsOn']
      if (result.changes) result.changes.push('dependsOn')
      continue
    }
    const escalated = {
      kind: 'update',
      row,
      targetId: result.id,
      patch: {},
      decisions: null,
      depAdds: adds,
      changed: ['dependsOn'],
      resultIndex: results.indexOf(result),
    }
    actions.push(escalated)
    Object.assign(result, { result: 'updated', changes: ['dependsOn'] })
  }

  return { actions, results }
}

function countsOf(results) {
  const counts = { created: 0, updated: 0, unchanged: 0, failed: 0 }
  for (const row of results) if (counts[row.result] !== undefined) counts[row.result] += 1
  return counts
}

function applyImportedStatus(task, row, fallbackHolder) {
  const status = row.status
  if (!status || status === 'open') return
  if (!model.STATUSES.includes(status)) return
  task.status = status
  task.statusChangedAt = model.nowIso()
  task.updatedAt = task.statusChangedAt
  if (status === 'doing') {
    task.holder = row.holder || fallbackHolder || 'import'
    task.claimedAt = model.nowIso()
  }
  if (status === 'done') {
    task.doneAt = model.nowIso()
    task.doneVersion = row.doneVersion || null
    task.doneEvidence = row.doneEvidence || null
    task.holder = null
  }
}

/**
 * Import structured rows with an idempotent merge.
 *
 * Existing id ⇒ patch only the fields present in the row (status is preserved
 * unless the row carries one for a *new* task; `context.decisions` are appended).
 * Unknown id ⇒ create, keeping the external id in `legacyId` so a re-import
 * updates instead of duplicating.
 */
export async function importJsonRows(store, rows, options = {}) {
  const board = await store.read()
  const preview = planJsonImport(board, rows, options)
  const counts = countsOf(preview.results)
  const base = {
    ...counts,
    total: preview.results.length,
    // Compatibility with the md/xlsx importer's vocabulary.
    imported: counts.created + counts.updated,
    skipped: counts.unchanged,
    rows: preview.results,
  }
  if (options.dryRun) return { ...base, dryRun: true }
  if (!preview.actions.length) return { ...base, dryRun: false }

  const assigned = new Map()
  const mutated = await store.mutate('import_json', options.by || 'import', (current) => {
    const plan = planJsonImport(current, rows, options)
    const changedTasks = []
    const createdByExternal = new Map()
    for (const entry of plan.actions) {
      const row = entry.row
      if (entry.kind === 'create') {
        const task = model.createTask(
          current,
          {
            title: row.title,
            priority: row.priority,
            urgency: row.urgency,
            tags: row.tags,
            notes: row.notes,
            stageCode: row.stageCode || model.DEFAULT_STAGE,
            holder: row.holder ?? null,
            role: row.role,
            legacyId: row.id || null,
            context: row.context,
          },
          options.by || 'import',
        )
        if (row.id) createdByExternal.set(row.id, task.id)
        applyImportedStatus(task, row, options.by)
        changedTasks.push(task.id)
        entry.selfId = task.id
        assigned.set(entry.resultIndex, task.id)
        continue
      }
      model.updateTask(current, entry.targetId, entry.patch)
      if (entry.decisions) {
        const task = current.tasks.find((candidate) => candidate.id === entry.targetId)
        if (task) {
          task.context = model.normalizeContext(task.context)
          for (const decision of entry.decisions) {
            task.context.decisions.push({
              text: String(decision.text).trim(),
              by: decision.by || options.by || 'import',
              at: decision.at || model.nowIso(),
            })
          }
        }
      }
      changedTasks.push(entry.targetId)
      entry.selfId = entry.targetId
    }

    const resolve = (ref) => {
      if (!ref) return null
      if (createdByExternal.has(ref)) return createdByExternal.get(ref)
      return current.tasks.some((task) => task.id === ref) ? ref : null
    }

    // Second pass: parents and dependencies need every task to exist first.
    for (const entry of plan.actions) {
      const task = current.tasks.find((candidate) => candidate.id === entry.selfId)
      if (!task) continue
      const parentId = resolve(entry.row.parentId)
      if (parentId && parentId !== task.id && task.parentId !== parentId) {
        const parent = current.tasks.find((candidate) => candidate.id === parentId)
        // Parent must not be a descendant of the task being moved.
        let cursor = parent
        let guard = 0
        let cycle = false
        while (cursor && cursor.parentId) {
          if (cursor.parentId === task.id) {
            cycle = true
            break
          }
          cursor = current.tasks.find((candidate) => candidate.id === cursor.parentId)
          if ((guard += 1) > model.MAX_DEPTH + 1) break
        }
        if (!cycle) {
          task.parentId = parentId
          task.updatedAt = model.nowIso()
        }
      }
      for (const ref of entry.row.dependsOn || []) {
        const depId = resolve(ref)
        if (!depId || depId === task.id) continue
        if ((task.dependsOn || []).some((dep) => dep.id === depId)) continue
        const detail = entry.row.dependsOnDetail?.get(ref) || {}
        task.dependsOn = [...(task.dependsOn || []), { id: depId, type: model.DEPENDENCY_TYPES.includes(detail.type) ? detail.type : 'hard', note: detail.note ? String(detail.note) : '' }]
      }
    }
    return { changedTasks }
  })

  // Replace predicted codes with the ones the board actually allocated.
  const rowsOut = preview.results.map((row, index) => {
    const actual = assigned.get(index)
    return actual ? { ...row, id: actual } : row
  })
  return { ...base, rows: rowsOut, dryRun: false, board: mutated.board, warning: mutated.warning }
}
