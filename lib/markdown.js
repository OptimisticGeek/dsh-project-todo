/**
 * Human-readable Markdown snapshots:
 *   `.dsh/TODO.md`     active tasks only
 *   `.dsh/ARCHIVE.md`  archived tasks (completed + archived)
 * Both are regenerated after every successful mutation; neither is read back.
 */
import { STATUS_LABELS, URGENCY_LABELS, counts, progressOf, rootTasks, sortTasks } from './model.js'

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function shortTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (number) => String(number).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function cell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
}

function urgencyLabel(task) {
  return URGENCY_LABELS[task.urgency] || String(task.urgency)
}

function tagsCell(task) {
  return Array.isArray(task.tags) && task.tags.length ? cell(task.tags.join('、')) : '—'
}

function statusCell(board, task) {
  const label = STATUS_LABELS[task.status] || task.status
  if (!board.tasks.some((candidate) => candidate.parentId === task.id)) return label
  const progress = progressOf(board, task)
  return `${label} ${progress.done}/${progress.total}`
}

function renderTree(lines, board, task, depth) {
  const prefix = depth > 1 ? `${'  '.repeat(depth - 1)}↳ ` : ''
  lines.push(
    `| ${prefix}${task.id} | ${task.priority} | ${urgencyLabel(task)} | ${statusCell(board, task)} | ${cell(task.title)} | ${tagsCell(task)} | ${task.holder ? cell(task.holder) : '—'} | ${cell(shortTime(task.claimedAt))} | ${cell(shortTime(task.statusChangedAt))} | ${cell(task.notes || '')} |`,
  )
  for (const child of sortTasks(board.tasks.filter((candidate) => candidate.parentId === task.id))) {
    renderTree(lines, board, child, depth + 1)
  }
}

/** Render the active tasks snapshot. */
export function renderMarkdown(board, config) {
  const summary = counts(board)
  const lines = []
  lines.push('# 待办')
  lines.push('')
  lines.push(
    `> 本文件由 dsh-project-todo / ptodo 自动生成（revision ${board.revision}，${formatTime(board.updatedAt)}），请勿手工编辑。`,
  )
  const archivePath = (config && config.markdown && config.markdown.archivePath) || '.dsh/ARCHIVE.md'
  lines.push(`> 数据源：\`docs/ptodo/todos.json\`；已完成任务归档后进入 \`${archivePath}\`。`)
  lines.push('> **工作入口**：agent 请加载技能 `project-todo`（或直接执行 `ptodo task ready`）后按 G0–G4 推进；')
  lines.push('> 本文件与 `todos.json` 都是只读快照/存储，**不要直接编辑，也不要以读 JSON 代替认领**。')
  lines.push('')
  lines.push(
    `进行中 ${summary.doing} · 未开始 ${summary.open} · 阻塞 ${summary.blocked} · 已完成 ${summary.done} · 已取消 ${summary.cancelled}`,
  )
  lines.push('')
  lines.push('| ID | 优先级 | 紧急度 | 状态 | 任务 | 标签 | 持有 | 认领 | 状态更新 | 备注 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  if (!board.tasks.length) {
    lines.push('| — | — | — | — | （暂无任务） | — | — | — | — | — |')
  } else {
    for (const root of rootTasks(board.tasks)) renderTree(lines, board, root, 1)
  }
  lines.push('')
  return lines.join('\n')
}

/** Render the archive snapshot. */
export function renderArchiveMarkdown(archive, config) {
  const tasks = archive.tasks || []
  const lines = []
  lines.push('# 已归档待办')
  lines.push('')
  lines.push(
    `> 本文件由 dsh-project-todo / ptodo 自动生成（revision ${archive.revision}，${formatTime(archive.updatedAt)}），请勿手工编辑。`,
  )
  lines.push('> 数据源：`docs/ptodo/archive.json`；用于完成后的归档留存，不参与进行中统计。')
  lines.push('')
  lines.push(`共 ${tasks.length} 条`)
  lines.push('')
  lines.push('| ID | 优先级 | 紧急度 | 任务 | 标签 | 完成日 | 归档日 | 版本 | 证据 |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  const ordered = [...tasks].sort((left, right) => String(right.doneAt || '').localeCompare(String(left.doneAt || '')))
  for (const task of ordered) {
    lines.push(
      `| ${task.id} | ${task.priority} | ${urgencyLabel(task)} | ${cell(task.title)} | ${tagsCell(task)} | ${cell(formatTime(task.doneAt))} | ${cell(formatTime(task.archivedAt))} | ${cell(task.doneVersion || '—')} | ${cell(task.doneEvidence || '—')} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
}
