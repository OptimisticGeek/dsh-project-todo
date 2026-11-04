/**
 * Install the `project-todo` skill into the directories each AI coding tool
 * scans. One source lives inside this package; installs are junctions on
 * Windows (falling back to copies) so updating the package updates every tool.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TodoError } from '../model.js'
import { bool, one } from './args.mjs'
import { write, writeJson } from './output.mjs'

const SOURCE = fileURLToPath(new URL('../../skill/project-todo/', import.meta.url))
const NAME = 'project-todo'

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function hashTree(dir) {
  const parts = []
  const walk = (current, relative) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
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

function targetMap(ctx, home) {
  return {
    project: path.join(ctx.root, '.agents', 'skills', NAME),
    agents: path.join(home, '.agents', 'skills', NAME),
    dsh: path.join(home, '.dsh', 'skills', NAME),
    zcode: path.join(home, '.zcode', 'skills', NAME),
    workbuddy: path.join(home, '.workbuddy', 'skills', NAME),
    claude: path.join(home, '.claude', 'skills', NAME),
    codex: path.join(home, '.codex', 'skills', NAME),
  }
}

function selectedTargets(flags) {
  const raw = one(flags.targets)
  if (!raw || raw === true || raw === 'all') return ['project', 'agents', 'dsh', 'zcode', 'workbuddy', 'claude', 'codex']
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function stateOf(target) {
  if (!existsSync(target)) return { state: 'missing' }
  try {
    if (path.resolve(realpathSync(target)) === path.resolve(realpathSync(SOURCE))) return { state: 'linked' }
  } catch {
    /* not a link */
  }
  const stat = lstatSync(target)
  if (stat.isDirectory()) {
    try {
      return { state: hashTree(target) === hashTree(SOURCE) ? 'copy' : 'drift' }
    } catch {
      return { state: 'drift' }
    }
  }
  return { state: 'foreign' }
}

function installOne(target, flags) {
  if (!existsSync(SOURCE)) throw new TodoError('NOT_FOUND', `技能源码不存在：${SOURCE}`)
  const current = stateOf(target)
  if (current.state === 'linked' || current.state === 'copy') return current.state
  if (current.state !== 'missing' && !bool(flags.force)) {
    throw new TodoError('CONFLICT', `目标已存在且不是本技能：${target}；使用 --force 覆盖`)
  }
  mkdirSync(path.dirname(target), { recursive: true })
  if (current.state !== 'missing') rmSync(target, { recursive: true, force: true })
  if (!bool(flags.copy)) {
    try {
      symlinkSync(SOURCE, target, process.platform === 'win32' ? 'junction' : 'dir')
      return 'linked'
    } catch {
      /* fall back to a copy (e.g. no junction permission) */
    }
  }
  cpSync(SOURCE, target, { recursive: true })
  return 'copy'
}

function statusReport(ctx, home, targets) {
  const map = targetMap(ctx, home)
  return targets.map((name) => ({ name, path: map[name], ...stateOf(map[name]) }))
}

export async function skillCommand(ctx, flags) {  const action = (ctx.positional && ctx.positional[0]) || 'status'
  const home = one(flags.home) ? path.resolve(String(one(flags.home))) : os.homedir()
  const targets = selectedTargets(flags)
  const map = targetMap(ctx, home)

  if (action === 'install') {
    const results = []
    for (const name of targets) {
      const state = installOne(map[name], flags)
      results.push({ name, path: map[name], state })
    }
    if (bool(flags.json)) {
      writeJson({ ok: true, action: 'skill_install', source: SOURCE, results })
      return
    }
    write([`技能已安装：${SOURCE}`, ...results.map((item) => `  ${item.name.padEnd(10)} ${item.state.padEnd(7)} ${item.path}`)].join('\n'))
    return
  }

  if (action === 'status') {
    const report = statusReport(ctx, home, targets)
    if (bool(flags.json)) {
      writeJson({ ok: true, action: 'skill_status', source: SOURCE, results: report })
      return
    }
    write([`技能源：${SOURCE}`, ...report.map((item) => `  ${item.name.padEnd(10)} ${item.state.padEnd(8)} ${item.path}`)].join('\n'))
    return
  }

  if (action === 'remove') {
    const results = []
    for (const name of targets) {
      const state = stateOf(map[name])
      if (state.state === 'linked' || state.state === 'copy') {
        rmSync(map[name], { recursive: true, force: true })
        results.push({ name, path: map[name], removed: true })
      } else {
        results.push({ name, path: map[name], removed: false, state: state.state })
      }
    }
    if (bool(flags.json)) {
      writeJson({ ok: true, action: 'skill_remove', results })
      return
    }
    write(results.map((item) => `  ${item.name.padEnd(10)} ${item.removed ? 'removed' : 'skipped'} ${item.path}`).join('\n'))
    return
  }

  throw new TodoError('INVALID', `未知 skill 子命令：${action}（install/status/remove）`)
}

export { SOURCE as SKILL_SOURCE }

/** Non-printing status used by `ptodo doctor`. */
export function skillReport(ctx, flags) {
  const home = one(flags.home) ? path.resolve(String(one(flags.home))) : os.homedir()
  return { source: SOURCE, results: statusReport(ctx, home, selectedTargets(flags)) }
}
