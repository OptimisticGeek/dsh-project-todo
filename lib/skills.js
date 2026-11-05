/**
 * Cross-tool skill installation shared by `ptodo skill …` and the Web
 * "first run" panel. One source lives inside this package; installs are
 * junctions on Windows (copies when symlinks are unavailable) so updating the
 * package updates every tool at once.
 */
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SKILL_NAME = 'project-todo'
export const SKILL_SOURCE = fileURLToPath(new URL('../skill/project-todo/', import.meta.url))

/**
 * Tools whose skills directory this package can write. `home` is the tool's
 * directory under the user home; its existence marks the tool as installed.
 * `note` is shown in the Web panel when the tool needs a manual import step.
 * @type {{ name: string, label: string, home: string, note?: string }[]}
 */
export const SKILL_TOOLS = [
  { name: 'claude', label: 'Claude Code', home: '.claude' },
  { name: 'codex', label: 'Codex', home: '.codex' },
  { name: 'workbuddy', label: 'WorkBuddy', home: '.workbuddy' },
  { name: 'zcode', label: 'ZCode', home: '.zcode' },
  {
    name: 'trae',
    label: 'Trae',
    home: '.trae',
    note: '部分 Trae 版本需在 Settings → Rule & Skills → Skills 手动导入该目录',
  },
  { name: 'dsh', label: 'DSH', home: '.dsh' },
  { name: 'agents', label: '通用 agents 目录', home: '.agents' },
]

/** Every installable target name, project first. */
export const SKILL_TARGETS = ['project', ...SKILL_TOOLS.map((tool) => tool.name)]

/**
 * Absolute install path per target.
 * @param {string} root - project root for the `project` target.
 * @param {string} home - user home; defaults to the current one.
 * @returns {Record<string, string>} target name to directory.
 */
export function skillTargets(root, home = os.homedir()) {
  const map = { project: path.join(root, '.agents', 'skills', SKILL_NAME) }
  for (const tool of SKILL_TOOLS) map[tool.name] = path.join(home, tool.home, 'skills', SKILL_NAME)
  return map
}

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function hashTree(dir) {
  const parts = []
  const walk = (current, relative) => {
    // Compare by code point, not locale: the hash must not depend on the
    // machine's collation (macOS and Linux sort CJK/lowercase differently).
    const compareName = (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    for (const entry of readdirSync(current, { withFileTypes: true }).sort(compareName)) {
      if (entry.name === '.DS_Store') continue
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) walk(absolute, rel)
      else if (entry.isFile()) parts.push(`${rel}:${hashFile(absolute)}`)
    }
  }
  walk(dir, '')
  return createHash('sha256').update(parts.join('\n')).digest('hex')
}

/**
 * @param {string} target - install directory to inspect.
 * @returns {{ state: 'linked'|'copy'|'drift'|'foreign'|'missing' }} one state.
 */
export function skillState(target) {
  if (!existsSync(target)) return { state: 'missing' }
  try {
    if (path.resolve(realpathSync(target)) === path.resolve(realpathSync(SKILL_SOURCE))) return { state: 'linked' }
  } catch {
    /* not a link */
  }
  const stat = lstatSync(target)
  if (stat.isDirectory()) {
    try {
      return { state: hashTree(target) === hashTree(SKILL_SOURCE) ? 'copy' : 'drift' }
    } catch {
      return { state: 'drift' }
    }
  }
  return { state: 'foreign' }
}

/**
 * Install the skill into one target directory.
 * @param {string} target - directory to create.
 * @param {object} [options] - `force` replaces a foreign/drifted entry; `copy` skips the symlink.
 * @returns {'linked'|'copy'} how it landed.
 */
export function installSkill(target, options = {}) {
  if (!existsSync(SKILL_SOURCE)) {
    const error = new Error(`技能源码不存在：${SKILL_SOURCE}`)
    error.code = 'NOT_FOUND'
    throw error
  }
  const current = skillState(target)
  if (current.state === 'linked' || current.state === 'copy') return current.state
  if (current.state !== 'missing' && !options.force) {
    const error = new Error(`目标已存在且不是本技能：${target}；使用 force 覆盖`)
    error.code = 'CONFLICT'
    throw error
  }
  mkdirSync(path.dirname(target), { recursive: true })
  if (current.state !== 'missing') rmSync(target, { recursive: true, force: true })
  if (!options.copy) {
    try {
      symlinkSync(SKILL_SOURCE, target, process.platform === 'win32' ? 'junction' : 'dir')
      return 'linked'
    } catch {
      /* fall back to a copy (e.g. no junction permission) */
    }
  }
  cpSync(SKILL_SOURCE, target, { recursive: true })
  return 'copy'
}

/**
 * One status row per target, including whether the owning tool is installed.
 * @param {string} root - project root for the `project` target.
 * @param {string} home - user home.
 * @param {string[]} [names] - subset of targets; defaults to all.
 * @returns {object[]} rows with name, path, state, detected, label, note.
 */
export function skillStatus(root, home = os.homedir(), names = SKILL_TARGETS) {
  const map = skillTargets(root, home)
  const rows = []
  for (const name of names) {
    const tool = SKILL_TOOLS.find((item) => item.name === name)
    rows.push({
      name,
      label: tool ? tool.label : '当前项目',
      path: map[name],
      state: names.includes(name) ? skillState(map[name]).state : 'missing',
      detected: name === 'project' ? true : Boolean(tool && existsSync(path.join(home, tool.home))),
      note: tool?.note || '',
    })
  }
  return rows
}

/**
 * First-run signal for the Web panel: nothing installed yet, but at least one
 * tool is present on this machine.
 * @param {object[]} rows - {@link skillStatus} rows.
 * @returns {boolean} whether to offer the one-click install.
 */
export function isFirstRun(rows) {
  const installed = rows.some((row) => row.state === 'linked' || row.state === 'copy')
  const detected = rows.some((row) => row.name !== 'project' && row.detected)
  return !installed && detected
}

/**
 * Install into several targets, keeping one failure from blocking the rest.
 * @param {string} root - project root.
 * @param {string} home - user home.
 * @param {string[]} names - target names to install.
 * @param {object} [options] - `force` / `copy`, forwarded to {@link installSkill}.
 * @returns {{ name: string, path: string, state: string, error?: string }[]} per-target results.
 */
export function installSkills(root, home, names, options = {}) {
  const map = skillTargets(root, home)
  const results = []
  for (const name of names) {
    const target = map[name]
    if (!target) {
      results.push({ name, path: '', state: 'invalid', error: `未知技能目标：${name}` })
      continue
    }
    try {
      results.push({ name, path: target, state: installSkill(target, options) })
    } catch (error) {
      results.push({ name, path: target, state: error.code === 'CONFLICT' ? 'conflict' : 'failed', error: error.message })
    }
  }
  return results
}

/**
 * Remove this skill from several targets (only entries that are ours).
 * @param {string} root - project root.
 * @param {string} home - user home.
 * @param {string[]} names - target names.
 * @returns {{ name: string, path: string, removed: boolean, state?: string }[]} per-target results.
 */
export function removeSkills(root, home, names) {
  const map = skillTargets(root, home)
  const results = []
  for (const name of names) {
    const target = map[name]
    if (!target) {
      results.push({ name, path: '', removed: false, state: 'invalid' })
      continue
    }
    const current = skillState(target).state
    if (current === 'linked' || current === 'copy') {
      rmSync(target, { recursive: true, force: true })
      results.push({ name, path: target, removed: true })
    } else {
      results.push({ name, path: target, removed: false, state: current })
    }
  }
  return results
}
