/**
 * Resolve the project root of one Session or one CLI invocation.
 *
 * Policy: the nearest ancestor that owns `docs/ptodo/todos.json` wins, even
 * when a nested repository (for example `utp/`) has its own `.git`. Only when
 * no board exists does the nearest Git root act as the project root.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fail } from './model.js'

const BOARD = path.join('docs', 'ptodo', 'todos.json')
const MAX_DEPTH = 9

function candidatesOf(cwd) {
  const candidates = []
  let current = path.resolve(cwd)
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    candidates.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return candidates
}

/** Pure resolver used by the CLI and the session-bound plugin wrapper. */
export function resolveProjectRootFromCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') fail('NO_PROJECT', '没有可用的工作目录')
  const candidates = candidatesOf(cwd)
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, BOARD))) return candidate
  }
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, '.git'))) return candidate
  }
  return path.resolve(cwd)
}

/**
 * Cwd recorded on the Session header; survives a host without the
 * `workingDirectory` service (older builds, minimal profiles).
 * @param {object} session - Session object.
 * @returns {string} absolute directory or ''.
 */
function headerCwdOf(session) {
  const cwd = session && session.header && session.header.cwd
  return typeof cwd === 'string' && cwd ? cwd : ''
}

/**
 * Effective directory of one Session: the `workingDirectory` service owns live
 * directory changes, so prefer it; fall back to the Session header when the
 * service is absent or throws instead of failing the whole page.
 * @param {object} ctx - host plugin context.
 * @param {object} session - Session object.
 * @returns {string} absolute directory or ''.
 */
export function sessionCwdOf(ctx, session) {
  const workingDirectory = ctx.get('workingDirectory')
  if (workingDirectory) {
    try {
      const cwd = workingDirectory.get(session)
      if (cwd) return cwd
    } catch {
      /* fall through to the Session header */
    }
  }
  return headerCwdOf(session)
}

/**
 * @param {object} ctx - host plugin context.
 * @param {object} session - Session object.
 * @returns {string} absolute project root.
 */
export function resolveProjectRoot(ctx, session) {
  const cwd = sessionCwdOf(ctx, session)
  if (!cwd) fail('NO_PROJECT', '该会话没有记录工作目录（workingDirectory 服务与会话头均无），请先在会话中打开一个项目目录')
  return resolveProjectRootFromCwd(cwd)
}
