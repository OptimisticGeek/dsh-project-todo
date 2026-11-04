/**
 * Task resources: specs, designs, repos and URLs attached to one task.
 * Resources are task-local (not a global library); superseding one marks it
 * stale so the detail view asks the agent to re-check.
 */
import { RESOURCE_STATUSES, fail, nowIso } from './model.js'

function nextId(task) {
  let max = 0
  for (const resource of task.resources || []) max = Math.max(max, Number(String(resource.id).slice(4)) || 0)
  return `res-${String(max + 1).padStart(4, '0')}`
}

export function addResource(task, input, by) {
  const title = String(input.title || '').trim()
  if (!title) fail('INVALID', '资料标题不能为空')
  const resource = {
    id: nextId(task),
    type: typeof input.type === 'string' && input.type ? input.type : 'doc',
    title,
    url: typeof input.url === 'string' ? input.url : '',
    note: typeof input.note === 'string' ? input.note : '',
    status: 'draft',
    supersededBy: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdBy: by || null,
  }
  task.resources.push(resource)
  task.updatedAt = nowIso()
  return resource
}

export function approveResource(task, id, by, note) {
  const resource = (task.resources || []).find((entry) => entry.id === id)
  if (!resource) fail('NOT_FOUND', `没有资料 ${id}`)
  if (resource.status === 'superseded') fail('CONFLICT', `资料 ${id} 已被替换，不能批准`)
  resource.status = 'approved'
  resource.approvedBy = by || null
  resource.approvedAt = nowIso()
  resource.updatedAt = nowIso()
  if (note) resource.note = String(note)
  task.updatedAt = nowIso()
  return resource
}

export function supersedeResource(task, id, replacementId) {
  const resource = (task.resources || []).find((entry) => entry.id === id)
  if (!resource) fail('NOT_FOUND', `没有资料 ${id}`)
  const replacement = (task.resources || []).find((entry) => entry.id === replacementId)
  if (!replacement) fail('NOT_FOUND', `替代资料不存在：${replacementId}`)
  if (resource.id === replacement.id) fail('INVALID', '资料不能替换自己')
  if (resource.status === 'superseded') fail('CONFLICT', `资料 ${id} 已被替换`)
  resource.status = 'superseded'
  resource.supersededBy = replacement.id
  resource.updatedAt = nowIso()
  task.updatedAt = nowIso()
  return resource
}

export function listResources(task, status) {
  const resources = task.resources || []
  if (!status) return resources
  if (!RESOURCE_STATUSES.includes(status)) fail('INVALID', `资料状态非法：${status}`)
  return resources.filter((resource) => resource.status === status)
}
