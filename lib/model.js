/**
 * Canonical project-todo model: validation, parent/child derivation, sorting
 * and the state machine. Pure functions only — persistence lives in store.js.
 *
 * v3 adds the three-layer organisation (stageCode), task dependencies,
 * per-task context, preconditions, resources, causes and actor fields.
 * Derived fields (effectiveStatus/isReady/blocking/progress) are computed in
 * derive.js and are never persisted.
 */
export const STORE_VERSION = 3
export const ARCHIVE_VERSION = 2
export const MILESTONE_VERSION = 1
export const TAG_VERSION = 1
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']
export const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 }
export const STATUSES = ['open', 'doing', 'blocked', 'done', 'cancelled']
export const STATUS_LABELS = {
  open: '未开始',
  doing: '进行中',
  blocked: '阻塞',
  done: '已完成',
  cancelled: '已取消',
}
/** Chinese display names for the five urgency levels; 5 is the most urgent. */
export const URGENCY_LABELS = {
  5: '非常紧急',
  4: '紧急',
  3: '普通',
  2: '不紧急',
  1: '可延后',
}
export const MAX_DEPTH = 5
export const MAX_TITLE = 200
export const STAGE_CODE_RE = /^(default|S-\d{4,})$/
export const MILESTONE_CODE_RE = /^(default|M-\d{4,})$/
export const DEPENDENCY_TYPES = ['hard', 'soft']
export const MILESTONE_STATUSES = ['active', 'done', 'archived']
export const STAGE_STATUSES = ['pending', 'active', 'done', 'skipped']
export const PRECONDITION_TYPES = ['task_done', 'tag_done', 'resource_approved', 'commit_exists', 'manual_confirm']
export const RESOURCE_STATUSES = ['draft', 'approved', 'superseded']
export const CAUSE_TYPES = ['task', 'feedback', 'decision', 'resource', 'external']
export const DEFAULT_STAGE = 'default'
export const DEFAULT_MILESTONE = 'default'
const ID_RE = /^T-\d{4,}$/
const PRE_ID_RE = /^pc-\d{4,}$/
const RES_ID_RE = /^res-\d{4,}$/

export class TodoError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message)
    this.name = 'TodoError'
    this.code = code
  }
}

export function fail(code, message) {
  throw new TodoError(code, message)
}

export function nowIso() {
  return new Date().toISOString()
}

/** Fresh empty board; nothing is written until the first mutation. */
export function emptyBoard(project) {
  return {
    version: STORE_VERSION,
    project: project || 'project',
    nextId: 1,
    revision: 0,
    updatedAt: nowIso(),
    tasks: [],
  }
}

/** Fresh empty archive file. */
export function emptyArchive(project) {
  return {
    version: ARCHIVE_VERSION,
    project: project || 'project',
    revision: 0,
    updatedAt: nowIso(),
    tasks: [],
  }
}

/* ------------------------------------------------------------- context */

function normalizeLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const text = String(entry.text == null ? '' : entry.text).trim()
  if (!text) return null
  const normalized = {
    text,
    by: entry.by ? String(entry.by) : null,
    at: typeof entry.at === 'string' ? entry.at : nowIso(),
  }
  if (entry.folded === true) {
    normalized.folded = true
    normalized.foldedCount = Number.isInteger(entry.foldedCount) ? entry.foldedCount : 1
  }
  return normalized
}

/** Normalize the per-task context; unknown shapes degrade to empty lists. */
export function normalizeContext(context) {
  const source = context && typeof context === 'object' ? context : {}
  return {
    goal: typeof source.goal === 'string' && source.goal.trim() ? source.goal.trim() : null,
    progress: typeof source.progress === 'string' && source.progress.trim() ? source.progress.trim() : null,
    decisions: Array.isArray(source.decisions) ? source.decisions.map(normalizeLogEntry).filter(Boolean) : [],
    openLoops: Array.isArray(source.openLoops) ? source.openLoops.map(normalizeLogEntry).filter(Boolean) : [],
  }
}

/* ------------------------------------------------------------- pieces */

function normalizeDependency(entry) {
  if (!entry || typeof entry !== 'object') return null
  const id = String(entry.id || '')
  if (!ID_RE.test(id)) return null
  return {
    id,
    type: DEPENDENCY_TYPES.includes(entry.type) ? entry.type : 'hard',
    note: typeof entry.note === 'string' ? entry.note : '',
  }
}

