/**
 * Derived, read-time-only projections.
 *
 * Nothing here is persisted: effectiveStatus, isReady, blocking, progress,
 * staleResources and the org effective statuses are recomputed from the board,
 * archive and org files on every read.
 */
import { counts, isContainer, progressOf } from './model.js'

export function taskMap(board, archive) {
  const map = new Map()
  for (const task of board?.tasks || []) map.set(task.id, task)
  for (const task of archive?.tasks || []) if (!map.has(task.id)) map.set(task.id, task)
  return map
}

export function stageMap(org) {
  return new Map((org?.stages || []).map((stage) => [stage.code, stage]))
}

export function milestoneMap(org) {
  return new Map((org?.milestones || []).map((milestone) => [milestone.code, milestone]))
}

function depDone(id, ctx) {
  const task = ctx.tasks.get(id)
  return Boolean(task && task.status === 'done')
}

/** Evaluate one precondition; `required=false` is always satisfied. */
export function preconditionSatisfied(pre, ctx) {
  if (!pre || pre.required === false) return true
  switch (pre.type) {
    case 'manual_confirm':
      return pre.satisfied === true
    case 'task_done':
      return depDone(String(pre.params?.taskId || ''), ctx)
    case 'tag_done': {
      const tag = String(pre.params?.tag || '')
      if (!tag) return false
      const tagged = [...ctx.tasks.values()].filter(
        (task) => (task.tags || []).includes(tag) && task.status !== 'cancelled',
      )
      return tagged.length > 0 && tagged.every((task) => task.status === 'done')
    }
    case 'resource_approved': {
      const id = String(pre.params?.resourceId || '')
      const resource = (ctx.task?.resources || []).find((entry) => entry.id === id)
      return Boolean(resource && resource.status === 'approved')
    }
    case 'commit_exists':
      return Boolean(ctx.commitExists && pre.params?.commit && ctx.commitExists(pre.params.commit))
    default:
      return false
  }
}

export function requiredPreconditions(task) {
  return (task.preconditions || []).filter((pre) => pre.required !== false)
}

export function evaluatePreconditions(task, ctx) {
  return (task.preconditions || []).map((pre) => {
    const satisfied = preconditionSatisfied({ ...pre }, { ...ctx, task })
    return { ...pre, satisfied }
  })
}

/** Unsatisfied hard dependencies and required preconditions. */
export function blockersOf(task, ctx) {
  const blockers = []
  for (const dep of task.dependsOn || []) {
    if (dep.type !== 'hard') continue
    if (!depDone(dep.id, ctx)) blockers.push({ kind: 'dependency', id: dep.id, note: dep.note })
  }
  const withTask = { ...ctx, task }
  for (const pre of requiredPreconditions(task)) {
    if (!preconditionSatisfied(pre, withTask)) blockers.push({ kind: 'precondition', id: pre.id, type: pre.type })
  }
  return blockers
}

export function effectiveStatus(task, ctx) {
  if (task.status === 'done' || task.status === 'cancelled') return task.status
  return blockersOf(task, ctx).length ? 'blocked' : task.status
}

export function orgOfTask(task, ctx) {
  const stage = ctx.stages.get(task.stageCode)
  const milestone = stage ? ctx.milestones.get(stage.milestoneCode) : null
  return { stage: stage || null, milestone: milestone || null }
}

export function isReady(task, ctx) {
  if (isContainer(task, ctx.board.tasks)) return false
  if (task.status !== 'open') return false
  if (task.holder) return false
  const { stage, milestone } = orgOfTask(task, ctx)
  if (stage && stage.status === 'archived') return false
  if (milestone && milestone.status === 'archived') return false
  return effectiveStatus(task, ctx) === 'open'
}

export function blockingOf(id, tasks) {
  const result = []
  for (const task of tasks) {
    for (const dep of task.dependsOn || []) {
      if (dep.id === id) result.push({ id: task.id, type: dep.type, note: dep.note })
    }
  }
  return result
}

export function staleResources(task) {
  return (task.resources || []).filter((resource) => resource.status === 'superseded')
}

export function stageEffectiveStatus(stage, ctx) {
  for (const dep of stage.dependsOnStage || []) {
    const target = ctx.stages.get(dep.code)
    if (!target || target.status !== 'done') return 'blocked_by_upstream'
  }
  for (const dep of stage.dependsOnMilestone || []) {
    const target = ctx.milestones.get(dep.code)
    if (!target || target.status !== 'done') return 'blocked_by_upstream'
  }
  return stage.status
}

