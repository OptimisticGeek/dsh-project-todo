/**
 * Entry point for the global `ptodo` command.
 *
 * The primary surface is `ptodo <domain> <action>`. The old one-level commands
 * remain as hidden aliases so existing scripts and the 1.x tests keep working.
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
import { write } from './output.mjs'
import { TodoError } from '../model.js'

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
    const pkg = await import('node:fs').then(({ readFileSync }) =>
      JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')),
    )
    write(`ptodo ${pkg.version}`)
    return
  }

  if (!parsed.command || parsed.command === 'help' || flags.help === true) {
    printHelp(parsed.command)
    return
  }

  const ctx = makeContext(flags)
  ctx.positional = parsed.args

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

  throw new TodoError('INVALID', `未知命令：${parsed.command}。运行 ptodo --help 查看可用命令。`)
}