function normalizePrecondition(entry) {
  if (!entry || typeof entry !== 'object') return null
  const id = String(entry.id || '')
  if (!PRE_ID_RE.test(id)) return null
  const type = PRECONDITION_TYPES.includes(entry.type) ? entry.type : 'manual_confirm'
  return {
    id,
    type,
    params: entry.params && typeof entry.params === 'object' ? entry.params : {},
    required: entry.required !== false,
    satisfied: entry.satisfied === true,
    satisfiedBy: entry.satisfiedBy ? String(entry.satisfiedBy) : null,
    confirmedAt: typeof entry.confirmedAt === 'string' ? entry.confirmedAt : null,
  }
}

function normalizeCause(entry) {
  if (!entry || typeof entry !== 'object') return null
  const type = CAUSE_TYPES.includes(entry.type) ? entry.type : 'external'
  const ref = String(entry.ref == null ? '' : entry.ref).trim()
  if (!ref) return null
  return {
    type,
    ref,
    note: typeof entry.note === 'string' ? entry.note : '',
    by: entry.by ? String(entry.by) : null,
    at: typeof entry.at === 'string' ? entry.at : nowIso(),
  }
}

function normalizeResource(entry) {
  if (!entry || typeof entry !== 'object') return null
  const id = String(entry.id || '')
  if (!RES_ID_RE.test(id)) return null
  return {
    id,
    type: typeof entry.type === 'string' && entry.type ? entry.type : 'doc',
    title: String(entry.title == null ? '' : entry.title).trim(),
    url: typeof entry.url === 'string' ? entry.url : '',
    note: typeof entry.note === 'string' ? entry.note : '',
    status: RESOURCE_STATUSES.includes(entry.status) ? entry.status : 'draft',
    supersededBy: entry.supersededBy ? String(entry.supersededBy) : null,
    approvedBy: entry.approvedBy ? String(entry.approvedBy) : null,
    approvedAt: typeof entry.approvedAt === 'string' ? entry.approvedAt : null,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : nowIso(),
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : nowIso(),
  }
}

function uniqueById(list) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** Merge the legacy `group` column into `tags` and normalize both. */
export function normalizeTags(task) {
  const tags = Array.isArray(task.tags) ? task.tags.map(String) : []
  if (typeof task.group === 'string' && task.group.trim()) tags.push(task.group.trim())
  delete task.group
  task.tags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
  if (task.size === undefined) task.size = null
  if (task.archivedAt === undefined) task.archivedAt = null
  if (task.archivedBy === undefined) task.archivedBy = null
  if (typeof task.archiveExempt !== 'boolean') task.archiveExempt = false
  return task
}

/** Fill every v3 field on one task with a valid default. */
export function normalizeTask(task) {
  if (!task || typeof task !== 'object') return task
  normalizeTags(task)
  if (typeof task.stageCode !== 'string' || !task.stageCode.trim()) task.stageCode = DEFAULT_STAGE
  task.context = normalizeContext(task.context)
  task.dependsOn = Array.isArray(task.dependsOn) ? uniqueById(task.dependsOn.map(normalizeDependency).filter(Boolean)) : []
  task.preconditions = Array.isArray(task.preconditions)
    ? uniqueById(task.preconditions.map(normalizePrecondition).filter(Boolean))
    : []
  task.resources = Array.isArray(task.resources) ? uniqueById(task.resources.map(normalizeResource).filter(Boolean)) : []
  task.causedBy = Array.isArray(task.causedBy) ? task.causedBy.map(normalizeCause).filter(Boolean) : []
  task.causes = Array.isArray(task.causes) ? task.causes.map(normalizeCause).filter(Boolean) : []
  for (const field of ['createdBy', 'claimedBy', 'doneBy', 'releasedBy']) {
    if (typeof task[field] !== 'string' || !task[field]) task[field] = null
  }
  if (!Number.isInteger(task.revision) || task.revision < 0) task.revision = 0
  return task
}

/** Migrate a stored board to the current version in memory. */
export function normalizeBoard(board) {
  if (!board || typeof board !== 'object') return board
  board.version = STORE_VERSION
  for (const task of Array.isArray(board.tasks) ? board.tasks : []) normalizeTask(task)
  return board
}

