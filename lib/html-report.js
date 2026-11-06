/**
 * HTML export: turn a decorated state into a self-contained offline report.
 *
 * The renderer only produces DATA; layout lives in `templates/*.html`. A custom
 * template is any HTML file containing the `{{PTODO_*}}` tokens documented at
 * the top of `templates/report.html` — no build step, no CDN, no JS framework.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reportOf, tasksOfScope } from './report.js'
import * as model from './model.js'
import { fail } from './model.js'

export const TEMPLATE_DIR = fileURLToPath(new URL('../templates/', import.meta.url))

/** Built-in templates; a bare name in `--template` resolves here. */
export const BUILTIN_TEMPLATES = {
  report: 'report.html',
}

const STATUS_LABELS = {
  done: '已完成',
  doing: '进行中',
  open: '未开始',
  blocked: '阻塞',
  cancelled: '已取消',
}

const PRIORITY_LABELS = { P0: '最高', P1: '高', P2: '中', P3: '低', P4: '很低', P5: '最低' }

const SCOPE_LABELS = { active: '活跃看板', archive: '归档', all: '活跃 + 归档' }

export function listTemplates() {
  return Object.entries(BUILTIN_TEMPLATES).map(([name, file]) => ({
    name,
    path: path.join(TEMPLATE_DIR, file),
    exists: existsSync(path.join(TEMPLATE_DIR, file)),
  }))
}

/**
 * Resolve a template name or a user-supplied path. Path traversal is fine for
 * the CLI (the caller is the local user), but the HTTP surface only passes a
 * built-in name — see `lib/http.js`.
 */
