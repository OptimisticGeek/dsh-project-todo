/**
 * Task preconditions: the "start gate" of one task, independent of stage and
 * milestone. Several preconditions are ANDed; `required=false` is advisory and
 * never blocks.
 *
 * Only `manual_confirm` stores `satisfied`; every other type is evaluated at
 * read time so it can never go stale.
 */
import { PRECONDITION_TYPES, fail, nowIso } from './model.js'

const PARAM_KEY = {
  task_done: 'taskId',
  tag_done: 'tag',
  resource_approved: 'resourceId',
  commit_exists: 'commit',
  manual_confirm: null,
}

function nextId(task) {
  let max = 0
  for (const pre of task.preconditions || []) max = Math.max(max, Number(String(pre.id).slice(3)) || 0)
  return `pc-${String(max + 1).padStart(4, '0')}`
}

export function addPrecondition(task, input, by) {
  const type = String(input.type || '')
  if (!PRECONDITION_TYPES.includes(type)) fail('INVALID', `前置条件类型非法：${type || '(空)'}`)
  const key = PARAM_KEY[type]
  let params = input.params && typeof input.params === 'object' ? { ...input.params } : {}
  if (key) {
    const value = String(input[key] ?? params[key] ?? '').trim()
    if (!value) fail('INVALID', `${type} 需要 --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
    params = { ...params, [key]: value }
  } else {
    params = {}
  }
  const pre = {
    id: nextId(task),
    type,
    params,
    required: input.required !== false,
    satisfied: false,
    satisfiedBy: null,
    confirmedAt: null,
  }
  task.preconditions.push(pre)
  task.updatedAt = nowIso()
  return pre
}

export function removePrecondition(task, id) {
  const before = task.preconditions.length
  task.preconditions = task.preconditions.filter((pre) => pre.id !== id)
  if (task.preconditions.length === before) fail('NOT_FOUND', `没有前置条件 ${id}`)
  task.updatedAt = nowIso()
}

export function confirmPrecondition(task, id, by, note) {
  const pre = task.preconditions.find((entry) => entry.id === id)
  if (!pre) fail('NOT_FOUND', `没有前置条件 ${id}`)
  if (pre.type !== 'manual_confirm') {
    fail('INVALID', `${pre.id} 是 ${pre.type}，由系统自动判定，无需人工确认`)
  }
  pre.satisfied = true
  pre.satisfiedBy = by || null
  pre.confirmedAt = nowIso()
  if (note) pre.note = String(note)
  task.updatedAt = nowIso()
  return pre
}

export function preconditionTitle(pre) {
  const params = pre.params || {}
  switch (pre.type) {
    case 'task_done':
      return `任务 ${params.taskId} 完成`
    case 'tag_done':
      return `标签 ${params.tag} 全部完成`
    case 'resource_approved':
      return `资料 ${params.resourceId} 已批准`
    case 'commit_exists':
      return `提交 ${params.commit} 存在`
    case 'manual_confirm':
      return '人工确认'
    default:
      return pre.type
  }
}