export function milestoneEffectiveStatus(milestone, ctx) {
  for (const dep of milestone.dependsOnMilestone || []) {
    const target = ctx.milestones.get(dep.code)
    if (!target || target.status !== 'done') return 'blocked_by_upstream'
  }
  return milestone.status
}

export function stageProgress(stage, tasks) {
  const inStage = tasks.filter((task) => task.stageCode === stage.code && task.status !== 'cancelled')
  return { done: inStage.filter((task) => task.status === 'done').length, total: inStage.length }
}

export function milestoneProgress(milestone, stageCodes, tasks) {
  const inMilestone = tasks.filter((task) => stageCodes.has(task.stageCode) && task.status !== 'cancelled')
  return { done: inMilestone.filter((task) => task.status === 'done').length, total: inMilestone.length }
}

/** Add derived fields to one task without mutating the source object. */
export function decorateTask(task, ctx) {
  const { stage, milestone } = orgOfTask(task, ctx)
  const parent = task.parentId ? ctx.tasks.get(task.parentId) : null
  return {
    ...task,
    effectiveStatus: effectiveStatus(task, ctx),
    isReady: isReady(task, ctx),
    blocking: blockingOf(task.id, ctx.board.tasks),
    preconditions: evaluatePreconditions(task, { ...ctx, task }),
    staleResources: staleResources(task),
    milestoneCode: stage ? stage.milestoneCode : null,
    stageName: stage ? stage.name : null,
    milestoneName: milestone ? milestone.name : null,
    parentProgress: parent ? progressOf(ctx.board, parent) : null,
  }
}

export function buildContext({ board, archive, org, commitExists }) {
  const stages = stageMap(org)
  const milestones = milestoneMap(org)
  const tasks = taskMap(board, archive)
  return {
    board,
    archive,
    org,
    stages,
    milestones,
    tasks,
    commitExists: commitExists || (() => false),
  }
}

/**
 * Decorate the whole state for HTTP/CLI display.
 * @returns {{board: object, archived: object[], milestones: object[], stages: object[], tags: object[], counts: object}}
 */
export function decorateState(state) {
  const { board, archive, org, tags } = state
  const ctx = buildContext(state)
  const tasks = (board?.tasks || []).map((task) => decorateTask(task, ctx))
  const stages = [...ctx.stages.values()].map((stage) => ({
    ...stage,
    effectiveStatus: stageEffectiveStatus(stage, ctx),
    progress: stageProgress(stage, board?.tasks || []),
  }))
  const milestones = [...ctx.milestones.values()].map((milestone) => {
    const stageCodes = new Set(
      [...ctx.stages.values()].filter((stage) => stage.milestoneCode === milestone.code).map((stage) => stage.code),
    )
    return {
      ...milestone,
      effectiveStatus: milestoneEffectiveStatus(milestone, ctx),
      progress: milestoneProgress(milestone, stageCodes, board?.tasks || []),
    }
  })
  const usage = new Map()
  for (const task of [...(board?.tasks || []), ...(archive?.tasks || [])]) {
    for (const code of task.tags || []) usage.set(code, (usage.get(code) || 0) + 1)
  }
  const registry = (tags?.tags || []).map((tag) => ({ ...tag, usageCount: usage.get(tag.code) || 0 }))
  // A v2 board may contain tag codes that were never registered; surface them
  // as drafts so the tag filter is complete before `ptodo migrate` runs.
  for (const [code, count] of usage) {
    if (registry.some((tag) => tag.code === code)) continue
    registry.push({
      code,
      name: code,
      description: '',
      aliases: [],
      status: 'draft',
      deprecatedBy: null,
      usageCount: count,
    })
  }
  const base = counts(board || { tasks: [] })
  const ready = tasks.filter((task) => task.isReady).length
  const blockedDerived = tasks.filter((task) => task.effectiveStatus === 'blocked').length
  return {
    board: { ...board, tasks },
    archived: archive?.tasks || [],
    milestones,
    stages,
    tags: registry,
    counts: {
      ...base,
      archived: (archive?.tasks || []).length,
      ready,
      blockedEffective: blockedDerived,
    },
  }
}