export async function resolveTemplate(value, options = {}) {
  if (!value || value === true) return { name: 'report', file: path.join(TEMPLATE_DIR, BUILTIN_TEMPLATES.report) }
  const key = String(value)
  if (BUILTIN_TEMPLATES[key]) {
    const file = path.join(TEMPLATE_DIR, BUILTIN_TEMPLATES[key])
    if (!existsSync(file)) fail('IO_ERROR', `内置模板缺失：${file}`)
    return { name: key, file }
  }
  const file = path.isAbsolute(key) ? key : path.resolve(options.root || process.cwd(), key)
  if (!existsSync(file)) fail('NOT_FOUND', `模板不存在：${file}（可用内置名：${Object.keys(BUILTIN_TEMPLATES).join('/')}）`)
  return { name: path.basename(file, path.extname(file)), file }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** JSON that is safe inside a <script type="application/json"> block. */
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function percent(done, total) {
  return total ? Math.round((done / total) * 100) : 0
}

/**
 * The template data contract. Custom templates read this exact shape from
 * `<script id="ptodo-data" type="application/json">`.
 */
export function htmlReportModel(state, scope, options = {}) {
  const tasks = tasksOfScope(state, scope)
  const tagNames = new Map((state.tags || []).map((tag) => [tag.code, tag.name || tag.code]))
  const stages = [...(state.stages || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.code.localeCompare(b.code))
  const milestones = [...(state.milestones || [])]
  const stageByCode = new Map(stages.map((stage) => [stage.code, stage]))
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const childrenCount = new Map()
  for (const task of tasks) {
    if (task.parentId) childrenCount.set(task.parentId, (childrenCount.get(task.parentId) || 0) + 1)
  }

  const view = (task) => {
    const stage = stageByCode.get(task.stageCode) || null
    const milestoneCode = stage ? stage.milestoneCode : 'default'
    const milestone = milestones.find((entry) => entry.code === milestoneCode) || null
    const loops = task.context?.openLoops || []
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      statusLabel: STATUS_LABELS[task.status] || task.status,
      effectiveStatus: task.effectiveStatus || task.status,
      priority: task.priority,
      priorityLabel: PRIORITY_LABELS[task.priority] || task.priority,
      urgency: task.urgency,
      tags: (task.tags || []).map((code) => ({ code, name: tagNames.get(code) || code })),
      stageCode: task.stageCode || 'default',
      stageName: stage ? stage.name : '未分类',
      milestoneCode,
      milestoneName: milestone ? milestone.name : '默认',
      parentId: task.parentId || null,
      holder: task.holder || null,
      notes: task.notes || '',
      dependsOnIds: task.dependsOnIds || (task.dependsOn || []).map((dep) => dep.id),
      blockers: (task.blockers || []).map((entry) => entry.id),
      doneAt: task.doneAt || null,
      doneVersion: task.doneVersion || null,
      doneEvidence: task.doneEvidence || null,
      createdAt: task.createdAt || null,
      updatedAt: task.updatedAt || null,
      isContainer: Boolean(childrenCount.get(task.id)) || model.isContainer(task, tasks),
      childrenCount: childrenCount.get(task.id) || 0,
      lastOpenLoop: loops.length ? loops[loops.length - 1].text : '',
      archived: Boolean(task.archivedAt),
    }
  }

  const taskViews = tasks.map(view)
  const tasksById = new Map(taskViews.map((task) => [task.id, task]))

  const groups = []
  for (const milestone of milestones) {
    const stageRows = stages.filter((stage) => stage.milestoneCode === milestone.code)
    const stageViews = stageRows
      .map((stage) => {
        const rows = taskViews.filter((task) => task.stageCode === stage.code)
        const done = rows.filter((task) => task.status === 'done').length
        return {
          code: stage.code,
          name: stage.name || stage.code,
          status: stage.status || 'pending',
          order: stage.order ?? 0,
          total: rows.length,
          done,
          percent: percent(done, rows.length),
          tasks: rows,
        }
      })
      .filter((stage) => stage.total > 0)
    const rows = stageViews.flatMap((stage) => stage.tasks)
    const done = rows.filter((task) => task.status === 'done').length
    if (!rows.length) continue
    groups.push({
      code: milestone.code,
      name: milestone.name || milestone.code,
      status: milestone.status || 'active',
      total: rows.length,
      done,
      percent: percent(done, rows.length),
      stages: stageViews,
    })
  }
  // Tasks whose stage/milestone no longer exists must not disappear from the report.
  const groupedIds = new Set(groups.flatMap((group) => group.stages.flatMap((stage) => stage.tasks.map((task) => task.id))))
  const orphans = taskViews.filter((task) => !groupedIds.has(task.id))
  if (orphans.length) {
    groups.push({
      code: 'unassigned',
      name: '未归类',
      status: 'active',
      total: orphans.length,
      done: orphans.filter((task) => task.status === 'done').length,
      percent: percent(orphans.filter((task) => task.status === 'done').length, orphans.length),
      stages: [{ code: 'unknown', name: '未分类', status: 'pending', order: 999, total: orphans.length, done: 0, percent: 0, tasks: orphans }],
    })
  }

  const report = reportOf(state, scope, { generatedAt: options.generatedAt })
  const blocked = taskViews
    .filter((task) => task.status === 'blocked')
    .map((task) => ({
      ...task,
      reason: task.lastOpenLoop || byId.get(task.id)?.notes || '（未登记原因）',
    }))

  return {
    meta: {
      project: (state.board && state.board.project) || 'project',
      title: options.title || '项目任务状态报告',
      generatedAt: options.generatedAt ? new Date(options.generatedAt).toISOString() : new Date().toISOString(),
      scope,
      scopeLabel: SCOPE_LABELS[scope] || scope,
      revision: state.board ? state.board.revision : null,
      template: options.templateName || 'report',
      taskCount: taskViews.length,
    },
    kpi: {
      total: report.total,
      done: report.done,
      doing: report.doing,
      open: report.open,
      blocked: report.blocked,
      cancelled: report.cancelled,
      rate: Math.round(report.rate * 100),
    },
    statuses: report.statuses.map((entry) => ({ ...entry, label: entry.label || STATUS_LABELS[entry.key] || entry.key })),
    priorities: report.priorities.map((entry) => ({ ...entry, label: PRIORITY_LABELS[entry.key] || entry.key })),
    tags: report.tags,
    groups,
    blocked,
    tasks: taskViews,
    labels: { status: STATUS_LABELS, priority: PRIORITY_LABELS, scope: SCOPE_LABELS },
  }
}

/** Replace `{{PTODO_*}}` tokens. Unknown tokens survive for forward compatibility. */
function applyTokens(template, data) {
  const values = {
    PTODO_TITLE: escapeHtml(data.meta.title),
    PTODO_PROJECT: escapeHtml(data.meta.project),
    PTODO_GENERATED_AT: escapeHtml(data.meta.generatedAt),
    PTODO_SCOPE: escapeHtml(data.meta.scopeLabel),
    PTODO_TEMPLATE: escapeHtml(data.meta.template),
    PTODO_TASK_COUNT: String(data.meta.taskCount),
    PTODO_DATA: jsonForScript(data),
  }
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => (key in values ? values[key] : match))
}

/** Render a report. `options.template` is a built-in name or a filesystem path. */
export async function renderHtml(state, scope, options = {}) {
  const resolved = await resolveTemplate(options.template, { root: options.root })
  const source = await readFile(resolved.file, 'utf8')
  const data = htmlReportModel(state, scope, { ...options, templateName: resolved.name })
  if (!source.includes('{{PTODO_DATA}}')) {
    fail('PARSE_ERROR', `模板缺少 {{PTODO_DATA}} 占位符：${resolved.file}`)
  }
  return applyTokens(source, data)
}
