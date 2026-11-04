/**
 * Best-effort Git integration.
 *
 * Every call degrades to "no data" instead of failing a ptodo command: the DSH
 * Windows sandbox can refuse piped child processes, and a project may simply
 * not be a repository. Version resolution keeps using the pure-file reader in
 * version.js; this module only adds commit evidence and repository linking.
 */
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { findGitDir, findRepoRoot } from './actor.js'
import { CONFIG_PATH } from './config.js'
import { writeAtomic } from './fs-store.js'
import { fail } from './model.js'

const run = promisify(execFile)
const MARKER = '# managed by dsh-project-todo'

function commonDirOf(gitDir) {
  try {
    return path.resolve(gitDir, readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim())
  } catch {
    return gitDir
  }
}

/** Absolute git directory for a work tree, or ''. */
export function gitDirFor(dir) {
  return findGitDir(dir)
}

export function hooksDirFor(dir) {
  const gitDir = findGitDir(dir)
  if (!gitDir) return ''
  // Hooks live in the common dir for linked worktrees too.
  return path.join(commonDirOf(gitDir), 'hooks')
}

export function hookPath(dir) {
  const hooks = hooksDirFor(dir)
  return hooks ? path.join(hooks, 'prepare-commit-msg') : ''
}

/** Commits whose subject mentions a task code; [] when git is unavailable. */
export async function relatedCommits(dir, taskId, limit = 5) {
  const repo = findRepoRoot(dir)
  if (!repo) return []
  try {
    const { stdout } = await run(
      'git',
      ['-C', repo, 'log', `-n`, String(limit), `--grep=${taskId}`, '--format=%h%x09%s'],
      { timeout: 3000, windowsHide: true, encoding: 'utf8' },
    )
    return String(stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash, ...subject] = line.split('\t')
        return { hash: hash || '', subject: subject.join('\t') }
      })
  } catch {
    return []
  }
}

/** One-line evidence string for `done`; '' when nothing is found. */
export async function autoEvidence(dir, taskId) {
  const commits = await relatedCommits(dir, taskId, 3)
  if (!commits.length) return ''
  return commits.map((commit) => `${commit.hash} ${commit.subject}`).join('; ').slice(0, 500)
}

/**
 * Distinct commit author names (`%an`) from the repository containing `dir`.
 * Degrades to [] outside a repository, when git is unavailable, or on timeout;
 * this only feeds the "who can be assigned" picker, never a write.
 */
export async function listGitAuthors(dir, limit = 3000) {
  const repo = findRepoRoot(dir)
  if (!repo) return []
  const depth = Math.max(1, Math.min(10000, Number(limit) || 3000))
  try {
    const { stdout } = await run('git', ['-C', repo, 'log', `-n`, String(depth), '--format=%an'], {
      timeout: 4000,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    })
    const names = new Set()
    for (const line of String(stdout || '').split(/\r?\n/)) {
      const name = line.trim()
      if (name) names.add(name)
    }
    return [...names]
  } catch {
    return []
  }
}

export async function commitExists(dir, commit) {
  const value = String(commit || '').trim()
  if (!value) return false
  const repo = findRepoRoot(dir)
  if (!repo) return false
  try {
    await run('git', ['-C', repo, 'cat-file', '-e', `${value}^{commit}`], { timeout: 2000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

/** Record the repository directory in docs/ptodo/config.json. */
export async function linkRepo(root, config, dir) {
  const repo = findRepoRoot(dir || root)
  if (!repo) fail('NOT_FOUND', `目录不是 git 仓库：${dir || root}`)
  const relative = path.relative(root, repo)
  const value = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : repo
  const file = path.join(root, CONFIG_PATH)
  let current = {}
  try {
    current = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    current = {}
  }
  current.version = { ...(current.version || {}), gitDir: value }
  await writeAtomic(file, `${JSON.stringify(current, null, 2)}\n`)
  return { dir: repo, value, file }
}

/** Install (or refresh) the prepare-commit-msg hook. */
export async function installHook(dir, options = {}) {
  const target = hookPath(dir)
  if (!target) fail('NOT_FOUND', '当前目录不是 git 仓库，无法安装钩子')
  if (existsSync(target)) {
    const text = readFileSync(target, 'utf8')
    if (!text.includes(MARKER) && !options.force) {
      fail('CONFLICT', `已存在其他 prepare-commit-msg 钩子：${target}；使用 --force 覆盖`)
    }
  }
  const script = `#!/bin/sh
${MARKER}
# Append the task code from PTODO_TASK to the commit message when present.
if [ -n "$PTODO_TASK" ]; then
  if ! grep -q "Refs: $PTODO_TASK" "$1" 2>/dev/null; then
    printf '\\nRefs: %s\\n' "$PTODO_TASK" >> "$1"
  fi
fi
`
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, script, 'utf8')
  try {
    chmodSync(target, 0o755)
  } catch {
    /* Windows has no executable bit */
  }
  return { path: target }
}

/** Remove the hook only when we installed it. */
export async function uninstallHook(dir, options = {}) {
  const target = hookPath(dir)
  if (!target) fail('NOT_FOUND', '当前目录不是 git 仓库')
  if (!existsSync(target)) return { path: target, removed: false }
  const text = readFileSync(target, 'utf8')
  if (!text.includes(MARKER) && !options.force) {
    fail('CONFLICT', `钩子不是 ptodo 安装的：${target}；使用 --force 强制删除`)
  }
  await rm(target, { force: true })
  return { path: target, removed: true }
}

/** True when a work tree exists at `dir`; used by doctor without throwing. */
export function isGitRepo(dir) {
  const gitDir = findGitDir(dir)
  if (!gitDir) return false
  try {
    return statSync(gitDir).isDirectory()
  } catch {
    return false
  }
}
