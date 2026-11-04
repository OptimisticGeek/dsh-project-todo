/**
 * Resolve the pieces every `ptodo` command needs: project root, actor and
 * effective config.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { configFor, normalizeConfig } from '../config.js'
import { resolveProjectRootFromCwd } from '../project.js'
import { resolveActor as resolveActorInfo } from '../actor.js'
import { fail } from '../model.js'
import { one } from './args.mjs'

export function resolveRoot(flags) {
  if (flags.root && flags.root !== true) return path.resolve(String(one(flags.root)))
  if (process.env.PTODO_ROOT) return path.resolve(process.env.PTODO_ROOT)
  return resolveProjectRootFromCwd(process.cwd())
}

export function resolveActor(flags, root) {
  return resolveActorInfo({
    by: one(flags.by),
    root,
    cwd: process.cwd(),
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

export function makeContext(flags) {
  const root = resolveRoot(flags)
  const info = resolveActor(flags, root)
  return {
    root,
    actor: info.actor,
    actorInfo: info,
    // Human identity for person fields (createdBy/holder/doneBy/archivedBy);
    // `actor` stays the tool-facing identity recorded in history.
    person: info.person,
    config: resolveConfig(root, flags),
    cwd: process.cwd(),
    tool: toolHint(),
  }
}
