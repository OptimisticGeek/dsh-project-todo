/**
 * Reporting model for the Excel export.
 *
 * `ptodo admin export` and the Web panel both hand a decorated state to
 * `exportData`. This module turns that state into the numbers the workbook
 * needs (KPI cards, status/priority/milestone/tag tables and chart series) so
 * the XLSX writer stays a dumb layout engine.
 */

const STATUS_ORDER = [
  ['done', '已完成'],
  ['doing', '进行中'],
  ['open', '未开始'],
  ['blocked', '阻塞'],
  ['cancelled', '已取消'],
]

const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']

/** How many tag rows the dashboard shows before the list is cut off. */
export const TAG_LIMIT = 10

export function tasksOfScope(state, scope) {
  if (scope === 'archive') return [...(state.archived || [])]
  if (scope === 'all') return [...((state.board && state.board.tasks) || []), ...(state.archived || [])]
  return [...((state.board && state.board.tasks) || [])]
}

function stageToMilestone(state) {
  const map = new Map()
  for (const stage of state.stages || []) map.set(stage.code, stage.milestoneCode || 'default')
  return map
}

/** Tag usage, highest first, stable by display name for equal counts. */
export function tagUsage(tasks, names = new Map(), limit = TAG_LIMIT) {
  const counts = new Map()
  for (const task of tasks) {
    for (const code of task.tags || []) counts.set(code, (counts.get(code) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, name: names.get(code) || code, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/**
 * Build the dashboard numbers for one export scope.
 *
 * The status distribution uses the persisted status (the same value the detail
 * table prints), so the totals always add up to the exported row count. Every
 * number shown in a chart is also written into a cell: the chart only mirrors
 * the table and never becomes the single source of truth.
 */
export function reportOf(state, scope, options = {}) {
  const tasks = tasksOfScope(state, scope)
  const statusCount = new Map(STATUS_ORDER.map(([key]) => [key, 0]))
  const priorityCount = new Map(PRIORITY_ORDER.map((key) => [key, 0]))
  for (const task of tasks) {
    const status = statusCount.has(task.status) ? task.status : 'open'
    statusCount.set(status, statusCount.get(status) + 1)
    const priority = PRIORITY_ORDER.includes(task.priority) ? task.priority : 'P2'
    priorityCount.set(priority, priorityCount.get(priority) + 1)
  }

  const statuses = STATUS_ORDER.map(([key, label]) => ({ key, label, count: statusCount.get(key) || 0 }))
  const priorities = PRIORITY_ORDER.map((key) => ({ key, count: priorityCount.get(key) || 0 })).filter(
    (entry) => entry.count > 0,
  )
  if (!priorities.length) priorities.push({ key: 'P2', count: 0 })

  const stageMilestone = stageToMilestone(state)
  const milestones = (state.milestones || [])
    .map((milestone) => {
      const inScope = tasks.filter(
        (task) => stageMilestone.get(task.stageCode) === milestone.code && task.status !== 'cancelled',
      )
      const done = inScope.filter((task) => task.status === 'done').length
      return {
        code: milestone.code,
        name: milestone.name || milestone.code,
        done,
        total: inScope.length,
        percent: inScope.length ? done / inScope.length : 0,
      }
    })
    .filter((milestone) => milestone.total > 0)
    .sort((a, b) => a.code.localeCompare(b.code))

  const total = tasks.length
  const done = statusCount.get('done') || 0
  const tagNames = new Map((state.tags || []).map((tag) => [tag.code, tag.name || tag.code]))
  return {
    project: (state.board && state.board.project) || 'project',
    revision: state.board ? state.board.revision : null,
    generatedAt: options.generatedAt || new Date(),
    scope,
    total,
    done,
    doing: statusCount.get('doing') || 0,
    open: statusCount.get('open') || 0,
    blocked: statusCount.get('blocked') || 0,
    cancelled: statusCount.get('cancelled') || 0,
    rate: total ? done / total : 0,
    statuses,
    priorities,
    milestones,
    tags: tagUsage(tasks, tagNames),
  }
}