/** Migrate an archived store to the current version in memory. */
export function normalizeArchive(archive) {
  if (!archive || typeof archive !== 'object') return archive
  archive.version = ARCHIVE_VERSION
  for (const task of Array.isArray(archive.tasks) ? archive.tasks : []) normalizeTask(task)
  return archive
}

/* ------------------------------------------------------------- tree */

/** Whether a task owns any child task. */
export function isContainer(task, tasks) {
  return tasks.some((candidate) => candidate.parentId === task.id)
}

/** Direct children, in canonical sort order. */
export function childrenOf(tasks, id) {
  return sortTasks(tasks.filter((task) => task.parentId === id))
}

/** Canonical ranking: P0 first, then urgency 5→1, then oldest first. */
export function sortTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const byPriority = (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9)
    if (byPriority !== 0) return byPriority
    if (left.urgency !== right.urgency) return right.urgency - left.urgency
    const byCreated = String(left.createdAt).localeCompare(String(right.createdAt))
    if (byCreated !== 0) return byCreated
    return left.id.localeCompare(right.id)
  })
}

/** Panel order: claimed tasks by claim time, then unclaimed by creation time. */
export function sortForPanel(tasks) {
  return [...tasks].sort((left, right) => {
    const leftClaimed = left.claimedAt ? 0 : 1
    const rightClaimed = right.claimedAt ? 0 : 1
    if (leftClaimed !== rightClaimed) return leftClaimed - rightClaimed
    const leftKey = left.claimedAt || left.createdAt || ''
    const rightKey = right.claimedAt || right.createdAt || ''
    const byKey = String(leftKey).localeCompare(String(rightKey))
    if (byKey !== 0) return byKey
    return left.id.localeCompare(right.id)
  })
}

/** Root tasks (no parent), canonical sort order. */
export function rootTasks(tasks) {
  return sortTasks(tasks.filter((task) => !task.parentId))
}

/** Ancestor chain, nearest parent first. */
export function ancestorsOf(tasks, task) {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]))
  const chain = []
  let current = task.parentId ? byId.get(task.parentId) : undefined
  while (current) {
    chain.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return chain
}

/** Chain length of one task (root = 1). */
export function depthOf(tasks, task) {
  return ancestorsOf(tasks, task).length + 1
}

/** Counter over leaf tasks, plus raw totals. */
export function counts(board) {
  const tasks = board.tasks || []
  const parentIds = new Set(tasks.filter((task) => task.parentId).map((task) => task.parentId))
  const leaves = tasks.filter((task) => !parentIds.has(task.id))
  const result = { open: 0, doing: 0, blocked: 0, done: 0, cancelled: 0 }
  for (const task of leaves) result[task.status] = (result[task.status] || 0) + 1
  return {
    ...result,
    leaves: leaves.length,
    total: tasks.length,
    archived: tasks.filter((task) => task.status === 'done' || task.status === 'cancelled').length,
  }
}

/** Whether the task is a leaf (never claimable when it has children). */
export function assertLeaf(task, tasks) {
  if (isContainer(task, tasks)) fail('INVALID', `父任务 ${task.id} 由子任务汇总，不能直接改状态`)
}

/** Find one task or throw NOT_FOUND. */
export function findTask(board, id) {
  const task = board.tasks.find((candidate) => candidate.id === id)
  if (!task) fail('NOT_FOUND', `没有任务 ${id}`)
  return task
}

/* ------------------------------------------------------------- validation */

/**
 * Validate a whole board. Runs after parent derivation; throws TodoError.
 * `options.stageCodes` (Set/array) also validates the stage reference; the
 * pure-model tests may omit it, in which case only the code shape is checked.
 * @param {object} board
 * @param {{stageCodes?: Set<string>|string[]}} [options]
 */
