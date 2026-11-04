/**
 * Shared application layer: the Web API and the CLI call these same functions,
 * so both surfaces agree on state and errors.
 */
import path from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import * as model from './model.js'
import { storeFor } from './store.js'
import { orgStoreFor } from './org.js'
import { tagStoreFor } from './tags.js'
import { importLegacy } from './import.js'
import { formatBoardText, formatTaskText } from './format.js'
import { exportData, importFromFile, resolveProjectPath } from './transfer.js'
import { resolveDoneVersion, versionMissingMessage } from './version.js'
import { decorateState, decorateTask, buildContext, evaluatePreconditions } from './derive.js'
import { addDependency, removeDependency, unlockedBy } from './deps.js'
import { appendDecision, setProgress, addOpenLoop, closeOpenLoop, interruptedProgress } from './context-ops.js'
import { addPrecondition, removePrecondition, confirmPrecondition } from './preconditions.js'
import { addResource, approveResource, supersedeResource, listResources } from './resources.js'
import { addCause, removeCause, listCauses, causeChain } from './causes.js'
import { buildStartBrief, buildHandoff } from './brief.js'
import { autoEvidence, commitExists, linkRepo, listGitAuthors, relatedCommits } from './git.js'
import { resolveActor, stripToolPrefix } from './actor.js'

function storeOf(root, config) {
  return storeFor(root, config)
}

/**
 * The human behind one action: explicit `person` > explicit `holder` > the
 * actor without one `<tool>:` prefix. The service never reads git itself, so
 * HTTP callers (which pass the resolved person) and the CLI agree.
 */
function personOf(payload, by) {
  const explicit = String(payload.person == null ? '' : payload.person).trim()
  if (explicit) return explicit
  const holder = String(payload.holder == null ? '' : payload.holder).trim()
  if (holder) return holder
  return stripToolPrefix(by) || String(by || '')
}

/** Holder used by claim/start: an explicit holder wins, otherwise the person. */
function holderOf(payload, person) {
  const explicit = String(payload.holder == null ? '' : payload.holder).trim()
  return explicit || person
}

/** Person fields that must always name a real git author. */
const PERSON_FIELDS = ['holder', 'createdBy', 'doneBy', 'claimedBy', 'releasedBy', 'archivedBy']

/** Git authors are the only valid owners; non-git projects degrade to no check. */
async function gitAuthorsFor(root, config) {
  const dir = config.version?.gitDir ? path.resolve(root, config.version.gitDir) : root
  return listGitAuthors(dir).catch(() => [])
}

/**
 * Reject an owner that is not a git author. Projects without any git history
 * keep working (there is no authoritative list to validate against).
 */
async function assertPersonAllowed(root, config, name, cwd) {
  const value = String(name == null ? '' : name).trim()
  if (!value) return value
  const authors = await gitAuthorsFor(root, config, cwd)
  if (!authors.length) return value
  if (!authors.includes(value)) {
    model.fail('INVALID', `负责人必须是 git 记录中的人员：${value}（可选：${authors.join('、')}）`)
  }
  return value
}

/**
 * Completion of the milestone that owns `task`: active leaf tasks only
 * (cancelled excluded, archived done tasks count as done).
 * @returns {{code: string, name: string, done: number, total: number, complete: boolean}|null}
 */
function milestoneProgress(org, board, archiveTasks, task) {
  const stage = org.stages.find((entry) => entry.code === task.stageCode)
  if (!stage) return null
  const milestone = org.milestones.find((entry) => entry.code === stage.milestoneCode)
  if (!milestone) return null
  const stageCodes = new Set(org.stages.filter((entry) => entry.milestoneCode === milestone.code).map((entry) => entry.code))
  const all = [...(board.tasks || []), ...(archiveTasks || [])]
  const parentIds = new Set(all.filter((entry) => entry.parentId).map((entry) => entry.parentId))
  const leaves = all.filter(
    (entry) => !parentIds.has(entry.id) && stageCodes.has(entry.stageCode) && entry.status !== 'cancelled',
  )
  const done = leaves.filter((entry) => entry.status === 'done').length
  const total = leaves.length
  return { code: milestone.code, name: milestone.name || milestone.code, done, total, complete: total > 0 && done === total }
}

