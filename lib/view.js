/**
 * Progressive task views for agents and terminals.
 *
 * One task board can be read at five levels. The level is chosen by the
 * command, not by dumping everything and letting the caller cut it down:
 *
 *   V0 summary  counts + the first ready-looking task       (ptask status)
 *   V1 list     ID/status/priority/title/stage/holder        (ptask list/ready)
 *   V2 brief    goal/progress/2 decisions/blockers/next      (ptask show)
 *   V3 context  relations: parent/children/deps/pre/resources (ptask show --context)
 *   V4 full     every field + history + commits              (ptask show --full)
 *
 * V0–V3 deliberately truncate with a visible hint. Only `--full` is allowed to
 * print long notes, and `--json` follows the selected view unless `--full` is
 * also present.
 */
import { STATUS_LABELS, URGENCY_LABELS, counts, isContainer, sortTasks } from './model.js'

const DEFAULT_SUMMARY_MAX = 160
const DEFAULT_LIST_LIMIT = 20
const DEFAULT_LIST_MAX = 3000
const DEFAULT_BRIEF_MAX = 800
const DEFAULT_CONTEXT_MAX = 2500

function clip(text, max) {
  const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

function truncated(text, max, hint = '--full 查看完整') {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…（${hint}）`
}

function statusLabel(task) {
  return STATUS_LABELS[task.status] || task.status
}

function urgencyLabel(task) {
  return URGENCY_LABELS[task.urgency] || String(task.urgency)
}

function stageOf(task, state) {
  if (task.stageName) return task.stageName
  return (state.stages || []).find((stage) => stage.code === task.stageCode)?.name || task.stageCode || ''
}

function milestoneOf(task, state) {
  if (task.milestoneName) return task.milestoneName
  const stage = (state.stages || []).find((entry) => entry.code === task.stageCode)
  if (!stage) return ''
  return (state.milestones || []).find((entry) => entry.code === stage.milestoneCode)?.name || stage.milestoneCode || ''
}

function taskMap(state) {
  const map = new Map()
  for (const task of state.board?.tasks || []) map.set(task.id, task)
  for (const task of state.archived || []) if (!map.has(task.id)) map.set(task.id, task)
  return map
}

function dependencyLabel(entry, tasks) {
  const target = tasks.get(entry.id)
  const title = target ? target.title : ''
  const status = target ? statusLabel(target) : '未知'
  return `${entry.id}${title ? ` ${title}` : ''}（${status}${entry.type ? ` · ${entry.type}` : ''}）`
}

function nextStepOf(task) {
  if (task.status === 'done') return '已完成'
  if (task.status === 'cancelled') return '已取消'
  const blockers = task.blockers || []
  const unmet = blockers.filter((entry) => entry.kind === 'precondition')
  const deps = blockers.filter((entry) => entry.kind === 'dependency')
  if (deps.length) return `等待 ${deps[0].id} 完成`
  if (unmet.length) return `先满足前置 ${unmet[0].id}`
  const loop = (task.context?.openLoops || [])[0]
  if (loop) return `先处理未关闭事项：${clip(loop.text, 60)}`
  if (task.context?.goal) return `按目标推进：${clip(task.context.goal, 80)}`
  if (task.context?.progress) return `从「${clip(task.context.progress, 60)}」继续`
  return '补充 context.goal 后再开始，便于下一位接手'
}

/** V0: one short paragraph, safe to inject on every step. */
export function renderSummary(state, options = {}) {
  const max = Number(options.maxChars) || DEFAULT_SUMMARY_MAX
  const limit = Number(options.limit) || 2
  const board = state.board || { tasks: [] }
  if (!board.tasks.length) return '本项目暂无任务（用 ptask create 新建，数据在 docs/ptask/tasks.json）。'
  const summary = state.counts || counts(board)
  const leaves = sortTasks(board.tasks.filter((task) => task.status === 'open' && !isContainer(task, board.tasks)))
  const picks = leaves.slice(0, limit).map((task) => task.id)
  const text =
    `任务：进行中 ${summary.doing} · 待开工 ${summary.open} · 阻塞 ${summary.blocked} · 已完成 ${summary.done}` +
    (picks.length ? `；优先 ${picks.join('、')}` : '')
  return truncated(text, max, '--json 查看完整')
}

/** V1: compact list, no notes, no decisions, no history. */
export function renderList(tasks, options = {}) {
  const limit = Number(options.limit) || DEFAULT_LIST_LIMIT
  const max = Number(options.maxChars) || DEFAULT_LIST_MAX
  const title = options.title || (options.archived ? '归档任务' : '任务列表')
  const sorted = sortTasks(tasks || [])
  const shown = sorted.slice(0, limit)
  const lines = [`${title}（${sorted.length} 条${sorted.length > shown.length ? `，显示前 ${shown.length}` : ''}）`]
  for (const task of shown) {
    const stage = task.stageName || task.stageCode
    const holder = task.holder ? ` · ${task.holder}` : ''
    const version = task.status === 'done' && task.doneVersion ? ` · 版本 ${task.doneVersion}` : ''
    const archived = task.archivedAt ? ` · 归档 ${String(task.archivedAt).slice(0, 10)}` : ''
    lines.push(
      `${task.id} [${statusLabel(task)}] ${task.priority}/紧急${task.urgency} ${task.title}` +
        `${stage ? ` — ${stage}` : ''}${holder}${version}${archived}`,
    )
  }
  if (sorted.length > shown.length) lines.push(`…还有 ${sorted.length - shown.length} 条，用 --limit 或 --status 缩小范围`)
  return truncated(lines.join('\n'), max)
}

/** V2: one task at a glance; default for `ptask show`. */
export function renderBrief(state, task, options = {}) {
  const max = Number(options.maxChars) || DEFAULT_BRIEF_MAX
  const lines = []
  lines.push(`${task.id} [${task.priority}/紧急 ${urgencyLabel(task)}] ${task.title}`)
  const stage = stageOf(task, state)
  const milestone = milestoneOf(task, state)
  const org = [stage, milestone].filter(Boolean).join(' / ')
  lines.push(
    `状态 ${statusLabel(task)}${task.effectiveStatus && task.effectiveStatus !== task.status ? `（有效 ${task.effectiveStatus}）` : ''}` +
      `${org ? ` · ${org}` : ''} · 持有 ${task.holder || '—'}`,
  )
  if (task.context?.goal) lines.push(`目标：${clip(task.context.goal, 120)}`)
  if (task.context?.progress) lines.push(`进度：${clip(task.context.progress, 120)}`)
  const decisions = (task.context?.decisions || []).slice(-2)
  if (decisions.length) {
    lines.push('最近决策：')
    for (const entry of decisions) lines.push(`  - ${clip(entry.text, 100)}${entry.by ? `（${entry.by}）` : ''}`)
  }
  const loops = task.context?.openLoops || []
  if (loops.length) lines.push(`未关闭：${loops.length} 条${loops[0] ? `（首条：${clip(loops[0].text, 60)}）` : ''}`)
  const blockers = task.blockers || []
  if (blockers.length) {
    const deps = blockers.filter((entry) => entry.kind === 'dependency').map((entry) => entry.id)
    const pres = blockers.filter((entry) => entry.kind === 'precondition').map((entry) => entry.id)
    lines.push(`阻塞：${[deps.length ? `依赖 ${deps.join('、')} 未完成` : '', pres.length ? `前置 ${pres.join('、')} 未满足` : ''].filter(Boolean).join('；')}`)
  }
  if (task.status === 'done') {
    lines.push(`完成：${task.doneAt || '—'}${task.doneVersion ? ` · 版本 ${task.doneVersion}` : ''}${task.doneEvidence ? ` · 证据 ${clip(task.doneEvidence, 100)}` : ''}`)
  }
  lines.push(`下一步：${nextStepOf(task)}`)
  return truncated(lines.join('\n'), max)
}

/** V3: relations only; IDs and titles, no long notes. */
export function renderContext(state, task, options = {}) {
  const max = Number(options.maxChars) || DEFAULT_CONTEXT_MAX
  const tasks = taskMap(state)
  const lines = [`${task.id} ${task.title}`, `状态 ${statusLabel(task)} · 阶段 ${stageOf(task, state) || '—'} · 里程碑 ${milestoneOf(task, state) || '—'}`]
  const parent = task.parentId ? tasks.get(task.parentId) : null
  if (parent) lines.push(`父：${parent.id} ${parent.title}（${statusLabel(parent)}）`)
  const children = (state.board?.tasks || []).filter((entry) => entry.parentId === task.id)
  if (children.length) {
    lines.push(`子（${children.length}）：`)
    for (const child of children) lines.push(`  - ${child.id} ${child.title}（${statusLabel(child)}）`)
  }
  const upstream = task.dependsOn || []
  if (upstream.length) {
    lines.push('上游依赖：')
    for (const entry of upstream) lines.push(`  - ${dependencyLabel(entry, tasks)}`)
  }
  const downstream = task.blocking || []
  if (downstream.length) {
    lines.push('下游（依赖本任务）：')
    for (const entry of downstream) lines.push(`  - ${dependencyLabel(entry, tasks)}`)
  }
  const pre = task.preconditions || []
  if (pre.length) {
    lines.push('前置条件：')
    for (const entry of pre) lines.push(`  - ${entry.id} ${entry.type} ${entry.required === false ? '（可选）' : ''} ${entry.satisfied ? '✅' : '⏳'}`)
  }
  const resources = task.resources || []
  if (resources.length) {
    lines.push('资料：')
    for (const entry of resources) lines.push(`  - ${entry.id} [${entry.status}] ${entry.title}`)
  }
  const causes = task.causedBy || []
  if (causes.length) {
    lines.push('原因：')
    for (const entry of causes) lines.push(`  - ${entry.type}:${entry.ref}${entry.note ? ` ${clip(entry.note, 60)}` : ''}`)
  }
  const loops = task.context?.openLoops || []
  lines.push(`未关闭：${loops.length} 条${loops[0] ? `（首条：${clip(loops[0].text, 60)}）` : ''}`)
  return truncated(lines.join('\n'), max)
}

export { DEFAULT_BRIEF_MAX, DEFAULT_CONTEXT_MAX, DEFAULT_LIST_LIMIT, DEFAULT_LIST_MAX, DEFAULT_SUMMARY_MAX }
