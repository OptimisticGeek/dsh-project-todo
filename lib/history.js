/**
 * Append-only operation log shared by the board, milestones/stages and tags.
 *
 * The log is independent from every JSON store: a torn tail line is skipped,
 * clearing it never changes revisions or tasks, and deleting a task never
 * rewrites history.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export async function appendHistory(file, entry) {
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8')
}

/** Every valid log line in file order; malformed lines are skipped. */
export async function readHistoryLog(file) {
  if (!existsSync(file)) return []
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return []
  }
  const entries = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry && typeof entry === 'object') entries.push(entry)
    } catch {
      /* a torn write at the tail must not break the whole timeline */
    }
  }
  return entries
}

export function historyFileOf(root, config) {
  const configured = config && config.history && config.history.path ? config.history.path : 'docs/ptodo/todos.history.jsonl'
  return path.isAbsolute(configured) ? configured : path.join(root, configured)
}
