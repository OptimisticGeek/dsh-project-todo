/**
 * Project-scoped stores: active tasks in `docs/ptodo/todos.json`, archived tasks
 * in `docs/ptodo/archive.json`. Every mutation is serialized in-process,
 * guarded by a lock file, persisted through write-temp + fsync + rename, and
 * followed by the Markdown snapshots and an append-only history line.
 *
 * v3 upgrades old boards in memory; the first write over a v2 file copies the
 * original into `docs/ptodo/.backup/` before replacing it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ARCHIVE_VERSION,
  STORE_VERSION,
  deriveParents,
  emptyArchive,
  emptyBoard,
  fail,
  nowIso,
  normalizeArchive,
  normalizeBoard,
  validateArchive,
  validateBoard,
} from './model.js'
import { renderArchiveMarkdown, renderMarkdown } from './markdown.js'
import { acquireLock, writeAtomic } from './fs-store.js'
import { appendHistory, historyFileOf, readHistoryLog } from './history.js'

const DAY_MS = 86_400_000

export { writeAtomic }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class TodoStore {
  /**
   * @param {string} root - project root directory.
   * @param {object} config - normalized (or partial) plugin config.
   */
  constructor(root, config) {
    this.root = root
    this.config = config
    this.dir = path.join(root, '.dsh')
    this.file = path.join(root, config.store.path)
    this.archiveFile = path.join(root, config.archive.path)
    this.lockFile = `${this.file}.lock`
    this.historyFile = historyFileOf(root, config)
    this.markdownFile = path.join(root, config.markdown.path)
    this.archiveMarkdownFile = path.join(root, config.markdown.archivePath)
    this.queue = Promise.resolve()
  }

  /* ------------------------------------------------------------- reading */

  async read() {
    const board = await this.readActiveRaw()
    normalizeBoard(board)
    deriveParents(board)
    validateBoard(board)
    return board
  }

  readSync() {
    try {
      const board = parseBoard(readFileSync(this.file, 'utf8'))
      normalizeBoard(board)
      deriveParents(board)
      validateBoard(board)
      return board
    } catch {
      return null
    }
  }

  async readArchive() {
    if (!existsSync(this.archiveFile)) return emptyArchive(path.basename(this.root))
    const archive = parseArchive(await readFile(this.archiveFile, 'utf8'))
    normalizeArchive(archive)
    validateArchive(archive)
    return archive
  }

  readArchiveSync() {
    if (!existsSync(this.archiveFile)) return emptyArchive(path.basename(this.root))
    const archive = parseArchive(readFileSync(this.archiveFile, 'utf8'))
    normalizeArchive(archive)
    validateArchive(archive)
    return archive
  }

  async readActiveRaw() {
    if (!existsSync(this.file)) return emptyBoard(path.basename(this.root))
    return parseBoard(await readFile(this.file, 'utf8'))
  }

  async readArchiveRaw() {
    if (!existsSync(this.archiveFile)) return emptyArchive(path.basename(this.root))
    return parseArchive(await readFile(this.archiveFile, 'utf8'))
  }

  /** Last `limit` history entries, optionally filtered by task id. */
  async readHistory(limit = 20, taskId) {
    if (!this.config.history || this.config.history.enabled === false) return []
    const entries = await this.readHistoryLog()
    const filtered = taskId ? entries.filter((entry) => (entry.taskIds || []).includes(taskId)) : entries
    return filtered.slice(-limit).reverse()
  }

  /**
   * Every valid log line in file order. The timeline is an append-only audit
   * log independent from the board/archive files: a malformed line is skipped
   * instead of failing the whole read.
   */
  async readHistoryLog() {
    if (!this.config.history || this.config.history.enabled === false) return []
    return readHistoryLog(this.historyFile)
  }

  /**
   * Newest-first history matching `predicate`.
   * @returns {Promise<{entries: object[], total: number, matched: number}>}
   */
  async findHistory(predicate, limit = 20) {
    if (!this.config.history || this.config.history.enabled === false) {
      return { entries: [], total: 0, matched: 0 }
    }
    const all = await this.readHistoryLog()
    const matched = []
    for (const entry of all) {
      if (!predicate || predicate(entry)) matched.push(entry)
    }
    return { entries: matched.slice(-limit).reverse(), total: all.length, matched: matched.length }
  }

  /**
   * Clear the timeline log only. The board, the archive and `revision` are
   * untouched; the trailing log entry count is returned for the UI toast.
   */
  async clearHistory() {
    if (!this.config.history || this.config.history.enabled === false) return { cleared: 0 }
    return this.enqueue(async () => {
      await mkdir(this.dir, { recursive: true })
      const release = await acquireLock(this.lockFile)
      try {
        let cleared = 0
        if (existsSync(this.historyFile)) {
          const text = await readFile(this.historyFile, 'utf8')
          cleared = text.split(/\r?\n/).filter((line) => line.trim()).length
        }
        await writeAtomic(this.historyFile, '')
        return { cleared }
      } finally {
        await release()
      }
    })
  }

  /* ------------------------------------------------------------ mutation */

  async mutate(action, by, mutator) {
    return this.enqueue(() => this.mutateNow(action, by, mutator))
  }

  async mutateNow(action, by, mutator) {
    await mkdir(this.dir, { recursive: true })
    const release = await acquireLock(this.lockFile)
    try {
      const raw = await this.readActiveRaw()
      const rawVersion = Number(raw.version)
      normalizeBoard(raw)
      deriveParents(raw)
      validateBoard(raw)
      const before = new Map(raw.tasks.map((task) => [task.id, structuredClone(task)]))
      const result = (await mutator(raw)) || {}
      raw.revision += 1
      raw.updatedAt = nowIso()
      deriveParents(raw)
      validateBoard(raw)
      const changed = new Set(result.changedTasks || [])
      for (const transition of this.transitionsOf(before, raw.tasks)) changed.add(transition.id)
      for (const id of changed) {
        const task = raw.tasks.find((candidate) => candidate.id === id)
        if (task) task.revision = Math.max(1, (task.revision || 0) + 1)
      }
      if (rawVersion < STORE_VERSION && existsSync(this.file)) {
        await this.backup('v' + rawVersion, 'todos.json')
      }
      await writeAtomic(this.file, `${JSON.stringify(raw, null, 2)}\n`)
      const transitions = this.transitionsOf(before, raw.tasks)
      if (this.config.history.enabled !== false) {
        await appendHistory(this.historyFile, {
          at: nowIso(),
          revision: raw.revision,
          action,
          by: by || 'system',
          taskIds: [...changed],
          transitions,
          before: [...changed].map((id) => before.get(id)).filter(Boolean),
          after: [...changed].map((id) => raw.tasks.find((task) => task.id === id)).filter(Boolean),
        })
      }
      const warning = await this.writeMarkdown(raw, await this.readArchive().catch(() => emptyArchive(raw.project)))
      return { board: raw, result, ...(warning ? { warning } : {}) }
    } finally {
      await release()
    }
  }

  /** Copy a data file aside once, before an in-place schema upgrade. */
  async backup(label, name) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = path.join(path.dirname(this.file), '.backup', `${label}-${stamp}`)
    await mkdir(dir, { recursive: true })
    const source = name === 'archive.json' ? this.archiveFile : this.file
    if (existsSync(source)) await copyFile(source, path.join(dir, name)).catch(() => {})
  }

  /**
   * Move completed leaves older than `archive.afterDays` to the archive file.
   * Called on state reads so no background timer is needed.
   */
  async sweepArchive() {
    const days = Number(this.config.archive?.afterDays)
    if (!Number.isFinite(days) || days <= 0) return { moved: [], warning: '' }
    return this.enqueue(async () => {
      await mkdir(this.dir, { recursive: true })
      const release = await acquireLock(this.lockFile)
      try {
        const board = await this.readActiveRaw()
        normalizeBoard(board)
        deriveParents(board)
        validateBoard(board)
        const archive = await this.readArchiveRaw()
        normalizeArchive(archive)
        validateArchive(archive)
        const now = Date.now()
        const parentIds = new Set(board.tasks.filter((task) => task.parentId).map((task) => task.parentId))
        const due = board.tasks.filter((task) => {
          if (task.status !== 'done' || !task.doneAt || task.archiveExempt) return false
          if (parentIds.has(task.id)) return false
          const done = Date.parse(task.doneAt)
          return Number.isFinite(done) && now - done >= days * DAY_MS
        })
        if (!due.length) return { moved: [], warning: '' }
        const moveIds = new Set(due.map((task) => task.id))
        board.tasks = board.tasks.filter((task) => !moveIds.has(task.id))
        board.revision += 1
        board.updatedAt = nowIso()
        for (const task of due) {
          archive.tasks.push({ ...task, archivedAt: nowIso(), archivedBy: 'auto' })
        }
        archive.revision += 1
        archive.updatedAt = nowIso()
        validateBoard(board)
        validateArchive(archive)
        await writeAtomic(this.file, `${JSON.stringify(board, null, 2)}\n`)
        await writeAtomic(this.archiveFile, `${JSON.stringify(archive, null, 2)}\n`)
        if (this.config.history.enabled !== false) {
          await appendHistory(this.historyFile, {
            at: nowIso(),
            revision: board.revision,
            action: 'auto_archive',
            by: 'system',
            taskIds: due.map((task) => task.id),
            transitions: [],
            before: due.map((task) => structuredClone(task)),
            after: [],
          })
        }
        const warning = await this.writeMarkdown(board, archive)
        return { moved: due.map((task) => task.id), warning }
      } finally {
        await release()
      }
    })
  }

  /**
   * Move several done leaves to the archive in one locked transaction.
   *
   * A single lock and a single pair of writes keep a batch atomic. Anything
   * that cannot move (missing, not done, still has children, already archived)
   * is reported in `skipped` instead of aborting the rest of the batch.
   * `archiveTask` is the one-id wrapper so the rules live in one place.
   *
   * @param {string[]} ids
   * @param {string} by - person recorded as `archivedBy`.
   * @returns {Promise<{board: object, archive: object, moved: string[], skipped: {id: string, reason: string, reasonCode: string}[], warning: string}>}
   */
  async archiveTasks(ids, by) {
    return this.enqueue(async () => {
      await mkdir(this.dir, { recursive: true })
      const release = await acquireLock(this.lockFile)
      try {
        const board = await this.readActiveRaw()
        normalizeBoard(board)
        deriveParents(board)
        validateBoard(board)
        const archive = await this.readArchiveRaw()
        normalizeArchive(archive)
        validateArchive(archive)
        const archivedIds = new Set(archive.tasks.map((task) => task.id))
        const seen = new Set()
        const moved = []
        const skipped = []
        const before = []
        for (const raw of Array.isArray(ids) ? ids : []) {
          const id = String(raw == null ? '' : raw).trim()
          if (!id || seen.has(id)) continue
          seen.add(id)
          const task = board.tasks.find((candidate) => candidate.id === id)
          if (!task) {
            const archived = archivedIds.has(id)
            skipped.push({
              id,
              reason: archived ? `${id} 已归档` : `没有任务 ${id}`,
              reasonCode: archived ? 'ARCHIVED' : 'NOT_FOUND',
            })
            continue
          }
          if (task.status !== 'done') {
            skipped.push({ id, reason: `${id} 不是已完成任务，不能归档`, reasonCode: 'NOT_DONE' })
            continue
          }
          if (board.tasks.some((candidate) => candidate.parentId === id)) {
            skipped.push({ id, reason: `${id} 还有子任务，先处理子任务再归档`, reasonCode: 'HAS_CHILDREN' })
            continue
          }
          before.push(structuredClone(task))
          board.tasks = board.tasks.filter((candidate) => candidate.id !== id)
          archive.tasks.push({ ...task, archivedAt: nowIso(), archivedBy: by || 'manual' })
          moved.push(id)
        }
        if (!moved.length) return { board, archive, moved, skipped, warning: '' }
        board.revision += 1
        board.updatedAt = nowIso()
        archive.revision += 1
        archive.updatedAt = nowIso()
        validateBoard(board)
        validateArchive(archive)
        await writeAtomic(this.file, `${JSON.stringify(board, null, 2)}\n`)
        await writeAtomic(this.archiveFile, `${JSON.stringify(archive, null, 2)}\n`)
        await appendHistory(this.historyFile, {
          at: nowIso(),
          revision: board.revision,
          action: 'archive',
          by: by || 'manual',
          taskIds: moved,
          transitions: [],
          before,
          after: before.map((task) => ({ ...task, archivedAt: nowIso(), archivedBy: by || 'manual' })),
        })
        const warning = await this.writeMarkdown(board, archive)
        return { board, archive, moved, skipped, warning }
      } finally {
        await release()
      }
    })
  }

  async archiveTask(id, by) {
    const result = await this.archiveTasks([id], by)
    const miss = result.skipped.find((entry) => entry.id === id)
    if (miss) fail(miss.reasonCode === 'NOT_FOUND' || miss.reasonCode === 'ARCHIVED' ? 'NOT_FOUND' : 'CONFLICT', miss.reason)
    return { board: result.board, archive: result.archive, moved: result.moved, skipped: result.skipped, warning: result.warning }
  }

  async unarchiveTask(id, by) {
    return this.enqueue(async () => {
      await mkdir(this.dir, { recursive: true })
      const release = await acquireLock(this.lockFile)
      try {
        const board = await this.readActiveRaw()
        normalizeBoard(board)
        deriveParents(board)
        validateBoard(board)
        const archive = await this.readArchiveRaw()
        normalizeArchive(archive)
        validateArchive(archive)
        const task = archive.tasks.find((candidate) => candidate.id === id)
        if (!task) fail('NOT_FOUND', `归档里没有任务 ${id}`)
        archive.tasks = archive.tasks.filter((candidate) => candidate.id !== id)
        archive.revision += 1
        archive.updatedAt = nowIso()
        const restored = { ...task, archivedAt: null, archivedBy: null, archiveExempt: true, updatedAt: nowIso() }
        board.tasks.push(restored)
        deriveParents(board)
        board.revision += 1
        board.updatedAt = nowIso()
        validateBoard(board)
        validateArchive(archive)
        await writeAtomic(this.file, `${JSON.stringify(board, null, 2)}\n`)
        await writeAtomic(this.archiveFile, `${JSON.stringify(archive, null, 2)}\n`)
        await appendHistory(this.historyFile, {
          at: nowIso(),
          revision: board.revision,
          action: 'unarchive',
          by: by || 'manual',
          taskIds: [id],
          transitions: [],
          before: [structuredClone(task)],
          after: [structuredClone(restored)],
        })
        const warning = await this.writeMarkdown(board, archive)
        return { board, archive, warning }
      } finally {
        await release()
      }
    })
  }

  async purgeArchived(id) {
    return this.enqueue(async () => {
      const release = await acquireLock(this.lockFile)
      try {
        const archive = await this.readArchiveRaw()
        normalizeArchive(archive)
        validateArchive(archive)
        const index = archive.tasks.findIndex((task) => task.id === id)
        if (index === -1) fail('NOT_FOUND', `归档里没有任务 ${id}`)
        archive.tasks.splice(index, 1)
        archive.revision += 1
        archive.updatedAt = nowIso()
        validateArchive(archive)
        await writeAtomic(this.archiveFile, `${JSON.stringify(archive, null, 2)}\n`)
        const board = await this.readActiveRaw()
        normalizeBoard(board)
        const warning = await this.writeMarkdown(board, archive)
        return { archive, warning }
      } finally {
        await release()
      }
    })
  }

  enqueue(operation) {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  transitionsOf(before, afterTasks) {
    const afterById = new Map(afterTasks.map((task) => [task.id, task]))
    const transitions = []
    for (const [id, previous] of before) {
      const next = afterById.get(id)
      const from = previous.status
      const to = next ? next.status : null
      if (from !== to) transitions.push({ id, from, to })
    }
    for (const [id, next] of afterById) {
      if (!before.has(id)) transitions.push({ id, from: null, to: next.status })
    }
    return transitions
  }

  async appendHistory(entry) {
    await appendHistory(this.historyFile, entry)
  }

  async writeMarkdown(board, archive) {
    if (!this.config.markdown.enabled) return ''
    try {
      await writeAtomic(this.markdownFile, renderMarkdown(board, this.config))
      await writeAtomic(this.archiveMarkdownFile, renderArchiveMarkdown(archive, this.config))
      return ''
    } catch (error) {
      return `Markdown 快照写入失败：${error.message}`
    }
  }
}

function parseBoard(text) {
  try {
    return JSON.parse(text)
  } catch (error) {
    fail('PARSE_ERROR', `docs/ptodo/todos.json 不是合法 JSON：${error.message}`)
  }
}

function parseArchive(text) {
  try {
    return JSON.parse(text)
  } catch (error) {
    fail('PARSE_ERROR', `docs/ptodo/archive.json 不是合法 JSON：${error.message}`)
  }
}

const stores = new Map()
export function storeFor(root, config) {
  // The key includes the effective config so a project config edit (paths,
  // archive window, history toggle) never reuses a stale store instance.
  const key = `${path.resolve(root)}|${JSON.stringify(config)}`
  let store = stores.get(key)
  if (!store) {
    store = new TodoStore(path.resolve(root), config)
    stores.set(key, store)
  }
  return store
}

export const VERSIONS = { store: STORE_VERSION, archive: ARCHIVE_VERSION }
export { DAY_MS, sleep }
