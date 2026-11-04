/**
 * Actor resolution.
 *
 * The actor answers "who did this": the person from the project's git config,
 * optionally prefixed with the tool in use (`codex:zhangsan`). Git config is
 * parsed from files instead of spawning `git config` because the DSH Windows
 * sandbox can refuse piped child processes (see version.js for the same
 * constraint).
 *
 * Priority: --by > PTODO_ACTOR > git user.name > DSH_SESSION_ID > cli-<user>.
 *
 * The actor is the tool-facing identity (it may carry a `<tool>:` prefix and is
 * what history records). The person is the human behind it: git `user.name`
 * first, otherwise one stripped `<tool>:` prefix. Person fields on a task
 * (`createdBy`/`holder`/`doneBy`/`archivedBy`) always store the person.
 */
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_WALK = 24

function readUserSection(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  let inUser = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const section = /^\[([^\]]+)\]$/.exec(line)
    if (section) {
      inUser = section[1].trim().toLowerCase() === 'user'
      continue
    }
    if (!inUser) continue
    const match = /^name\s*=\s*(.*)$/i.exec(line)
    if (match) return match[1].trim()
  }
  return ''
}

function gitDirOf(dir) {
  const dotGit = path.join(dir, '.git')
  let stat
  try {
    stat = statSync(dotGit)
  } catch {
    return ''
  }
  if (stat.isDirectory()) return dotGit
  try {
    const text = readFileSync(dotGit, 'utf8')
    const match = /^gitdir:\s*(.+)$/m.exec(text)
    return match ? path.resolve(dir, match[1].trim()) : ''
  } catch {
    return ''
  }
}

function commonDirOf(gitDir) {
  try {
    return path.resolve(gitDir, readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim())
  } catch {
    return gitDir
  }
}

/** Nearest git work tree at or above `startDir`, or ''. */
export function findGitDir(startDir) {
  if (!startDir) return ''
  let current = path.resolve(startDir)
  for (let depth = 0; depth < MAX_WALK; depth += 1) {
    const gitDir = gitDirOf(current)
    if (gitDir) return gitDir
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return ''
}

/** Work-tree directory (the folder containing `.git`), or ''. */
export function findRepoRoot(startDir) {
  if (!startDir) return ''
  let current = path.resolve(startDir)
  for (let depth = 0; depth < MAX_WALK; depth += 1) {
    if (gitDirOf(current)) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return ''
}

/** `user.name` from the local repository, then global git config. */
export function gitUserName(startDir, home = os.homedir()) {
  const gitDir = findGitDir(startDir)
  if (gitDir) {
    const common = commonDirOf(gitDir)
    const local = readUserSection(path.join(common, 'config')) || readUserSection(path.join(gitDir, 'config'))
    if (local) return local
  }
  return (
    readUserSection(path.join(home, '.gitconfig')) ||
    readUserSection(path.join(home, '.config', 'git', 'config')) ||
    ''
  )
}

function fallbackUser() {
  try {
    return os.userInfo().username || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Strip one `<tool>:` prefix (`codex:zhangsan` → `zhangsan`). Values without a
 * colon, or with an empty remainder, are returned trimmed but otherwise intact.
 */
export function stripToolPrefix(value) {
  const text = String(value == null ? '' : value).trim()
  const match = /^[^:\s]+:(.+)$/.exec(text)
  return match ? match[1].trim() || text : text
}

/**
 * Resolve the actor and the person for one invocation.
 * @param {{by?: string, env?: object, root?: string, cwd?: string}} options
 * @returns {{actor: string, source: string, gitName: string, hasPrefix: boolean, person: string, personSource: string}}
 */
export function resolveActor(options = {}) {
  const env = options.env || process.env
  const startDir = options.cwd || options.root
  const home = options.home || os.homedir()
  const explicit = String(options.by == null ? '' : options.by).trim()
  const envActor = String(env.PTODO_ACTOR || '').trim()
  const gitName = gitUserName(startDir, home)
  // The person is a human name, so git wins even when --by / PTODO_ACTOR is set.
  const person = gitName || stripToolPrefix(explicit || envActor)
  const personSource = gitName ? 'git' : explicit ? 'flag' : envActor ? 'env' : ''
  if (explicit) {
    return {
      actor: explicit,
      source: 'flag',
      gitName,
      hasPrefix: explicit.includes(':'),
      person: person || explicit,
      personSource: personSource || 'flag',
    }
  }
  if (envActor) {
    return {
      actor: envActor,
      source: 'env',
      gitName,
      hasPrefix: envActor.includes(':'),
      person: person || envActor,
      personSource: personSource || 'env',
    }
  }
  if (gitName) {
    return { actor: gitName, source: 'git', gitName, hasPrefix: gitName.includes(':'), person, personSource: 'git' }
  }
  const session = String(env.DSH_SESSION_ID || '').trim()
  if (session) {
    return { actor: session, source: 'session', gitName: '', hasPrefix: session.includes(':'), person: stripToolPrefix(session), personSource: 'session' }
  }
  const fallback = `cli-${fallbackUser()}`
  return { actor: fallback, source: 'fallback', gitName: '', hasPrefix: fallback.includes(':'), person: fallback, personSource: 'fallback' }
}

/** Human-readable hint used by `whoami` / `doctor`; never blocks. */
export function actorHint(info) {
  if (info.hasPrefix) return ''
  return '建议把 PTODO_ACTOR 设为 <agent>:<名称>（例如 codex:zhangsan），便于区分同一人使用的不同工具'
}

/** Cheap check used by doctor without resolving the full name twice. */
export function hasGitUser(startDir) {
  return Boolean(gitUserName(startDir))
}