function tagsOfTasks(tasks) {
  const tags = new Set()
  for (const task of tasks) for (const tag of task.tags || []) tags.add(tag)
  return [...tags].sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

function requireStage(org, code) {
  if (!code) return model.DEFAULT_STAGE
  const stage = org.stages.find((entry) => entry.code === code)
  if (!stage) model.fail('NOT_FOUND', `没有阶段 ${code}`)
  return stage.code
}

async function resolveTags(tagStore, values, by, config) {
  if (values === undefined) return { codes: undefined, warnings: [] }
  if (!Array.isArray(values)) model.fail('INVALID', 'tags 必须是数组')
  const result = await tagStore.ensure(values, by, { strict: config.tag?.strict === true })
  return { codes: result.codes, warnings: result.warnings }
}

/** A cached commit-exists predicate for precondition evaluation. */
async function makeCommitChecker(root, config, board, options = {}) {
  const commits = new Set()
  for (const task of board.tasks || []) {
    for (const pre of task.preconditions || []) {
      if (pre.type === 'commit_exists' && pre.params?.commit) commits.add(String(pre.params.commit))
    }
  }
  if (!commits.size) return () => false
  const dir = config.version?.gitDir ? path.resolve(root, config.version.gitDir) : options.cwd || root
  const cache = new Map()
  for (const commit of commits) cache.set(commit, await commitExists(dir, commit))
  return (commit) => cache.get(String(commit)) || false
}

/** Snapshot used by both HTTP and the CLI after a load. */
export async function getState(root, config, options = {}) {
  const store = storeOf(root, config)
  try {
    await store.sweepArchive()
  } catch {
    /* archive sweep must never block reading the board */
  }
  const [board, archive, org, tags] = await Promise.all([
    store.read(),
    store.readArchive(),
    orgStoreFor(root, config).read(),
    tagStoreFor(root, config).read(),
  ])
  const commit = await makeCommitChecker(root, config, board, options)
  const decorated = decorateState({ board, archive, org, tags, commitExists: commit })
  return {
    ok: true,
    root,
    storePath: store.file,
    archivePath: store.archiveFile,
    markdownPath: store.markdownFile,
    archiveMarkdownPath: store.archiveMarkdownFile,
    board: decorated.board,
    archived: decorated.archived,
    milestones: decorated.milestones,
    stages: decorated.stages,
    tags: decorated.tags,
    counts: decorated.counts,
    config: {
      defaultTab: config.ui?.defaultTab || 'auto',
      archiveAfterDays: config.archive?.afterDays ?? 0,
      claimLimit: config.batch?.claimLimit ?? 3,
      versionRequired: config.version?.require === true,
      tagStrict: config.tag?.strict === true,
      historyPath: store.historyFile,
    },
  }
}

/** One task from either store, with its archive flag, context and history. */
export async function getTask(root, config, id, options = {}) {
  const store = storeOf(root, config)
  const [board, archive, org, tags] = await Promise.all([
    store.read(),
    store.readArchive(),
    orgStoreFor(root, config).read(),
    tagStoreFor(root, config).read(),
  ])
  let source = board
  let archived = false
  let task = board.tasks.find((candidate) => candidate.id === id)
  if (!task) {
    source = archive
    task = archive.tasks.find((candidate) => candidate.id === id)
    archived = true
  }
  if (!task) model.fail('NOT_FOUND', `没有任务 ${id}`)
  const commit = await makeCommitChecker(root, config, board, options)
  const ctx = buildContext({ board, archive, org, commitExists: commit })
  const decorated = decorateTask(task, ctx)
  const parent = task.parentId ? source.tasks.find((candidate) => candidate.id === task.parentId) || null : null
  const children = model.sortTasks(source.tasks.filter((candidate) => candidate.parentId === id))
  const history = await store.readHistory(20, id)
  const stage = org.stages.find((entry) => entry.code === task.stageCode) || null
  const milestone = stage ? org.milestones.find((entry) => entry.code === stage.milestoneCode) || null : null
  const dir = config.version?.gitDir ? path.resolve(root, config.version.gitDir) : options.cwd || root
  const commits = await relatedCommits(dir, id, 5).catch(() => [])
  return {
    ok: true,
    board: source,
    task: decorated,
    parent,
    children,
    history,
    archived,
    stage,
    milestone,
    preconditions: evaluatePreconditions(task, { ...ctx, task }),
    blocking: decorated.blocking,
    staleResources: decorated.staleResources,
    relatedCommits: commits,
  }
}

function snapshotOf(entry, id) {
  const after = (entry.after || []).find((task) => task.id === id)
  const before = (entry.before || []).find((task) => task.id === id)
  return { before: before || null, after: after || null }
}

function taskTagsOf(entry, id, byId) {
  const task = byId.get(id)
  if (task) return task.tags || []
  const snapshot = snapshotOf(entry, id)
  const candidate = snapshot.after || snapshot.before
  return (candidate && candidate.tags) || []
}

function changesOf(entry, id) {
  const { before, after } = snapshotOf(entry, id)
  if (!before || !after) return []
  const changes = []
  for (const field of ['title', 'status', 'priority', 'urgency', 'holder', 'notes', 'doneVersion', 'doneEvidence']) {
    if (before[field] !== after[field]) changes.push({ field, from: before[field] ?? null, to: after[field] ?? null })
  }
  const beforeTags = (before.tags || []).join('、')
  const afterTags = (after.tags || []).join('、')
  if (beforeTags !== afterTags) changes.push({ field: 'tags', from: beforeTags || null, to: afterTags || null })
  return changes
}

const TIMELINE_TYPES = {
  task: ['create', 'update', 'claim', 'release', 'start', 'done', 'block', 'unblock', 'reopen', 'delete', 'purge', 'claim_batch', 'release_batch', 'archive', 'unarchive', 'auto_archive'],
  dependency: ['dep_add', 'dep_remove', 'dependency_resolved'],
  org: ['milestone_create', 'milestone_update', 'milestone_delete', 'milestone_dep_add', 'milestone_dep_remove', 'stage_create', 'stage_update', 'stage_reorder', 'stage_delete', 'stage_dep_add', 'stage_dep_remove'],
  tag: ['tag_add', 'tag_update', 'tag_deprecate', 'tag_ensure'],
  context: ['context_decision', 'context_progress', 'context_loop', 'context_loop_close'],
  resource: ['res_add', 'res_approve', 'res_supersede'],
  precondition: ['pre_add', 'pre_remove', 'pre_confirm'],
  cause: ['cause_add', 'cause_remove'],
  import: ['import'],
}

/**
 * Timeline with three granularities:
 * - project: all recorded actions
 * - tag: entries touching at least one task carrying that tag
 * - task: one task, including field-level changes
 *
 * `q` is a case-insensitive fuzzy match over task codes, titles, tags, notes,
 * action and actor. The list is always newest-first and capped at `limit`
 * (default 20), while `matched`/`total` describe the whole log.
 */
export async function getTimeline(root, config, options = {}) {
  const store = storeOf(root, config)
  const board = await store.read()
  const archive = await store.readArchive()
  const byId = new Map([...board.tasks, ...archive.tasks].map((task) => [task.id, task]))
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 20))
  const scope = ['project', 'tag', 'task'].includes(options.scope) ? options.scope : 'project'
  const q = String(options.q || '').trim().toLowerCase()
  const taskId = options.taskId ? String(options.taskId) : ''
  const tag = options.tag ? String(options.tag) : ''
  const type = options.type && TIMELINE_TYPES[options.type] ? options.type : ''
  const matches = (entry) => {
    const ids = entry.taskIds || []
    if (type && !TIMELINE_TYPES[type].includes(entry.action)) return false
    if (scope === 'task' && !ids.includes(taskId)) return false
    if (scope === 'tag' && tag && !ids.some((id) => taskTagsOf(entry, id, byId).includes(tag))) return false
    if (q && !searchHaystack(entry, byId).includes(q)) return false
    return true
  }
  const { entries, total, matched } = await store.findHistory(matches, limit)
  return {
    ok: true,
    scope,
    q,
    limit,
    total,
    matched,
    entries: entries.map((entry) => ({
      at: entry.at,
      revision: entry.revision,
      action: entry.action,
      by: entry.by,
      entity: entry.entity || 'task',
      taskIds: entry.taskIds || [],
      transitions: (entry.transitions || []).map((transition) => {
        const snapshot = snapshotOf(entry, transition.id)
        return {
          ...transition,
          title: byId.get(transition.id)?.title || snapshot.after?.title || snapshot.before?.title || '',
          tags: taskTagsOf(entry, transition.id, byId),
          version: transition.to === 'done' ? snapshot.after?.doneVersion || byId.get(transition.id)?.doneVersion || null : null,
        }
      }),
      changes:
        scope === 'task'
          ? (entry.taskIds || []).flatMap((id) => changesOf(entry, id).map((change) => ({ id, ...change })))
          : [],
    })),
  }
}

