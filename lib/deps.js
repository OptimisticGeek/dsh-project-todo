/**
 * Task dependency graph: hard/soft edges, cycle rejection and unlock
 * computation. Edges live on the dependent task (`dependsOn`).
 */
import { DEPENDENCY_TYPES, assertLeaf, fail, findTask } from './model.js'

/** DFS cycle check over the board's dependency edges. */
export function findDependencyCycle(board) {
  const state = new Map()
  const stack = []
  const byId = new Map(board.tasks.map((task) => [task.id, task]))
  const visit = (id) => {
    if (state.get(id) === 1) {
      const at = stack.indexOf(id)
      return [...stack.slice(at), id]
    }
    if (state.get(id) === 2) return null
    state.set(id, 1)
    stack.push(id)
    for (const dep of byId.get(id)?.dependsOn || []) {
      if (!byId.has(dep.id)) continue
      const hit = visit(dep.id)
      if (hit) return hit
    }
    stack.pop()
    state.set(id, 2)
    return null
  }
  for (const task of board.tasks) {
    const hit = visit(task.id)
    if (hit) return hit
  }
  return null
}

export function addDependency(board, id, dependsOnId, type = 'hard', note = '', knownIds = null) {
  const task = findTask(board, id)
  assertLeaf(task, board.tasks)
  if (!DEPENDENCY_TYPES.includes(type)) fail('INVALID', `依赖类型非法：${type}`)
  if (id === dependsOnId) fail('INVALID', '任务不能依赖自己')
  const known = knownIds || new Set(board.tasks.map((candidate) => candidate.id))
  if (!known.has(dependsOnId)) fail('NOT_FOUND', `依赖的任务不存在：${dependsOnId}`)
  if ((task.dependsOn || []).some((dep) => dep.id === dependsOnId)) {
    fail('CONFLICT', `${id} 已依赖 ${dependsOnId}`)
  }
  task.dependsOn.push({ id: dependsOnId, type, note: note ? String(note) : '' })
  const cycle = findDependencyCycle(board)
  if (cycle) {
    task.dependsOn = task.dependsOn.filter((dep) => dep.id !== dependsOnId)
    fail('DEPENDENCY_CYCLE', `任务依赖成环：${cycle.join(' → ')}`)
  }
  task.updatedAt = new Date().toISOString()
  return { dependsOn: task.dependsOn }
}

export function removeDependency(board, id, dependsOnId) {
  const task = findTask(board, id)
  const before = task.dependsOn.length
  task.dependsOn = task.dependsOn.filter((dep) => dep.id !== dependsOnId)
  if (task.dependsOn.length === before) fail('NOT_FOUND', `${id} 没有依赖 ${dependsOnId}`)
  task.updatedAt = new Date().toISOString()
  return { dependsOn: task.dependsOn }
}

/** Tasks that become ready because `completedId` just finished. */
export function unlockedBy(board, completedId, extraTasks = []) {
  const byId = new Map([...extraTasks, ...board.tasks].map((task) => [task.id, task]))
  const unlocked = []
  for (const task of board.tasks) {
    if (task.status !== 'open') continue
    const edges = task.dependsOn || []
    if (!edges.some((dep) => dep.id === completedId && dep.type === 'hard')) continue
    const allDone = edges.filter((dep) => dep.type === 'hard').every((dep) => byId.get(dep.id)?.status === 'done')
    if (allDone) unlocked.push(task.id)
  }
  return unlocked
}

/** Hard dependencies that are not done (used by list --blocked). */
export function unresolvedDependencies(task, byId) {
  return (task.dependsOn || [])
    .filter((dep) => dep.type === 'hard')
    .filter((dep) => byId.get(dep.id)?.status !== 'done')
    .map((dep) => dep.id)
}