export function validateBoard(board, options = {}) {
  if (!board || typeof board !== 'object') fail('PARSE_ERROR', '待办文件不是对象')
  normalizeBoard(board)
  if (board.version !== STORE_VERSION) {
    fail('PARSE_ERROR', `不支持的待办文件版本 ${String(board.version)}（期望 ${STORE_VERSION}）`)
  }
  if (typeof board.project !== 'string') board.project = 'project'
  if (!Number.isInteger(board.nextId) || board.nextId < 1) fail('PARSE_ERROR', 'nextId 必须是正整数')
  if (!Number.isInteger(board.revision) || board.revision < 0) fail('PARSE_ERROR', 'revision 必须是非负整数')
  if (typeof board.updatedAt !== 'string') board.updatedAt = nowIso()
  if (!Array.isArray(board.tasks)) fail('PARSE_ERROR', 'tasks 必须是数组')

  const ids = new Set()
  const byId = new Map()
  for (const task of board.tasks) {
    if (!task || typeof task !== 'object') fail('PARSE_ERROR', '任务必须是对象')
    if (typeof task.id !== 'string' || !ID_RE.test(task.id)) fail('INVALID', `非法任务 ID：${String(task.id)}`)
    if (ids.has(task.id)) fail('INVALID', `任务 ID 重复：${task.id}`)
    ids.add(task.id)
    byId.set(task.id, task)
    validateTask(task)
  }
  let maxId = 0
  for (const id of ids) maxId = Math.max(maxId, Number(id.slice(2)))
  if (board.nextId <= maxId) board.nextId = maxId + 1

  const stageCodes = options.stageCodes
    ? new Set(Array.isArray(options.stageCodes) ? options.stageCodes : [...options.stageCodes])
    : null
  for (const task of board.tasks) {
    if (stageCodes && !stageCodes.has(task.stageCode)) {
      fail('INVALID', `${task.id} 的阶段不存在：${task.stageCode}`)
    }
    for (const dep of task.dependsOn) {
      if (dep.id === task.id) fail('INVALID', `${task.id} 不能依赖自己`)
    }
  }

  const parentIds = new Set(board.tasks.filter((task) => task.parentId).map((task) => task.parentId))
  for (const task of board.tasks) {
    if (task.status === 'doing' && !task.holder && !parentIds.has(task.id)) {
      fail('INVALID', `${task.id} 进行中但没有持有者`)
    }
  }
  for (const task of board.tasks) {
    if (!task.parentId) continue
    if (!byId.has(task.parentId)) fail('INVALID', `${task.id} 的 parentId 不存在：${task.parentId}`)
    if (task.parentId === task.id) fail('INVALID', `${task.id} 不能以自己为父任务`)
    const depth = depthOf(board.tasks, task)
    if (depth > MAX_DEPTH) fail('INVALID', `${task.id} 层级过深（${depth} > ${MAX_DEPTH}）`)
    const seen = new Set([task.id])
    let parentId = task.parentId
    while (parentId) {
      if (seen.has(parentId)) fail('INVALID', `父子关系成环：${task.id}`)
      seen.add(parentId)
      parentId = byId.get(parentId) ? byId.get(parentId).parentId : undefined
    }
  }
  return board
}

function validateTask(task) {
  if (typeof task.title !== 'string') fail('INVALID', `${task.id} 缺少标题`)
  const title = task.title.trim()
  if (!title) fail('INVALID', `${task.id} 标题为空`)
  if (title.length > MAX_TITLE) fail('INVALID', `${task.id} 标题超过 ${MAX_TITLE} 字`)
  task.title = title
  if (!PRIORITIES.includes(task.priority)) fail('INVALID', `${task.id} 优先级非法：${String(task.priority)}`)
  if (!Number.isInteger(task.urgency) || task.urgency < 1 || task.urgency > 5) {
    fail('INVALID', `${task.id} 紧急度必须是 1..5`)
  }
  if (!STATUSES.includes(task.status)) fail('INVALID', `${task.id} 状态非法：${String(task.status)}`)
  if (task.parentId !== null && task.parentId !== undefined && typeof task.parentId !== 'string') {
    fail('INVALID', `${task.id} parentId 非法`)
  }
  if (task.parentId === undefined) task.parentId = null
  if (task.status === 'done' && !task.doneAt) task.doneAt = nowIso()
  for (const field of ['createdAt', 'updatedAt']) {
    if (typeof task[field] !== 'string') task[field] = nowIso()
  }
  if (!Array.isArray(task.tags)) task.tags = []
  normalizeTask(task)
  if (!STAGE_CODE_RE.test(task.stageCode)) fail('INVALID', `${task.id} 阶段编码非法：${String(task.stageCode)}`)
  if (typeof task.notes !== 'string') task.notes = ''
  if (typeof task.size !== 'string' && task.size !== null && task.size !== undefined) task.size = null
  if (typeof task.statusChangedAt !== 'string') task.statusChangedAt = task.updatedAt || task.createdAt || nowIso()
  if (task.archivedAt !== null && task.archivedAt !== undefined && typeof task.archivedAt !== 'string') task.archivedAt = null
  if (task.archivedAt === undefined) task.archivedAt = null
  if (typeof task.archiveExempt !== 'boolean') task.archiveExempt = false
  const seenDeps = new Set()
  for (const dep of task.dependsOn) {
    if (seenDeps.has(dep.id)) fail('INVALID', `${task.id} 重复依赖：${dep.id}`)
    seenDeps.add(dep.id)
  }
}

