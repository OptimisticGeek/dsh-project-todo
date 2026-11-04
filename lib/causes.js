/**
 * Causal narrative: why a task exists and what it caused.
 *
 * `causedBy` is authoritative; when the reference is another task the reverse
 * edge is mirrored into that task's `causes` in the same mutation. Causality is
 * narrative only — it never affects readiness or scheduling.
 */
import { CAUSE_TYPES, fail, nowIso } from './model.js'

function taskOf(board, id) {
  return board.tasks.find((task) => task.id === id)
}

export function addCause(board, id, input, by) {
  const task = taskOf(board, id)
  if (!task) fail('NOT_FOUND', `没有任务 ${id}`)
  const type = String(input.type || 'external')
  if (!CAUSE_TYPES.includes(type)) fail('INVALID', `因果类型非法：${type}`)
  const ref = String(input.ref || '').trim()
  if (!ref) fail('INVALID', '因果引用 ref 不能为空')
  if (task.causedBy.some((edge) => edge.type === type && edge.ref === ref)) {
    fail('CONFLICT', `${id} 已记录同一因果边：${type}:${ref}`)
  }
  const at = nowIso()
  const edge = { type, ref, note: input.note ? String(input.note) : '', by: by || null, at }
  if (type === 'task') {
    const target = taskOf(board, ref)
    if (!target) fail('NOT_FOUND', `因果任务不存在：${ref}`)
    if (target.id === task.id) fail('INVALID', '任务不能以自己为原因')
  }
  task.causedBy.push(edge)
  if (type === 'task') {
    const target = taskOf(board, ref)
    if (!target.causes.some((reverse) => reverse.type === 'task' && reverse.ref === id)) {
      target.causes.push({ type: 'task', ref: id, note: edge.note, by: by || null, at })
    }
  }
  task.updatedAt = at
  return edge
}

export function removeCause(board, id, input) {
  const task = taskOf(board, id)
  if (!task) fail('NOT_FOUND', `没有任务 ${id}`)
  const type = String(input.type || '')
  const ref = String(input.ref || '')
  const before = task.causedBy.length
  task.causedBy = task.causedBy.filter((edge) => !(edge.type === type && edge.ref === ref))
  if (task.causedBy.length === before) fail('NOT_FOUND', `没有因果边 ${type}:${ref}`)
  if (type === 'task') {
    const target = taskOf(board, ref)
    if (target) {
      target.causes = target.causes.filter((edge) => !(edge.type === 'task' && edge.ref === id))
    }
  }
  task.updatedAt = nowIso()
}

export function listCauses(task) {
  return { causedBy: task.causedBy || [], causes: task.causes || [] }
}

/**
 * Walk the causal graph up (causedBy) and down (causes), depth-limited.
 * A repeated node is reported once with `cycle:true` instead of looping.
 */
export function causeChain(board, id, depth = 3) {
  const root = taskOf(board, id)
  if (!root) fail('NOT_FOUND', `没有任务 ${id}`)
  const byId = new Map(board.tasks.map((task) => [task.id, task]))
  const up = []
  const down = []
  const seenUp = new Set([id])
  const seenDown = new Set([id])
  let cycle = false
  const walk = (task, level, direction, out, seen) => {
    if (level > depth) return
    const edges = direction === 'up' ? task.causedBy || [] : task.causes || []
    for (const edge of edges) {
      if (edge.type !== 'task') continue
      const next = byId.get(edge.ref)
      if (!next) continue
      if (seen.has(next.id)) {
        cycle = true
        continue
      }
      seen.add(next.id)
      out.push({ id: next.id, title: next.title, depth: level, note: edge.note })
      walk(next, level + 1, direction, out, seen)
    }
  }
  walk(root, 1, 'up', up, seenUp)
  walk(root, 1, 'down', down, seenDown)
  return { id, title: root.title, up, down, cycle }
}
