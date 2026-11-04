/**
 * One-time import of the legacy Markdown queue (`开发计划/todo/TODO.md`).
 * Reads only; the legacy file is never written by this plugin.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PRIORITIES, createTask, fail, nowIso, sortTasks } from './model.js'

const ID_RE = /^`?((?:[A-C]-\d+(?:-\d+)?|OPS)_\d+)`?$/

function cellsOf(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => cell === '' || /^:?-{2,}:?$/.test(cell))
}

/** Parse the legacy table into `{id, pri, size, title, status, holder, note, group}` rows. */
export function parseLegacyTodo(text) {
  const lines = text.split(/\r?\n/)
  const rows = []
  let group = null
  let columns = ['ID', '优先级', '规模', '任务', '状态', '持有', '备注']
  for (const line of lines) {
    const heading = /^##\s+`([A-Z]+)`\s+(\S+)/.exec(line)
    if (heading) {
      group = { id: heading[1], name: heading[2] }
      columns = ['ID', '优先级', '规模', '任务', '状态', '持有', '备注']
      continue
    }
    if (!line.startsWith('|')) continue
    const cells = cellsOf(line)
    if (!cells.length) continue
    if (cells[0].replace(/`/g, '').trim() === 'ID') {
      columns = cells
      continue
    }
    if (isSeparator(cells)) continue
    const match = ID_RE.exec(cells[0])
    if (!match || cells.length < 5) continue
    const col = (name, fallback = '') => {
      const at = columns.indexOf(name)
      return at >= 0 && at < cells.length ? cells[at] : fallback
    }
    rows.push({
      id: match[1],
      priority: col('优先级', 'P2'),
      size: col('规模', 'M'),
      title: col('任务'),
      status: col('状态', '待办'),
      holder: col('持有'),
      note: col('备注'),
      group: group ? group.id : null,
    })
  }
  return rows
}

/**
 * Import legacy rows into the project store.
 * @param {object} store - TodoStore.
 * @param {object} config - normalized config.
 * @param {string} root - project root.
 * @param {{dryRun?: boolean, source?: string, by?: string}} options
 */
export async function importLegacy(store, config, root, options = {}) {
  const source = options.source || config.import.source
  const file = path.resolve(root, source)
  if (!existsSync(file)) fail('NOT_FOUND', `找不到旧队列文件：${source}`)
  const rows = parseLegacyTodo(await readFile(file, 'utf8'))
  const board = await store.read()
  const existing = new Set(board.tasks.map((task) => task.legacyId).filter(Boolean))
  const pending = sortTasks(
    rows
      .filter((row) => !existing.has(row.id))
      .map((row) => ({
        ...row,
        priority: PRIORITIES.includes(row.priority) ? row.priority : 'P2',
        status: row.status === '进行中' ? 'doing' : 'open',
        holder: row.status === '进行中' ? String(row.holder || '').split('@')[0].trim() : '',
      }))
      .filter((row) => row.title),
  )

  if (options.dryRun) {
    return {
      source,
      dryRun: true,
      willImport: pending.length,
      skipped: rows.length - pending.length,
      rows: pending,
    }
  }
  if (!pending.length) {
    return { source, dryRun: false, imported: 0, skipped: rows.length, board }
  }
  const mutated = await store.mutate('import', options.by || 'import', (current) => {
    const changedTasks = []
    for (const row of pending) {
      const task = createTask(current, {
        title: row.title,
        legacyId: row.id,
        priority: row.priority,
        urgency: 3,
        tags: row.group ? [row.group] : [],
        size: row.size,
        notes: row.note || '',
      })
      if (row.status === 'doing' && row.holder) {
        task.status = 'doing'
        task.holder = row.holder
        task.claimedAt = nowIso()
      }
      changedTasks.push(task.id)
    }
    return { changedTasks }
  })
  return {
    source,
    dryRun: false,
    imported: pending.length,
    skipped: rows.length - pending.length,
    board: mutated.board,
    warning: mutated.warning,
  }
}
