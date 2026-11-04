/**
 * Output contract for `ptodo`.
 *
 * Text goes to stdout normally. With `--json`, stdout carries exactly one JSON
 * document and all diagnostics go to stderr. Exit codes let shell scripts
 * branch without parsing text.
 */
import { TodoError } from '../model.js'

export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  INVALID: 5,
  PARSE_ERROR: 6,
  IO_ERROR: 6,
  NO_PROJECT: 7,
  DEPENDENCY_CYCLE: 8,
  TAG_NOT_FOUND: 9,
  NOT_READY: 10,
}

export function exitCodeOf(error) {
  if (error instanceof TodoError && EXIT[error.code] !== undefined) return EXIT[error.code]
  return EXIT.ERROR
}

export function write(text) {
  const value = String(text ?? '')
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
}

export function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

export function reportError(error, json) {
  const code = error instanceof TodoError ? error.code : 'IO_ERROR'
  const message = error && error.message ? error.message : String(error)
  if (json) {
    process.stderr.write(`${JSON.stringify({ ok: false, code, message })}\n`)
  } else {
    process.stderr.write(`[${code}] ${message}\n`)
  }
  process.exitCode = exitCodeOf(error)
}

/** Map a service result to the JSON payload, dropping the full board. */
export function resultPayload(action, result) {
  const payload = { ok: true, action, message: result.message }
  for (const field of [
    'task',
    'version',
    'claimed',
    'skipped',
    'available',
    'warning',
    'warnings',
    'evidence',
    'unlocked',
    'milestone',
    'archived',
    'moved',
    'brief',
    'handoff',
    'resources',
    'resource',
    'precondition',
    'edge',
    'stage',
    'tag',
    'id',
    'title',
    'up',
    'down',
    'cycle',
  ]) {
    if (result[field] !== undefined) payload[field] = result[field]
  }
  return payload
}

/**
 * Text hint appended to `task done` when the task closed its milestone: the
 * agent must ask the user before archiving, so the next command is spelled out.
 */
export function doneMilestoneHint(result) {
  const milestone = result && result.milestone
  if (!milestone || milestone.complete !== true) return ''
  return `\n里程碑 ${milestone.code} 已全部完成；归档前先询问用户：ptodo admin archive-batch --milestone ${milestone.code}`
}
