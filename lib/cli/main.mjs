/**
 * Entry point for the global `ptask` command.
 *
 * The primary surface is short verbs (`ptask show`, `ptask ready`). The
 * historical domain form (`ptask task show`) remains as a hidden alias.
 */
import { parseArgs } from './args.mjs'
import { makeContext } from './context.mjs'
import {
  blockCommand,
  claimCommand,
  continueCommand,
  createCommand,
  doneCommand,
  getCommand,
  initCommand,
  listCommand,
  nextCommand,
  releaseCommand,
  status,
  timelineCommand,
  updateCommand,
  whoami,
} from './commands.mjs'
import { taskCommand } from './task.mjs'
import { milestoneCommand, stageCommand } from './org.mjs'
import { tagCommand } from './tag.mjs'
import { contextCommand } from './context-cmd.mjs'
import { resCommand } from './res.mjs'
import { preCommand } from './pre.mjs'
import { causeCommand } from './cause.mjs'
import { gitCommand } from './git.mjs'
import { adminCommand } from './admin.mjs'
import { migrateCommand } from './migrate.mjs'
import { doctorCommand } from './doctor.mjs'
import { skillCommand } from './skill.mjs'
import { printHelp } from './help.mjs'
import { schemaJson } from './schema.mjs'
import { write, writeJson } from './output.mjs'
import { TodoError } from '../model.js'

/** Short verbs map to the task domain; `show` is the new public name for `get`. */
const TASK_SHORT = new Map([
  ['ready', 'ready'],
  ['show', 'show'],
  ['get', 'get'],
  ['start', 'start'],
  ['done', 'done'],
  ['block', 'block'],
  ['release', 'release'],
  ['create', 'create'],
  ['update', 'update'],
  ['list', 'list'],
  ['status', 'status'],
  ['suggest', 'suggest'],
  ['sync-parents', 'sync-parents'],
])

/** Tool version, or null when package.json is unavailable. */
async function toolVersion() {
  try {
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    return pkg.version || null
  } catch {
    return null
  }
}

const CORE = {
  status,
  list: listCommand,
  get: getCommand,
  next: nextCommand,
  continue: continueCommand,
  create: createCommand,
  claim: claimCommand,
  unclaim: releaseCommand,
  release: releaseCommand,
  block: blockCommand,
  done: doneCommand,
  update: updateCommand,
  timeline: timelineCommand,
  whoami,
  init: initCommand,
}

const DOMAINS = {
  task: taskCommand,
  milestone: milestoneCommand,
  stage: stageCommand,
  tag: tagCommand,
  context: contextCommand,
  res: resCommand,
  pre: preCommand,
  cause: causeCommand,
  git: gitCommand,
}

export async function main(argv) {
  const parsed = parseArgs(argv)
  const flags = parsed.flags

  if (flags.version === true && !parsed.command) {
    const version = await toolVersion()
    write(`ptask ${version || 'unknown'}`)
    return
  }

  if (!parsed.command || parsed.command === 'help' || flags.help === true) {
    // `ptask show --help` resolves to the task domain's `get` action.
    const isHelpVerb = parsed.command === 'help'
    const target = isHelpVerb ? parsed.args[0] : parsed.command
    const targetAction = isHelpVerb ? parsed.args[1] : parsed.args[0]
    const helpAction = TASK_SHORT.get(target) || targetAction
    const helpTarget = target === 'context' ? 'note' : target && TASK_SHORT.has(target) ? 'task' : target
    printHelp(helpTarget, helpAction)
    return
  }

  if (parsed.command === 'schema') {
    writeJson(schemaJson(await toolVersion()))
    return
  }

  const ctx = makeContext(flags, parsed.command)
  ctx.positional = parsed.args

  if (parsed.command === 'note') {
    ctx.positional = parsed.args
    await contextCommand(ctx, flags)
    return
  }

  if (TASK_SHORT.has(parsed.command)) {
    ctx.positional = [TASK_SHORT.get(parsed.command), ...parsed.args]
    await taskCommand(ctx, flags)
    return
  }

  if (parsed.command in DOMAINS) {
    await DOMAINS[parsed.command](ctx, flags)
    return
  }

  if (parsed.command in CORE) {
    await CORE[parsed.command](ctx, flags)
    return
  }

  if (parsed.command === 'admin') {
    ctx.positional = parsed.args
    await adminCommand(ctx, flags)
    return
  }

  if (parsed.command === 'migrate') {
    await migrateCommand(ctx, flags)
    return
  }

  if (parsed.command === 'doctor') {
    await doctorCommand(ctx, flags)
    return
  }

  if (parsed.command === 'skill') {
    ctx.positional = parsed.args
    await skillCommand(ctx, flags)
    return
  }

  throw new TodoError('INVALID', `未知命令：${parsed.command}。运行 ptask --help 查看可用命令。`)
}