/** Validate the separate archive store. */
export function validateArchive(archive) {
  if (!archive || typeof archive !== 'object') fail('PARSE_ERROR', '归档文件不是对象')
  normalizeArchive(archive)
  if (archive.version !== ARCHIVE_VERSION) {
    fail('PARSE_ERROR', `不支持的归档文件版本 ${String(archive.version)}（期望 ${ARCHIVE_VERSION}）`)
  }
  if (typeof archive.project !== 'string') archive.project = 'project'
  if (!Number.isInteger(archive.revision) || archive.revision < 0) fail('PARSE_ERROR', '归档 revision 非法')
  if (typeof archive.updatedAt !== 'string') archive.updatedAt = nowIso()
  if (!Array.isArray(archive.tasks)) fail('PARSE_ERROR', '归档 tasks 必须是数组')
  const ids = new Set()
  for (const task of archive.tasks) {
    if (!task || typeof task !== 'object') fail('PARSE_ERROR', '归档任务必须是对象')
    if (typeof task.id !== 'string' || !ID_RE.test(task.id)) fail('INVALID', `非法归档任务 ID：${String(task.id)}`)
    if (ids.has(task.id)) fail('INVALID', `归档任务 ID 重复：${task.id}`)
    ids.add(task.id)
    validateTask(task)
    task.status = 'done'
    if (!task.doneAt) task.doneAt = nowIso()
    if (typeof task.archivedAt !== 'string') task.archivedAt = nowIso()
    if (typeof task.archivedBy !== 'string') task.archivedBy = 'system'
  }
  return archive
}

/* ------------------------------------------------------------- derivation */

/**
 * Recompute container status from children (bottom-up). Mutates and returns the board.
 * Containers are not claimable; their holder is always null.
 */
export function deriveParents(board) {
  const tasks = board.tasks
  const parentIds = new Set(tasks.filter((task) => task.parentId).map((task) => task.parentId))
  const ordered = [...tasks].sort((left, right) => depthOf(tasks, right) - depthOf(tasks, left))
  for (const task of ordered) {
    if (!parentIds.has(task.id)) continue
    const children = tasks.filter((candidate) => candidate.parentId === task.id)
    const active = children.filter((child) => child.status !== 'cancelled')
    let status
    let doneAt = null
    if (active.length === 0) {
      status = 'cancelled'
    } else if (active.every((child) => child.status === 'done')) {
      status = 'done'
      doneAt = active
        .map((child) => child.doneAt)
        .filter(Boolean)
        .sort()
        .at(-1) || nowIso()
    } else if (active.some((child) => child.status === 'doing')) {
      status = 'doing'
    } else {
      status = 'open'
    }
    if (task.status !== status) task.updatedAt = nowIso()
    applyStatus(task, status)
    task.holder = null
    task.claimedAt = null
    task.doneAt = status === 'done' ? doneAt : null
    if (status !== 'done') {
      task.doneVersion = null
      task.doneEvidence = null
      task.archivedAt = null
      task.archiveExempt = false
    }
  }
  return board
}

/* ------------------------------------------------------------- mutations */

/**
 * Create a task; returns it. The task code (`T-0001`, …) is allocated here from
 * the board counter and is never accepted from the caller: imports keep their
 * external code in `legacyId` instead.
 */