function searchHaystack(entry, byId) {
  const parts = [entry.action, entry.by]
  for (const id of entry.taskIds || []) {
    parts.push(id)
    const current = byId.get(id)
    if (current) parts.push(current.title, ...(current.tags || []))
  }
  for (const transition of entry.transitions || []) parts.push(transition.id, transition.title || '', transition.from || '', transition.to || '')
  for (const task of [...(entry.before || []), ...(entry.after || [])]) {
    parts.push(task.id, task.title, task.notes, task.doneVersion, ...(task.tags || []))
  }
  return parts.filter(Boolean).join('\n').toLowerCase()
}

/** Write an export file under `<root>/.dsh/exports/`. */
export async function exportProject(root, config, options = {}) {
  const state = await getState(root, config)
  const scope = ['active', 'archive', 'all'].includes(options.scope) ? options.scope : 'active'
  const format = options.format === 'xlsx' ? 'xlsx' : 'md'
  const out = await exportData(state, scope, format, config)
  const dir = path.join(root, '.dsh', 'exports')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, out.filename)
  await writeFile(file, out.data)
  return { ok: true, path: file, filename: out.filename, contentType: out.contentType, scope, format }
}

/** Import rows from a project-relative file path. */
export async function importProjectFile(root, config, options = {}) {
  const store = storeOf(root, config)
  const file = resolveProjectPath(root, String(options.file || options.path || ''))
  const format = options.format === 'xlsx' || String(file).toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'md'
  return importFromFile(store, config, file, { format, dryRun: options.dryRun === true, by: options.by })
}

/** Resolved completion version for the UI completion dialog. */
export async function getVersionInfo(root, config, context = {}) {
  const resolved = await resolveDoneVersion(root, config, { cwd: context.cwd })
  return {
    ok: true,
    version: resolved.version || null,
    source: resolved.source,
    dir: resolved.dir || null,
    required: config.version.require === true,
    message: resolved.version ? `将记录版本 ${resolved.version}` : '未检测到 git 仓库，请手动填写版本号',
  }
}

/**
 * People the assignment picker can offer: distinct git commit authors, plus
 * the current person when they are a git author. Task-only names (tool ids,
 * session ids from older data) are deliberately excluded: an owner must be a
 * real person in git history. Non-git projects keep the old permissive
 * behaviour because there is no authoritative list.
 */
