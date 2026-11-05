/**
 * CLI surface over `../skills.js`: install the `project-todo` skill into the
 * directories each AI coding tool scans. The same primitives back the Web
 * "first run" panel, so both surfaces always agree about targets and state.
 */
import os from 'node:os'
import path from 'node:path'
import { TodoError } from '../model.js'
import { bool, one } from './args.mjs'
import { write, writeJson } from './output.mjs'
import { SKILL_SOURCE, SKILL_TARGETS, installSkill, removeSkills, skillStatus, skillTargets } from '../skills.js'

function selectedTargets(flags) {
  const raw = one(flags.targets)
  if (!raw || raw === true || raw === 'all') return SKILL_TARGETS
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export async function skillCommand(ctx, flags) {
  const action = (ctx.positional && ctx.positional[0]) || 'status'
  const home = one(flags.home) ? path.resolve(String(one(flags.home))) : os.homedir()
  const targets = selectedTargets(flags)
  const map = skillTargets(ctx.root, home)

  if (action === 'install') {
    const results = []
    for (const name of targets) {
      const target = map[name]
      if (!target) throw new TodoError('INVALID', `未知技能目标：${name}`)
      results.push({ name, path: target, state: installSkill(target, { force: bool(flags.force), copy: bool(flags.copy) }) })
    }
    if (bool(flags.json)) {
      writeJson({ ok: true, action: 'skill_install', source: SKILL_SOURCE, results })
      return
    }
    write([`技能已安装：${SKILL_SOURCE}`, ...results.map((item) => `  ${item.name.padEnd(10)} ${item.state.padEnd(7)} ${item.path}`)].join('\n'))
    return
  }

  if (action === 'status') {
    const report = skillStatus(ctx.root, home, targets)
    if (bool(flags.json)) {
      writeJson({ ok: true, action: 'skill_status', source: SKILL_SOURCE, results: report })
      return
    }
    write([`技能源：${SKILL_SOURCE}`, ...report.map((item) => `  ${item.name.padEnd(10)} ${item.state.padEnd(8)} ${item.path}`)].join('\n'))
    return
  }

  if (action === 'remove') {
    const results = removeSkills(ctx.root, home, targets)
    if (bool(flags.json)) {
      writeJson({ ok: true, action: 'skill_remove', results })
      return
    }
    write(results.map((item) => `  ${item.name.padEnd(10)} ${item.removed ? 'removed' : 'skipped'} ${item.path}`).join('\n'))
    return
  }

  throw new TodoError('INVALID', `未知 skill 子命令：${action}（install/status/remove）`)
}

/** Non-printing status used by `ptodo doctor`. */
export function skillReport(ctx, flags) {
  const home = one(flags.home) ? path.resolve(String(one(flags.home))) : os.homedir()
  return { source: SKILL_SOURCE, results: skillStatus(ctx.root, home, selectedTargets(flags)) }
}

export { SKILL_SOURCE }