export function createTask(board, input, by) {
  const title = String(input.title || '').trim()
  if (!title) fail('INVALID', '标题不能为空')
  if (title.length > MAX_TITLE) fail('INVALID', `标题不能超过 ${MAX_TITLE} 字`)
  const parentId = input.parentId ? String(input.parentId) : null
  if (parentId) {
    const parent = board.tasks.find((task) => task.id === parentId)
    if (!parent) fail('NOT_FOUND', `父任务不存在：${parentId}`)
  }
  const stageCode = String(input.stageCode || DEFAULT_STAGE)
  if (!STAGE_CODE_RE.test(stageCode)) fail('INVALID', `阶段编码非法：${stageCode}`)
  const task = {
    id: `T-${String(board.nextId).padStart(4, '0')}`,
    legacyId: input.legacyId ? String(input.legacyId) : null,
    parentId,
    title,
    status: 'open',
    priority: PRIORITIES.includes(input.priority) ? input.priority : 'P2',
    urgency: normalizeUrgency(input.urgency === undefined || input.urgency === null ? 3 : input.urgency),
    holder: input.holder ? String(input.holder).trim() || null : null,
    size: input.size ? String(input.size) : null,
    notes: input.notes ? String(input.notes) : '',
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map((tag) => String(tag).trim()).filter(Boolean))] : [],
    stageCode,
    context: normalizeContext(input.context),
    dependsOn: Array.isArray(input.dependsOn) ? uniqueById(input.dependsOn.map(normalizeDependency).filter(Boolean)) : [],
    preconditions: Array.isArray(input.preconditions)
      ? uniqueById(input.preconditions.map(normalizePrecondition).filter(Boolean))
      : [],
    resources: Array.isArray(input.resources) ? uniqueById(input.resources.map(normalizeResource).filter(Boolean)) : [],
    causedBy: Array.isArray(input.causedBy) ? input.causedBy.map(normalizeCause).filter(Boolean) : [],
    causes: Array.isArray(input.causes) ? input.causes.map(normalizeCause).filter(Boolean) : [],
    createdBy: input.createdBy ? String(input.createdBy) : by ? String(by) : 'system',
    claimedBy: null,
    doneBy: null,
    releasedBy: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    claimedAt: null,
    statusChangedAt: nowIso(),
    archivedAt: null,
    archiveExempt: false,
    doneAt: null,
    doneVersion: null,
    doneEvidence: null,
    revision: 0,
  }
  board.nextId += 1
  board.tasks.push(task)
  return task
}

/** Update descriptive fields; status only through dedicated actions. */
export function updateTask(board, id, patch) {
  const task = findTask(board, id)
  let changed = false
  if (patch.title !== undefined) {
    const title = String(patch.title).trim()
    if (!title) fail('INVALID', '标题不能为空')
    if (title.length > MAX_TITLE) fail('INVALID', `标题不能超过 ${MAX_TITLE} 字`)
    if (title !== task.title) {
      task.title = title
      changed = true
    }
  }
  if (patch.priority !== undefined) {
    if (!PRIORITIES.includes(patch.priority)) fail('INVALID', `优先级非法：${patch.priority}`)
    if (task.priority !== patch.priority) {
      task.priority = patch.priority
      changed = true
    }
  }
  if (patch.urgency !== undefined) {
    const urgency = normalizeUrgency(patch.urgency)
    if (task.urgency !== urgency) {
      task.urgency = urgency
      changed = true
    }
  }
  if (patch.tags !== undefined) {
    if (!Array.isArray(patch.tags)) fail('INVALID', 'tags 必须是数组')
    const tags = [...new Set(patch.tags.map((tag) => String(tag).trim()).filter(Boolean))]
    if (JSON.stringify(tags) !== JSON.stringify(task.tags)) {
      task.tags = tags
      changed = true
    }
  }
  if (patch.group !== undefined) {
    // Compatibility: callers that still send `group` add it as a tag.
    const group = patch.group === null || patch.group === '' ? '' : String(patch.group).trim()
    if (group && !task.tags.includes(group)) {
      task.tags = [...task.tags, group]
      changed = true
    }
  }
  if (patch.notes !== undefined) {
    const notes = String(patch.notes)
    if (task.notes !== notes) {
      task.notes = notes
      changed = true
    }
  }
  if (patch.stageCode !== undefined) {
    const stageCode = String(patch.stageCode || DEFAULT_STAGE)
    if (!STAGE_CODE_RE.test(stageCode)) fail('INVALID', `阶段编码非法：${stageCode}`)
    if (task.stageCode !== stageCode) {
      task.stageCode = stageCode
      changed = true
    }
  }
  if (patch.parentId !== undefined) {
    const parentId = patch.parentId === null || patch.parentId === '' ? null : String(patch.parentId)
    if (parentId === id) fail('INVALID', '不能以自己为父任务')
    if (parentId) {
      let cursor = board.tasks.find((candidate) => candidate.id === parentId)
      if (!cursor) fail('NOT_FOUND', `父任务不存在：${parentId}`)
      let guard = 0
      while (cursor) {
        if (cursor.id === id) fail('INVALID', '不能挂到自己的子任务下')
        cursor = cursor.parentId ? board.tasks.find((candidate) => candidate.id === cursor.parentId) : undefined
        if ((guard += 1) > MAX_DEPTH + 1) fail('INVALID', '父子层级异常')
      }
    }
    if (task.parentId !== parentId) {
      task.parentId = parentId
      changed = true
    }
  }
  if (changed) task.updatedAt = nowIso()
  return changed
}

