/**
 * Completion version resolution.
 *
 * A done task records the git short hash of the repository that owns the work.
 * Lookup order: explicit `version` argument → configured `version.gitDir` →
 * the calling session's working directory → the project root. Every git call is
 * best-effort: a non-repository directory simply returns '' so the caller can
 * fall back to a manual version (or refuse when `version.require` is on).
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HASH_RE = /^[0-9a-f]{4,40}$/i
const FULL_HASH_RE = /^[0-9a-f]{40}$/i
const MAX_VERSION = 64

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

function packedRef(commonDir, ref) {
  try {
    const text = readFileSync(path.join(commonDir, 'packed-refs'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith('#') || line.startsWith('^')) continue
      const [sha, name] = line.trim().split(/\s+/, 2)
      if (name === ref) return sha
    }
  } catch {
    /* no packed refs */
  }
  return ''
}

function refValue(commonDir, gitDir, ref) {
  for (const base of [gitDir, commonDir]) {
    try {
      return readFileSync(path.join(base, ref), 'utf8').trim()
    } catch {
      /* try the next base */
    }
  }
  return packedRef(commonDir, ref)
}

/**
 * Resolve the short HEAD hash without spawning a process.
 *
 * The CLI runs inside a sandbox where a `git` child process with piped stdio
 * can be refused; reading `.git` directly keeps `ptodo done` working. Handles
 * a normal `.git` directory, a `.git` file (submodule/worktree), `commondir`
 * for linked worktrees, loose refs and `packed-refs`.
 */
export function shortHashFromGitDir(dir) {
  if (!dir || !existsSync(dir)) return ''
  const gitDir = gitDirOf(dir)
  if (!gitDir) return ''
  const commonDir = commonDirOf(gitDir)
  let head
  try {
    head = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
  } catch {
    return ''
  }
  let sha = ''
  if (head.startsWith('ref:')) {
    sha = refValue(commonDir, gitDir, head.slice(4).trim())
  } else {
    sha = head
  }
  return FULL_HASH_RE.test(sha) ? sha.slice(0, 7) : ''
}

/** Short HEAD hash of `dir`, or '' when it is not a git work tree. */
export async function gitShortHash(dir) {
  if (!dir || !existsSync(dir)) return ''
  try {
    const { stdout } = await run('git', ['-C', String(dir), 'rev-parse', '--short', 'HEAD'], {
      timeout: 2500,
      windowsHide: true,
    })
    const hash = String(stdout || '').trim()
    return HASH_RE.test(hash) ? hash : ''
  } catch {
    return ''
  }
}

/** Candidate repository directories in priority order (resolved, de-duped). */
export function versionDirs(root, config, options = {}) {
  const configured = config && config.version && config.version.gitDir ? String(config.version.gitDir) : ''
  const candidates = []
  if (configured) candidates.push(path.isAbsolute(configured) ? configured : path.resolve(root, configured))
  if (options.cwd) candidates.push(String(options.cwd))
  candidates.push(root)
  const seen = new Set()
  return candidates.filter((dir) => {
    if (!dir) return false
    const resolved = path.resolve(dir)
    if (seen.has(resolved) || !existsSync(resolved)) return false
    seen.add(resolved)
    return true
  })
}

/**
 * Resolve the version stamped on a completed task.
 * @returns {Promise<{version: string, source: 'manual'|'git'|'none', dir: string}>}
 */
export async function resolveDoneVersion(root, config, options = {}) {
  const explicit = String(options.version == null ? '' : options.version).trim()
  if (explicit) return { version: explicit.slice(0, MAX_VERSION), source: 'manual', dir: '' }
  const auto = !config || !config.version || config.version.auto !== false
  if (!auto) return { version: '', source: 'none', dir: '' }
  const dirs = versionDirs(root, config, options)
  // Pure file parsing first: no child process, so it also works under the
  // DSH Windows sandbox where piped stdio can be refused.
  for (const dir of dirs) {
    const version = shortHashFromGitDir(dir)
    if (version) return { version, source: 'git', dir }
  }
  for (const dir of dirs) {
    const version = await gitShortHash(dir)
    if (version) return { version, source: 'git', dir }
  }
  return { version: '', source: 'none', dir: '' }
}

/** Actionable message when `version.require` blocks a completion. */
export function versionMissingMessage() {
  return '未能解析 git 短 hash：请在完成时显式传 version（例如 1.0.147 或 abc1234），或配置 version.gitDir 指向 git 仓库目录'
}