export async function getPeople(root, config, options = {}) {
  const store = storeOf(root, config)
  const [board, archive] = await Promise.all([store.read(), store.readArchive()])
  const info = options.person ? null : resolveActor({ root, cwd: options.cwd || root, env: process.env })
  const person = String(options.person || (info && info.person) || '').trim()
  const gitAuthors = await gitAuthorsFor(root, config, options.cwd || root)
  const hasGit = gitAuthors.length > 0
  const byName = new Map()
  const ensure = (value) => {
    const name = String(value == null ? '' : value).trim()
    if (!name) return null
    if (hasGit && !gitAuthors.includes(name)) return null
    let entry = byName.get(name)
    if (!entry) {
      entry = { name, sources: new Set(), active: 0, done: 0 }
      byName.set(name, entry)
    }
    return entry
  }
  for (const name of gitAuthors) {
    const entry = ensure(name)
    if (entry) entry.sources.add('git')
  }
  for (const task of [...(board.tasks || []), ...(archive.tasks || [])]) {
    const names = new Set([task.holder, task.createdBy, task.doneBy].filter(Boolean).map((value) => String(value).trim()))
    for (const name of names) {
      const entry = ensure(name)
      if (!entry) continue
      entry.sources.add('task')
      if (task.status === 'done') entry.done += 1
      else if (task.status !== 'cancelled') entry.active += 1
    }
  }
  if (person) {
    const entry = ensure(person)
    if (entry) entry.sources.add('me')
  }
  const sourceOf = (sources) => (sources.has('me') ? 'me' : sources.has('git') ? 'git' : 'task')
  const people = [...byName.values()]
    .map((entry) => ({
      name: entry.name,
      source: sourceOf(entry.sources),
      active: entry.active,
      done: entry.done,
      related: entry.active + entry.done,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  return { person, people }
}

/**
 * Repair legacy/invalid person fields in one lock. Only non-empty values that
 * are not git authors are rewritten; null stays null (unassigned), so the
 * "ready" pool is not silently turned into assigned work.
 */
export async function repairPeople(root, config, options = {}) {
  const store = storeOf(root, config)
  const authors = await gitAuthorsFor(root, config, options.cwd || root)
  if (!authors.length) model.fail('INVALID', '当前项目没有 git 作者记录，无法确定有效负责人')
  const person = String(options.person == null ? '' : options.person).trim()
  if (!person) model.fail('INVALID', 'repair-people 需要 --person')
  if (!authors.includes(person)) {
    model.fail('INVALID', `负责人必须是 git 记录中的人员：${person}（可选：${authors.join('、')}）`)
  }
  const valid = new Set(authors)
  const plan = (board) => {
    const changes = []
    for (const task of board.tasks) {
      for (const field of PERSON_FIELDS) {
        const value = String(task[field] == null ? '' : task[field]).trim()
        if (!value || valid.has(value)) continue
        changes.push({ id: task.id, field, from: value, to: person })
        task[field] = person
        task.updatedAt = model.nowIso()
      }
    }
    return changes
  }
  const snapshot = await store.read()
  const preview = plan(structuredClone(snapshot))
  const changedTasks = [...new Set(preview.map((change) => change.id))]
  if (options.dryRun) {
    return { ok: true, action: 'repair_people', dryRun: true, person, validPeople: authors, changes: preview, changedTasks }
  }
  if (!preview.length) {
    return { ok: true, action: 'repair_people', dryRun: false, person, validPeople: authors, changes: [], changedTasks: [] }
  }
  let changes = []
  const mutated = await store.mutate('repair_people', options.by || person, (board) => {
    changes = plan(board)
    return { changedTasks: [...new Set(changes.map((change) => change.id))] }
  })
  return {
    ok: true,
    action: 'repair_people',
    dryRun: false,
    person,
    validPeople: authors,
    changes,
    changedTasks,
    board: mutated.board,
    warning: mutated.warning,
  }
}

/** The one action dispatcher used by HTTP and the CLI. */
export async function act(root, config, payload, defaultBy, context = {}) {
  const store = storeOf(root, config)
  const orgStore = orgStoreFor(root, config)
  const tagStore = tagStoreFor(root, config)
  const action = String(payload.action || '')
  const by = String(payload.by || defaultBy || 'session')
  const person = personOf(payload, by)
  const tag = payload.tag ? String(payload.tag) : payload.group ? String(payload.group) : null
  /** Explicit version wins; otherwise auto-resolve a git short hash. */
  const resolveVersion = async (explicit) => {
    const manual = String(explicit == null ? '' : explicit).trim()
    if (manual) return manual.slice(0, 64)
    if (config.version.auto === false) {
      if (config.version.require === true) model.fail('INVALID', versionMissingMessage())
      return null
    }
    const resolved = await resolveDoneVersion(root, config, { cwd: context.cwd })
    if (resolved.version) return resolved.version
    if (config.version.require === true) model.fail('INVALID', versionMissingMessage())
    return null
  }
  const finish = (result) => ({ ...result, action })
  switch (action) {
    case 'create': {
      await assertPersonAllowed(root, config, person, context.cwd)
      if (payload.holder) await assertPersonAllowed(root, config, payload.holder, context.cwd)
      const org = await orgStore.read()
      const stageCode = requireStage(org, payload.stageCode || model.DEFAULT_STAGE)
      const tags = await resolveTags(tagStore, payload.tags, by, config)
      let id
      const mutated = await store.mutate('create', by, (board) => {
        const task = model.createTask(
          board,
          {
            title: payload.title,
            parentId: payload.parentId,
            priority: payload.priority,
            urgency: payload.urgency,
            tags: tags.codes,
            notes: payload.notes,
            stageCode,
            dependsOn: payload.dependsOn,
            // Assigned only when the caller explicitly asks for it; the person
            // is the default creator, not the default assignee.
            holder: payload.holder,
          },
          person,
        )
        id = task.id
        return { changedTasks: [task.id] }
      })
      const task = mutated.board.tasks.find((candidate) => candidate.id === id)
      return finish({
        ok: true,
        board: mutated.board,
        task,
        warnings: tags.warnings,
        message: `已新建 ${task.id} ${task.title}${tags.warnings.length ? `\n⚠ ${tags.warnings.join('\n⚠ ')}` : ''}`,
        warning: mutated.warning,
      })
    }
    case 'update': {
      const id = String(payload.id || '')
      const org = await orgStore.read()
      if (payload.stageCode !== undefined) requireStage(org, payload.stageCode)
      const tags = await resolveTags(tagStore, payload.tags, by, config)
      let changed = false
      let statusChanged = false
      let doneVersion = null
      if (String(payload.status || '') === 'done') await assertPersonAllowed(root, config, person, context.cwd)
      const mutated = await store.mutate('update', by, async (board) => {
        changed = model.updateTask(board, id, { ...payload, tags: tags.codes })
        if (payload.status !== undefined && payload.status !== null && payload.status !== '') {
          const target = String(payload.status)
          const current = board.tasks.find((candidate) => candidate.id === id)
          const wasDone = !!(current && current.status === 'done')
          if (target === 'done' && current && !wasDone) {
            doneVersion = await resolveVersion(payload.version)
          }
          statusChanged = model.setStatusTask(board, id, target, person, payload.force === true, {
            version: doneVersion,
            evidence: payload.evidence,
          })
          if (!statusChanged && wasDone && current) {
            if (payload.version !== undefined) {
              const version = String(payload.version).trim()
              if (version !== (current.doneVersion || '')) {
                current.doneVersion = version || null
                current.updatedAt = model.nowIso()
                changed = true
              }
            }
            if (payload.evidence !== undefined) {
              const evidence = String(payload.evidence).trim()
              if (evidence !== (current.doneEvidence || '')) {
                current.doneEvidence = evidence || null
                current.updatedAt = model.nowIso()
                changed = true
              }
            }
          }
        }
        return { changedTasks: changed || statusChanged ? [id] : [] }
      })
      const task = mutated.board.tasks.find((candidate) => candidate.id === id)
      return finish({
        ok: true,
        board: mutated.board,
        task,
        version: doneVersion,
        warnings: tags.warnings,
        message:
          (changed || statusChanged ? `已更新 ${id}` : `${id} 没有变化`) +
          (doneVersion ? `（版本 ${doneVersion}）` : '') +
          (tags.warnings.length ? `\n⚠ ${tags.warnings.join('\n⚠ ')}` : ''),
        warning: mutated.warning,
      })
    }
    case 'claim': {
      const id = String(payload.id || '')
      const holder = holderOf(payload, person)
      await assertPersonAllowed(root, config, holder, context.cwd)
      let changed = false
      const mutated = await store.mutate('claim', by, (board) => {
        changed = model.claimTask(board, id, holder, payload.force === true)
        return { changedTasks: changed ? [id] : [] }
      })
      return finish({
        ok: true,
        board: mutated.board,
        message: changed ? `已认领 ${id}（${holder}）` : `${id} 已在你名下`,
        warning: mutated.warning,
      })
    }
    case 'claim_batch': {
      const limit = Number(payload.limit) || config.batch.claimLimit
      const holder = holderOf(payload, person)
      await assertPersonAllowed(root, config, holder, context.cwd)
      let outcome
      const mutated = await store.mutate('claim_batch', by, (board) => {
        outcome = model.claimBatch(board, holder, tag, limit, payload.force === true)
        return { changedTasks: outcome.claimed }
      })
      const skipped = outcome.skipped.length ? `；跳过 ${outcome.skipped.map((item) => item.id).join('、')}` : ''
      return finish({
        ok: true,
        board: mutated.board,
        claimed: outcome.claimed,
        skipped: outcome.skipped,
        available: outcome.available,
        message: outcome.claimed.length ? `已认领 ${outcome.claimed.join('、')}${skipped}` : `没有可认领的任务${skipped}`,
        warning: mutated.warning,
      })
    }
    case 'release': {
      const id = String(payload.id || '')
      const note = payload.note !== undefined ? String(payload.note) : ''
      let handoff = null
      const mutated = await store.mutate('release', by, (board) => {
        const task = model.findTask(board, id)
        model.releaseTask(board, id, person, payload.force === true)
        task.context.progress = interruptedProgress(task)
        if (note) addOpenLoop(task, note, by, config.context?.maxOpenLoops || 20)
        handoff = buildHandoff(task, note)
        return { changedTasks: [id] }
      })
      return finish({
        ok: true,
        board: mutated.board,
        handoff,
        message: `已释放 ${id}${handoff.progress ? `（${handoff.progress}）` : ''}`,
        warning: mutated.warning,
      })
    }
    case 'release_batch': {
      let released
      const mutated = await store.mutate('release_batch', by, (board) => {
        released = model.releaseBatch(board, person, tag)
        return { changedTasks: released }
      })
      return finish({
        ok: true,
        board: mutated.board,
        released,
        message: released.length ? `已释放 ${released.join('、')}` : '没有由你持有的任务',
        warning: mutated.warning,
      })
    }
    case 'start': {
      const id = String(payload.id || '')
      const holder = holderOf(payload, person)
      await assertPersonAllowed(root, config, holder, context.cwd)
      const before = await getState(root, config, { cwd: context.cwd })
      const beforeTask = before.board.tasks.find((candidate) => candidate.id === id)
      if (!beforeTask) model.fail('NOT_FOUND', `没有任务 ${id}`)
      if (beforeTask.status === 'doing' && beforeTask.holder === holder) {
        const state = { board: before.board, archive: { tasks: before.archived }, org: { milestones: before.milestones, stages: before.stages }, tags: { tags: before.tags } }
        return finish({
          ok: true,
          board: before.board,
          task: beforeTask,
          brief: buildStartBrief(state, beforeTask),
          message: `已在执行 ${id}`,
        })
      }
      // A task can be pre-assigned to its creator (CLI create passes holder),
      // and `isReady` means "unassigned open leaf". Starting a task that is
      // already yours is allowed as long as nothing else blocks it.
      const stageOfTask = before.stages.find((entry) => entry.code === beforeTask.stageCode) || null
      const milestoneOfTask = stageOfTask
        ? before.milestones.find((entry) => entry.code === stageOfTask.milestoneCode) || null
        : null
      const assignedOnly =
        (!beforeTask.holder || beforeTask.holder === holder) &&
        beforeTask.status === 'open' &&
        !before.board.tasks.some((candidate) => candidate.parentId === id) &&
        beforeTask.effectiveStatus === 'open' &&
        stageOfTask?.status !== 'archived' &&
        milestoneOfTask?.status !== 'archived'
      if (!beforeTask.isReady && !assignedOnly) {
        const reasons = [
          ...(beforeTask.blocking || []).map((entry) => `依赖 ${entry.id} 未完成`),
          ...beforeTask.preconditions.filter((pre) => pre.required !== false && !pre.satisfied).map((pre) => `前置 ${pre.id} 未满足`),
        ]
        model.fail('NOT_READY', `${id} 尚未就绪${reasons.length ? `：${reasons.join('；')}` : ''}`)
      }
      const mutated = await store.mutate('start', by, (board) => {
        model.claimTask(board, id, holder, false)
        return { changedTasks: [id] }
      })
      const after = await getState(root, config, { cwd: context.cwd })
      const task = after.board.tasks.find((candidate) => candidate.id === id)
      const state = { board: after.board, archive: { tasks: after.archived }, org: { milestones: after.milestones, stages: after.stages }, tags: { tags: after.tags } }
      return finish({
        ok: true,
        board: mutated.board,
        task,
        brief: buildStartBrief(state, task),
        message: `已开始 ${id}`,
        warning: mutated.warning,
      })
    }
    case 'done': {
      const id = String(payload.id || '')
      await assertPersonAllowed(root, config, person, context.cwd)
      let doneVersion = null
      let unlocked = []
      let evidence = payload.evidence ? String(payload.evidence) : ''
      const archive = await store.readArchive()
      const org = await orgStore.read()
      const mutated = await store.mutate('done', by, async (board) => {
        const current = board.tasks.find((candidate) => candidate.id === id)
        if (!current) model.fail('NOT_FOUND', `没有任务 ${id}`)
        if (current.status === 'doing') doneVersion = await resolveVersion(payload.version)
        if (!evidence) {
          evidence = await autoEvidence(context.cwd || root, id).catch(() => '')
        }
        if (!current.context.progress) {
          current.context.progress = evidence ? `完成于 ${model.nowIso()}：${evidence}` : `完成于 ${model.nowIso()}`
        }
        model.completeTask(board, id, person, { version: doneVersion, evidence: evidence || undefined, force: payload.force === true })
        model.deriveParents(board)
        unlocked = unlockedBy(board, id, archive.tasks)
        return { changedTasks: [id] }
      })
      const doneTask = mutated.board.tasks.find((candidate) => candidate.id === id)
      const milestone = doneTask ? milestoneProgress(org, mutated.board, archive.tasks, doneTask) : null
      if (unlocked.length && config.history?.enabled !== false) {
        await store.appendHistory({
          at: model.nowIso(),
          revision: mutated.board.revision,
          action: 'dependency_resolved',
          by,
          taskIds: unlocked,
          transitions: [],
          resolved: unlocked.map((taskId) => ({ taskId, dependsOn: id })),
        }).catch(() => {})
      }
      return finish({
        ok: true,
        board: mutated.board,
        version: doneVersion,
        evidence: evidence || null,
        unlocked,
        milestone,
        message: `已完成 ${id}${doneVersion ? `（版本 ${doneVersion}）` : ''}${unlocked.length ? `；解锁 ${unlocked.join('、')}` : ''}`,
        warning: mutated.warning,
      })
    }
    case 'block': {
      const id = String(payload.id || '')
      const reason = payload.reason !== undefined ? String(payload.reason) : ''
      const mutated = await store.mutate('block', by, (board) => {
        const task = model.findTask(board, id)
        model.blockTask(board, id, person)
        if (reason) addOpenLoop(task, reason, by, config.context?.maxOpenLoops || 20)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, message: `已标记阻塞 ${id}${reason ? `：${reason}` : ''}`, warning: mutated.warning })
    }
    case 'unblock': {
      const id = String(payload.id || '')
      const mutated = await store.mutate('unblock', by, (board) => {
        model.unblockTask(board, id)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, message: `已解除阻塞 ${id}`, warning: mutated.warning })
    }
    case 'reopen': {
      const id = String(payload.id || '')
      const mutated = await store.mutate('reopen', by, (board) => {
        model.reopenTask(board, id)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, message: `已恢复 ${id}`, warning: mutated.warning })
    }
    case 'archive': {
      const id = String(payload.id || '')
      const result = await store.archiveTask(id, person)
      return finish({
        ok: true,
        board: result.board,
        archived: result.archive.tasks,
        message: `已归档 ${id}`,
        warning: result.warning,
      })
    }
    case 'unarchive': {
      const id = String(payload.id || '')
      const result = await store.unarchiveTask(id, person)
      return finish({
        ok: true,
        board: result.board,
        archived: result.archive.tasks,
        message: `已取消归档 ${id}`,
        warning: result.warning,
      })
    }
    /**
     * Archive many done leaves in one transaction.
     * `ids` wins; otherwise milestoneCode/stageCode select inside that org unit.
     * `doneOnly` defaults to true, so an org-scoped call only picks done leaves.
     */
    case 'archive_batch': {
      const explicitIds = Array.isArray(payload.ids) ? payload.ids.map((value) => String(value)) : []
      const milestoneCode = String(payload.milestoneCode || payload.milestone || '').trim()
      const stageCode = String(payload.stageCode || payload.stage || '').trim()
      const doneOnly = payload.doneOnly !== false
      const board = await store.read()
      const archive = await store.readArchive()
      const org = await orgStore.read()
      let stageCodes = null
      if (stageCode) {
        requireStage(org, stageCode)
        stageCodes = new Set([stageCode])
      } else if (milestoneCode) {
        if (!org.milestones.some((entry) => entry.code === milestoneCode)) {
          model.fail('NOT_FOUND', `没有里程碑 ${milestoneCode}`)
        }
        stageCodes = new Set(org.stages.filter((entry) => entry.milestoneCode === milestoneCode).map((entry) => entry.code))
      }
      let ids = explicitIds
      if (!ids.length) {
        const parentIds = new Set(board.tasks.filter((task) => task.parentId).map((task) => task.parentId))
        ids = board.tasks
          .filter((task) => {
            if (parentIds.has(task.id)) return false
            if (doneOnly && task.status !== 'done') return false
            if (stageCodes && !stageCodes.has(task.stageCode)) return false
            return true
          })
          .map((task) => task.id)
      }
      if (!ids.length) {
        return finish({
          ok: true,
          board,
          archived: archive.tasks,
          moved: [],
          skipped: [],
          message: '没有可归档的任务',
        })
      }
      const result = await store.archiveTasks(ids, person)
      const skippedText = result.skipped.length
        ? `；跳过 ${result.skipped.length} 条：${result.skipped.map((entry) => `${entry.id}（${entry.reasonCode}）`).join('、')}`
        : ''
      return finish({
        ok: true,
        board: result.board,
        archived: result.archive.tasks,
        moved: result.moved,
        skipped: result.skipped,
        message: result.moved.length
          ? `已归档 ${result.moved.length} 条：${result.moved.join('、')}${skippedText}`
          : `没有归档任何任务${skippedText}`,
        warning: result.warning,
      })
    }
    case 'delete': {
      const id = String(payload.id || '')
      const current = await store.read()
      if (!current.tasks.some((task) => task.id === id)) {
        const result = await store.purgeArchived(id)
        return finish({ ok: true, archived: result.archive.tasks, message: `已从归档删除 ${id}`, warning: result.warning })
      }
      let affected = []
      const mutated = await store.mutate(payload.purge === true ? 'purge' : 'delete', by, (board) => {
        model.findTask(board, id)
        const descendants = model.descendantsOf(board.tasks, id)
        model.deleteTask(board, id, { cascade: payload.cascade === true, purge: payload.purge === true })
        affected = [id, ...descendants.map((candidate) => candidate.id)]
        return { changedTasks: affected }
      })
      return finish({
        ok: true,
        board: mutated.board,
        message: payload.purge === true ? `已彻底删除 ${id}` : `已取消 ${id}`,
        warning: mutated.warning,
      })
    }
    case 'timeline_clear': {
      if (payload.confirm !== true) model.fail('INVALID', '清空日志是破坏性操作，需要 confirm=true')
      const cleared = await store.clearHistory()
      return finish({
        ok: true,
        cleared: cleared.cleared,
        message: `已清空 ${cleared.cleared} 条日志（待办与归档不受影响）`,
      })
    }
    case 'check': {
      const board = await store.read()
      const archive = await store.readArchive()
      const summary = model.counts(board)
      return finish({
        ok: true,
        board,
        archived: archive.tasks,
        message: [
          `校验通过：共 ${summary.total} 个任务（叶子 ${summary.leaves}），已归档 ${archive.tasks.length} 个`,
          `进行中 ${summary.doing} · 未开始 ${summary.open} · 阻塞 ${summary.blocked} · 已完成 ${summary.done} · 已取消 ${summary.cancelled}`,
          `归档策略：自动 ${config.archive.afterDays > 0 ? `${config.archive.afterDays} 天` : '关闭'}`,
          `存储：${store.file}`,
          `归档：${store.archiveFile}`,
          `日志：${store.historyFile}`,
          `快照：${existsSync(store.markdownFile) ? store.markdownFile : '尚未生成'}`,
        ].join('\n'),
      })
    }
    case 'import': {
      const result = await importLegacy(store, config, root, { dryRun: payload.dryRun === true, source: payload.source, by })
      return finish({ ok: true, ...result })
    }
    case 'list':
      return finish({ ok: true, board: await store.read(), message: formatBoardText(await store.read()) })

    /* ---------------------------------------------------------- deps */

    case 'dep_add': {
      const id = String(payload.id || '')
      const dependsOn = String(payload.dependsOn || payload.dependency || '')
      if (!dependsOn) model.fail('INVALID', 'dep add 需要 --blocked-by <任务ID>')
      const board = await store.read()
      const archive = await store.readArchive()
      const known = new Set([...board.tasks.map((task) => task.id), ...archive.tasks.map((task) => task.id)])
      const mutated = await store.mutate('dep_add', by, (draft) => {
        addDependency(draft, id, dependsOn, payload.type || 'hard', payload.note || '', known)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, message: `已添加依赖 ${id} → ${dependsOn}`, warning: mutated.warning })
    }
    case 'dep_remove': {
      const id = String(payload.id || '')
      const dependsOn = String(payload.dependsOn || payload.dependency || '')
      const mutated = await store.mutate('dep_remove', by, (board) => {
        removeDependency(board, id, dependsOn)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, message: `已移除依赖 ${id} → ${dependsOn}`, warning: mutated.warning })
    }

    /* ---------------------------------------------------------- context */

    case 'context_decision': {
      const id = String(payload.id || '')
      const mutated = await store.mutate('context_decision', by, (board) => {
        const task = model.findTask(board, id)
        appendDecision(task, payload.text, by, config.context?.maxDecisions || 50)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, message: `已记录决策 ${id}`, warning: mutated.warning })
    }
    case 'context_progress': {
      const id = String(payload.id || '')
      const mutated = await store.mutate('context_progress', by, (board) => {
        setProgress(model.findTask(board, id), payload.text)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, message: `已更新进度 ${id}`, warning: mutated.warning })
    }
    case 'context_loop': {
      const id = String(payload.id || '')
      const mutated = await store.mutate(payload.close ? 'context_loop_close' : 'context_loop', by, (board) => {
        const task = model.findTask(board, id)
        if (payload.close) closeOpenLoop(task, payload.close)
        else addOpenLoop(task, payload.text, by, config.context?.maxOpenLoops || 20)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, message: payload.close ? `已关闭未关闭事项 ${id}` : `已记录未关闭事项 ${id}`, warning: mutated.warning })
    }

    /* ---------------------------------------------------------- resources */

    case 'res_add': {
      const id = String(payload.id || '')
      let resource
      const mutated = await store.mutate('res_add', by, (board) => {
        resource = addResource(model.findTask(board, id), payload, by)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, resource, message: `已添加资料 ${resource.id}`, warning: mutated.warning })
    }
    case 'res_approve': {
      const id = String(payload.id || '')
      const resourceId = String(payload.resourceId || '')
      let resource
      const mutated = await store.mutate('res_approve', by, (board) => {
        resource = approveResource(model.findTask(board, id), resourceId, by, payload.note)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, resource, message: `已批准资料 ${resourceId}`, warning: mutated.warning })
    }
    case 'res_supersede': {
      const id = String(payload.id || '')
      const resourceId = String(payload.resourceId || '')
      const replacementId = String(payload.byResource || payload.replacement || '')
      let resource
      const mutated = await store.mutate('res_supersede', by, (board) => {
        const task = model.findTask(board, id)
        resource = supersedeResource(task, resourceId, replacementId)
        addOpenLoop(task, `资料 ${resourceId} 已被 ${replacementId} 替换，请复核`, by, config.context?.maxOpenLoops || 20)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, resource, message: `已替换资料 ${resourceId} → ${replacementId}`, warning: mutated.warning })
    }
    case 'res_list': {
      const task = model.findTask(await store.read(), String(payload.id || ''))
      return finish({ ok: true, resources: listResources(task, payload.status) })
    }

    /* ---------------------------------------------------------- preconditions */

    case 'pre_add': {
      const id = String(payload.id || '')
      let pre
      const mutated = await store.mutate('pre_add', by, (board) => {
        pre = addPrecondition(model.findTask(board, id), payload, by)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, precondition: pre, message: `已添加前置条件 ${pre.id}`, warning: mutated.warning })
    }
    case 'pre_remove': {
      const id = String(payload.id || '')
      const preId = String(payload.preId || '')
      const mutated = await store.mutate('pre_remove', by, (board) => {
        removePrecondition(model.findTask(board, id), preId)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, message: `已移除前置条件 ${preId}`, warning: mutated.warning })
    }
    case 'pre_confirm': {
      const id = String(payload.id || '')
      const preId = String(payload.preId || '')
      let pre
      const mutated = await store.mutate('pre_confirm', by, (board) => {
        pre = confirmPrecondition(model.findTask(board, id), preId, by, payload.note)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, precondition: pre, message: `已确认前置条件 ${preId}`, warning: mutated.warning })
    }

    /* ---------------------------------------------------------- causes */

    case 'cause_add': {
      const id = String(payload.id || '')
      let edge
      const mutated = await store.mutate('cause_add', by, (board) => {
        edge = addCause(board, id, payload, by)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, edge, message: `已记录因果 ${id}`, warning: mutated.warning })
    }
    case 'cause_remove': {
      const id = String(payload.id || '')
      const mutated = await store.mutate('cause_remove', by, (board) => {
        removeCause(board, id, payload)
        return { changedTasks: [id] }
      })
      return finish({ ok: true, board: mutated.board, message: `已移除因果 ${id}`, warning: mutated.warning })
    }
    case 'cause_list':
      return finish({ ok: true, ...listCauses(model.findTask(await store.read(), String(payload.id || ''))) })
    case 'cause_chain':
      return finish({ ok: true, ...causeChain(await store.read(), String(payload.id || ''), Number(payload.depth) || 3) })

    /* ---------------------------------------------------------- org */

    case 'milestone_create': {
      const { result } = await orgStore.createMilestone(payload, by)
      return finish({ ok: true, milestone: result.milestone, stages: result.stages, message: `已创建里程碑 ${result.milestone.code}` })
    }
    case 'milestone_update': {
      const { result } = await orgStore.updateMilestone(String(payload.code || ''), payload, by)
      return finish({ ok: true, milestone: result.milestone, message: `已更新里程碑 ${payload.code}` })
    }
    case 'milestone_delete': {
      const { result } = await orgStore.deleteMilestone(String(payload.code || ''), { force: payload.force === true }, by)
      return finish({ ok: true, message: `已删除里程碑 ${payload.code}${result.movedStages.length ? `，阶段已迁移：${result.movedStages.join('、')}` : ''}` })
    }
    case 'milestone_dep_add': {
      const { result } = await orgStore.addMilestoneDep(String(payload.code || ''), String(payload.on || ''), payload.note, by)
      return finish({ ok: true, message: `已添加里程碑依赖 ${payload.code} → ${payload.on}`, result })
    }
    case 'milestone_dep_remove': {
      await orgStore.removeMilestoneDep(String(payload.code || ''), String(payload.on || ''), by)
      return finish({ ok: true, message: `已移除里程碑依赖 ${payload.code} → ${payload.on}` })
    }
    case 'stage_create': {
      const { result } = await orgStore.createStage(payload, by)
      return finish({ ok: true, stage: result.stage, message: `已创建阶段 ${result.stage.code}` })
    }
    case 'stage_update': {
      const { result } = await orgStore.updateStage(String(payload.code || ''), payload, by)
      return finish({ ok: true, stage: result.stage, message: `已更新阶段 ${payload.code}` })
    }
    case 'stage_reorder': {
      await orgStore.reorderStage(String(payload.code || ''), Number(payload.order) || 0, by)
      return finish({ ok: true, message: `已重排阶段 ${payload.code}` })
    }
    case 'stage_delete': {
      const code = String(payload.code || '')
      const board = await store.read()
      const inStage = board.tasks.filter((task) => task.stageCode === code)
      if (inStage.length && !payload.moveTo) {
        model.fail('CONFLICT', `阶段 ${code} 还有 ${inStage.length} 个任务；使用 --move-to <阶段>`)
      }
      if (payload.moveTo) {
        const org = await orgStore.read()
        requireStage(org, payload.moveTo)
        await store.mutate('stage_move_tasks', by, (draft) => {
          for (const task of draft.tasks) if (task.stageCode === code) task.stageCode = String(payload.moveTo)
          return { changedTasks: inStage.map((task) => task.id) }
        })
      }
      await orgStore.deleteStage(code, { force: payload.force === true }, by)
      return finish({ ok: true, message: `已删除阶段 ${code}${payload.moveTo ? `，任务已迁移到 ${payload.moveTo}` : ''}` })
    }
    case 'stage_dep_add': {
      await orgStore.addStageDep(String(payload.code || ''), String(payload.on || ''), payload.onMilestone ? 'milestone' : 'stage', payload.note, by)
      return finish({ ok: true, message: `已添加阶段依赖 ${payload.code} → ${payload.on}` })
    }
    case 'stage_dep_remove': {
      await orgStore.removeStageDep(String(payload.code || ''), String(payload.on || ''), payload.onMilestone ? 'milestone' : 'stage', by)
      return finish({ ok: true, message: `已移除阶段依赖 ${payload.code} → ${payload.on}` })
    }

    /* ---------------------------------------------------------- tags */

    case 'tag_add': {
      const { result } = await tagStore.add(payload, by)
      return finish({ ok: true, tag: result.tag, message: `已添加标签 ${result.tag.code}` })
    }
    case 'tag_update': {
      const { result } = await tagStore.update(String(payload.code || ''), payload, by)
      return finish({ ok: true, tag: result.tag, message: `已更新标签 ${payload.code}` })
    }
    case 'tag_deprecate': {
      const { result } = await tagStore.deprecate(String(payload.code || ''), payload.replacement || payload.deprecatedBy, by)
      return finish({ ok: true, tag: result.tag, message: `已废弃标签 ${payload.code}` })
    }

    default:
      model.fail('INVALID', `未知操作：${action || '(空)'}`)
  }
}

export { formatBoardText, formatTaskText }