function normalizeUrgency(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 5) fail('INVALID', '紧急度必须是 1..5 的整数')
  return number
}

/** Change status and stamp `statusChangedAt` exactly when it changes. */
function applyStatus(task, status) {
  if (task.status === status) return false
  task.status = status
  task.statusChangedAt = nowIso()
  task.updatedAt = task.statusChangedAt
  return true
}

/** Claim one leaf task. */
export function claimTask(board, id, by, force = false) {
  const task = findTask(board, id)
  assertLeaf(task, board.tasks)
  if (!by) fail('INVALID', '缺少持有者（by）')
  if (task.status === 'done' || task.status === 'cancelled') fail('CONFLICT', `${task.id} 已结束，不能认领`)
  if (task.holder && task.holder !== by && !force) {
    fail('CONFLICT', `${task.id} 已被 ${task.holder} 持有`)
  }
  if (task.status === 'doing' && task.holder === by) return false
  task.holder = by
  task.claimedBy = by
  task.claimedAt = nowIso()
  applyStatus(task, 'doing')
  return true
}

/** Claim the top N open leaves carrying one tag (or everywhere). */
export function claimBatch(board, by, tag, limit, force = false) {
  if (!by) fail('INVALID', '缺少持有者（by）')
  const available = board.tasks.filter((task) => {
    if (isContainer(task, board.tasks)) return false
    if (task.status !== 'open') return false
    if (tag && !(task.tags || []).includes(tag)) return false
    return true
  })
  const candidates = sortTasks(available).slice(0, Math.max(1, Math.min(20, Number(limit) || 3)))
  const claimed = []
  const skipped = []
  for (const task of candidates) {
    try {
      if (claimTask(board, task.id, by, force)) claimed.push(task.id)
    } catch (error) {
      skipped.push({ id: task.id, reason: error.message })
    }
  }
  return { claimed, skipped, available: available.length }
}

/** Release a task held by `by`. */
export function releaseTask(board, id, by, force = false) {
  const task = findTask(board, id)
  assertLeaf(task, board.tasks)
  if (task.status !== 'doing' && task.status !== 'blocked') fail('CONFLICT', `${task.id} 不在进行中`)
  if (task.holder && task.holder !== by && !force) fail('CONFLICT', `${task.id} 由 ${task.holder} 持有`)
  task.holder = null
  task.claimedAt = null
  task.releasedBy = by || null
  applyStatus(task, 'open')
}

/** Release every task carrying one tag currently held by `by`. */
export function releaseBatch(board, by, tag) {
  const targets = board.tasks.filter((task) => {
    if (isContainer(task, board.tasks)) return false
    if (task.status !== 'doing' && task.status !== 'blocked') return false
    if (task.holder !== by) return false
    if (tag && !(task.tags || []).includes(tag)) return false
    return true
  })
  for (const task of targets) {
    task.holder = null
    task.claimedAt = null
    task.releasedBy = by || null
    applyStatus(task, 'open')
  }
  return targets.map((task) => task.id)
}

/** Complete a leaf task. */
export function completeTask(board, id, by, options = {}) {
  const task = findTask(board, id)
  assertLeaf(task, board.tasks)
  if (task.status !== 'doing') fail('CONFLICT', `${task.id} 不在进行中，不能完成`)
  if (task.holder && task.holder !== by && !options.force) {
    fail('CONFLICT', `${task.id} 由 ${task.holder} 持有，不能由 ${by} 完成`)
  }
  task.doneAt = nowIso()
  task.doneBy = by || null
  task.doneVersion = options.version ? String(options.version) : null
  task.doneEvidence = options.evidence ? String(options.evidence) : null
  applyStatus(task, 'done')
}

