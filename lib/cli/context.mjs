/**
 * Resolve the pieces every `ptask` command needs: project root, actor and
 * effective config.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { configFor, normalizeConfig } from '../config.js'
import { resolveProjectRootFromCwd } from '../project.js'
import { resolveActor as resolveActorInfo, findRepoRoot, hasGitUser } from '../actor.js'
import { fail } from '../model.js'
import { one } from './args.mjs'

/** Commands that are allowed to create a fresh store. */
const BOOTSTRAP = new Set(['init', 'migrate', 'doctor'])

/**
 * When `--root` is explicit, a missing store means a typo, not a new project.
 * Without this guard `task create --root /tmp/typo` silently created a whole
 * second board in a throwaway directory — the original mistake went unnoticed
 * until someone read the JSON.
 */
function assertExplicitProject(root, config, command) {
  if (BOOTSTRAP.has(command)) return
  const storeFile = path.resolve(root, config.store.path)
  if (existsSync(storeFile)) return
  fail(
    'NO_PROJECT',
    `--root 指向的目录没有待办库：${root}\n` +
      `  期望文件：${storeFile}\n` +
      `  路径写错请修正 --root；新项目请先运行：ptask --root ${root} init`,
  )
}

export function resolveRoot(flags) {
  if (flags.root && flags.root !== true) return path.resolve(String(one(flags.root)))
  if (process.env.PTASK_ROOT || process.env.ptask_ROOT) return path.resolve(process.env.PTASK_ROOT || process.env.ptask_ROOT)
  return resolveProjectRootFromCwd(process.cwd())
}

export function resolveActor(flags, root) {
  // `--root` may point at a different repository than the shell's cwd. When the
  // target project is a git work tree, its own user.name is the right person
  // for its records; otherwise fall back to the shell's repository/global name.
  const cwd = findRepoRoot(root) && hasGitUser(root) ? root : process.cwd()
  return resolveActorInfo({
    by: one(flags.by),
    root,
    cwd,
    env: process.env,
  })
}

/** Best-effort hint for diagnostics; the actor is never derived from it. */
export function toolHint() {
  if (process.env.DSH_SESSION_ID || process.env.DSH_HOME) return 'dsh'
  const keys = Object.keys(process.env)
  if (keys.some((key) => key.startsWith('WORKBUDDY'))) return 'workbuddy'
  if (keys.some((key) => key.startsWith('ZCODE'))) return 'zcode'
  if (keys.some((key) => key.startsWith('CODEX'))) return 'codex'
  return 'cli'
}

export function resolveConfig(root, flags) {
  const file = one(flags.config)
  if (file && file !== true) {
    const target = path.resolve(root, String(file))
    let parsed
    try {
      parsed = JSON.parse(readFileSync(target, 'utf8'))
    } catch (error) {
      fail('PARSE_ERROR', `配置文件读取失败：${target}：${error.message}`)
    }
    return normalizeConfig(parsed)
  }
  return configFor(root, {})
}

export function makeContext(flags, command) {
  const root = resolveRoot(flags)
  const config = resolveConfig(root, flags)
  const explicitRoot = Boolean(flags.root) || Boolean(process.env.PTASK_ROOT || process.env.ptask_ROOT)
  if (explicitRoot) assertExplicitProject(root, config, command)
  const info = resolveActor(flags, root)
  return {
    root,
    actor: info.actor,
    actorInfo: info,
    // Human identity for person fields (createdBy/holder/doneBy/archivedBy);
    // `actor` stays the tool-facing identity recorded in history.
    person: info.person,
    config,
    cwd: process.cwd(),
    tool: toolHint(),
  }
}
