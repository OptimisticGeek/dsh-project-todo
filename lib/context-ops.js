/**
 * Per-task context operations: decisions, progress and open loops.
 *
 * Bounded lists fold their oldest entries into one synthetic `system` summary
 * so the task stays readable; the original entries remain in the history log.
 */
import { fail, nowIso } from './model.js'

function fold(list, max, label) {
  if (!Array.isArray(list) || list.length <= max) return { list, folded: 0 }
  const drop = list.length - (max - 1)
  const removed = list.slice(0, drop)
  const foldedCount = removed.reduce((total, entry) => total + (entry.folded ? Number(entry.foldedCount) || 1 : 1), 0)
  const summary = {
    text: `[已折叠 ${foldedCount} 条更早${label}，见时间轴]`,
    by: 'system',
    at: nowIso(),
    folded: true,
    foldedCount,
  }
  return { list: [summary, ...list.slice(drop)], folded: foldedCount }
}

export function foldDecisions(context, max) {
  const result = fold(context.decisions, max, '决策')
  context.decisions = result.list
  return result.folded
}

export function foldOpenLoops(context, max) {
  const result = fold(context.openLoops, max, '未关闭事项')
  context.openLoops = result.list
  return result.folded
}

export function appendDecision(task, text, by, max = 50) {
  const value = String(text || '').trim()
  if (!value) fail('INVALID', '决策内容不能为空')
  task.context.decisions.push({ text: value, by: by || null, at: nowIso() })
  const folded = foldDecisions(task.context, max)
  task.updatedAt = nowIso()
  return { folded, count: task.context.decisions.length }
}

export function setProgress(task, text) {
  const value = String(text == null ? '' : text).trim()
  task.context.progress = value || null
  task.updatedAt = nowIso()
  return { progress: task.context.progress }
}

export function addOpenLoop(task, text, by, max = 20) {
  const value = String(text || '').trim()
  if (!value) fail('INVALID', '未关闭事项不能为空')
  task.context.openLoops.push({ text: value, by: by || null, at: nowIso() })
  const folded = foldOpenLoops(task.context, max)
  task.updatedAt = nowIso()
  return { folded, count: task.context.openLoops.length }
}

/** Close one open loop by 1-based index; returns the closed entry. */
export function closeOpenLoop(task, index) {
  const at = Number(index)
  if (!Number.isInteger(at) || at < 1 || at > task.context.openLoops.length) {
    fail('INVALID', `未关闭事项序号非法：${index}（1..${task.context.openLoops.length}）`)
  }
  const [closed] = task.context.openLoops.splice(at - 1, 1)
  task.updatedAt = nowIso()
  return closed
}

/** Human-readable "interrupted at" progress used by release. */
export function interruptedProgress(task) {
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
  const previous = task.context.progress ? `：${task.context.progress}` : ''
  return `中断于 ${stamp}${previous}`
}
