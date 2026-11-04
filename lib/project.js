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
 * @param {object} ctx - host plugin context.
 * @param {object} session - Session object.
 * @returns {string} absolute project root.
 */
export function resolveProjectRoot(ctx, session) {
  const workingDirectory = ctx.get('workingDirectory')
  if (!workingDirectory) fail('NO_PROJECT', 'workingDirectory 服务不可用，无法解析项目目录')
  let cwd
  try {
    cwd = workingDirectory.get(session)
  } catch (error) {
    fail('NO_PROJECT', `读取会话目录失败：${error.message}`)
  }
  if (!cwd || typeof cwd !== 'string') fail('NO_PROJECT', '会话没有可用的工作目录')
  return resolveProjectRootFromCwd(cwd)
}