/** Block a leaf task. */
export function blockTask(board, id, by) {
  const task = findTask(board, id)
  assertLeaf(task, board.tasks)
  if (task.status !== 'open' && task.status !== 'doing') fail('CONFLICT', `${task.id} 不能标记阻塞`)
  if (task.status === 'doing' && task.holder && task.holder !== by) {
    fail('CONFLICT', `${task.id} 由 ${task.holder} 持有`)
  }
  applyStatus(task, 'blocked')
}

/** Unblock: back to doing when it still has a holder, otherwise open. */
export function unblockTask(board, id) {
  const task = findTask(board, id)
  assertLeaf(task, board.tasks)
  if (task.status !== 'blocked') fail('CONFLICT', `${task.id} 不在阻塞中`)
  applyStatus(task, task.holder ? 'doing' : 'open')
}

/** Reopen a done/cancelled task. */
export function reopenTask(board, id) {
  const task = findTask(board, id)
  assertLeaf(task, board.tasks)
  if (task.status !== 'done' && task.status !== 'cancelled') fail('CONFLICT', `${task.id} 不是已结束任务`)
  task.holder = null
  task.claimedAt = null
  task.claimedBy = null
  task.doneBy = null
  task.releasedBy = null
  task.doneAt = null
  task.doneVersion = null
  task.doneEvidence = null
  task.archivedAt = null
  task.archiveExempt = false
  applyStatus(task, 'open')
}

/**
 * Set one leaf task's status through the canonical transition functions.
 * Used by the detail form's status dropdown + Save.
 */
export function setStatusTask(board, id, status, by, force = false, extra = {}) {
  const task = findTask(board, id)
  if (!STATUSES.includes(status)) fail('INVALID', `状态非法：${String(status)}`)
  if (task.status === status) return false
  assertLeaf(task, board.tasks)
  if (status === 'open') {
    if (task.status === 'done' || task.status === 'cancelled') {
      reopenTask(board, id)
      return true
    }
    releaseTask(board, id, by, force)
    return true
  }
  if (status === 'doing') {
    claimTask(board, id, by, force)
    return true
  }
  if (status === 'done') {
    if (task.status !== 'doing') claimTask(board, id, by, force)
    completeTask(board, id, by, { ...extra, force })
    return true
  }
  if (status === 'blocked') {
    blockTask(board, id, by)
    return true
  }
  if (status === 'cancelled') {
    if (task.status === 'done') fail('CONFLICT', '已完成任务请用归档处理，不能改为已取消')
    deleteTask(board, id, { cascade: false })
    return true
  }
  fail('INVALID', `不支持的状态：${String(status)}`)
}

/** Soft-delete (cancelled) or purge a task, optionally with descendants. */
export function deleteTask(board, id, options = {}) {
  const task = findTask(board, id)
  const descendants = descendantsOf(board.tasks, id)
  const hasChildren = descendants.length > 0
  const active = descendants.filter((child) => child.status !== 'cancelled')
  if (hasChildren && !options.cascade) {
    fail('CONFLICT', `${task.id} 还有 ${active.length || descendants.length} 个子任务，需要 cascade=true`)
  }
  if (options.purge) {
    const drop = new Set([task.id, ...descendants.map((child) => child.id)])
    board.tasks = board.tasks.filter((candidate) => !drop.has(candidate.id))
    return
  }
  for (const target of [task, ...descendants]) {
    if (target.status === 'done') continue
    target.holder = null
    target.claimedAt = null
    target.claimedBy = null
    applyStatus(target, 'cancelled')
  }
}

/** All descendants (any depth) of one task. */
export function descendantsOf(tasks, id) {
  const result = []
  const queue = tasks.filter((task) => task.parentId === id)
  while (queue.length) {
    const next = queue.shift()
    result.push(next)
    queue.push(...tasks.filter((task) => task.parentId === next.id))
  }
  return result
}

/** Recomputed container progress; only meaningful for containers. */
export function progressOf(board, task) {
  const children = board.tasks.filter((candidate) => candidate.parentId === task.id && candidate.status !== 'cancelled')
  const done = children.filter((child) => child.status === 'done').length
  return { done, total: children.length }
}
