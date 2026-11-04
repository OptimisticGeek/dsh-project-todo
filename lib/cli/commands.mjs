/**
 * Core agent-facing commands. Every mutation goes through `service.act()`;
 * every read through `getState`/`getTask`/`getTimeline`, so the CLI, the Web
 * view and (historically) the removed tools always agreed.
 */
import { existsSync } from 'node:fs'
import {
  act,
  getState,
  getTask,
  getTimeline,
} from '../service.js'
import { storeFor, writeAtomic } from '../store.js'
import { emptyBoard, isContainer, sortTasks, TodoError } from '../model.js'
import { formatAgentSummary, formatBoardText, formatTaskText, formatTimeline } from '../format.js'
import { normalizeConfig, pathsOf } from '../config.js'
import { initOrg } from '../org.js'
import { initTags } from '../tags.js'
import { one, list, bool } from './args.mjs'
import { write, writeJson, resultPayload, doneMilestoneHint } from './output.mjs'

function pick(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    urgency: task.urgency,
    holder: task.holder,
    tags: task.tags,
    parentId: task.parentId,
  }
}

function leaves(board, status) {
  return sortTasks(board.tasks.filter((task) => task.status === status && !isContainer(task, board.tasks)))
}

function tagsFlag(flags) {
  const tags = list(flags.tags)
  return tags.length ? tags : undefined
}

function requireId(ctx, flags, action) {
  const id = one(flags.id) || (ctx.positional && ctx.positional[0])
  if (!id || id === true) throw new TodoError('INVALID', `${action} 需要任务 ID，例如 T-0007`)
  return String(id)
}

export async function status(ctx, flags) {
  const state = await getState(ctx.root, ctx.config)
  const doing = leaves(state.board, 'doing')
  const ready = sortTasks(state.board.tasks.filter((task) => task.isReady === true))
  const next = ready.slice(0, 3)
  const summary = formatAgentSummary(state.board, 2, { ready })
  if (bool(flags.json)) {
    writeJson({
      ok: true,
      action: 'status',
      root: ctx.root,
      actor: ctx.actor,
      revision: state.board.revision,
      counts: state.counts,
      doing: doing.map(pick),
      ready: ready.map(pick),
      next: next.map(pick),
      summary,
    })
    return
  }
  write(summary)
}

export async function listCommand(ctx, flags) {
  const state = await getState(ctx.root, ctx.config)
  const tag = one(flags.tag)
  if (bool(flags.archived)) {
    const tasks = state.archived.filter((task) => !tag || tag === true || (task.tags || []).includes(String(tag)))
    if (bool(flags.json)) {
      writeJson({ ok: true, action: 'list', archived: true, root: ctx.root, tasks })
      return
    }
    if (!tasks.length) {
      write('归档里没有符合条件的任务。')
      return
    }
    const lines = [`已归档 ${tasks.length} 条（${state.archivePath}）`]
    for (const task of tasks) {
      lines.push(
        `${task.id} [${task.priority}/紧急 ${task.urgency}] ${task.title} — 完成 ${task.doneAt || '—'} · 版本 ${task.doneVersion || '—'} · 归档 ${task.archivedAt || '—'}`,
      )
    }
    write(lines.join('\n'))
    return
  }

  const statusFilter = one(flags.status) || 'all'
  const matches = state.board.tasks.filter((task) => {
    if (statusFilter !== 'all' && statusFilter !== true && task.status !== String(statusFilter)) return false
    if (tag && tag !== true && !(task.tags || []).includes(String(tag))) return false
    return true
  })
  const keep = new Set()
  for (const task of matches) {
    keep.add(task.id)
    let parentId = task.parentId
    while (parentId) {
      keep.add(parentId)
      const parent = state.board.tasks.find((candidate) => candidate.id === parentId)
      parentId = parent ? parent.parentId : null
    }
  }
  const tasks = state.board.tasks.filter((task) => keep.has(task.id))
  if (bool(flags.json)) {
    writeJson({
      ok: true,
      action: 'list',
      root: ctx.root,
      revision: state.board.revision,
      counts: state.counts,
      tasks,
    })
    return
  }
  write(formatBoardText({ ...state.board, tasks }))
}

export async function getCommand(ctx, flags) {
  const id = one(flags.id) || (ctx.positional && ctx.positional[0])
  if (!id || id === true) throw new TodoError('INVALID', 'get 需要任务 ID，例如 ptodo get T-0007')
  const detail = await getTask(ctx.root, ctx.config, String(id))
  const history = flags['no-history'] === true ? [] : detail.history
  if (bool(flags.json)) {
    writeJson({ ok: true, action: 'get', task: detail.task, parent: detail.parent, children: detail.children, history, archived: detail.archived })
    return
  }
  write(formatTaskText(detail.board, detail.task, history))
}

export async function nextCommand(ctx, flags) {
  const tag = one(flags.tag)
  const parsed = Number(one(flags.limit))
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(20, Math.floor(parsed)) : 1
  const result = await act(
    ctx.root,
    ctx.config,
    { action: 'claim_batch', by: ctx.actor, person: ctx.person, tag: tag && tag !== true ? String(tag) : undefined, limit, force: bool(flags.force) },
    ctx.actor,
    { cwd: ctx.cwd },
  )
  if (!result.claimed || !result.claimed.length) {
    if (bool(flags.json)) writeJson({ ok: true, action: 'next', claimed: [], message: result.message })
    else write('当前没有可领取的任务（未开始叶子任务）。')
    return
  }
  const detail = await getTask(ctx.root, ctx.config, result.claimed[0])
  if (bool(flags.json)) {
    writeJson({
      ok: true,
      action: 'next',
      claimed: result.claimed,
      skipped: result.skipped,
      available: result.available,
      task: detail.task,
      message: result.message,
    })
    return
  }
  const lines = [`已领取 ${result.claimed.join('、')}`]
  if (result.skipped && result.skipped.length) lines.push(`跳过 ${result.skipped.map((item) => item.id).join('、')}`)
  lines.push('', formatTaskText(detail.board, detail.task, detail.history))
  write(lines.join('\n'))
}

/**
 * Zero-context "continue development": claim the next batch (3 by default).
 * This is the one command the skill points at for 「继续开发」.
 */
export async function continueCommand(ctx, flags) {
  const limit = flags.limit === undefined ? 3 : flags.limit
  return nextCommand(ctx, { ...flags, limit })
}

export async function createCommand(ctx, flags) {
  const title = one(flags.title)
  if (!title || title === true) throw new TodoError('INVALID', 'create 需要 --title')
  const urgency = one(flags.urgency)
  const holder = one(flags.holder)
  const result = await act(
    ctx.root,
    ctx.config,
    {
      action: 'create',
      title: String(title),
      parentId: one(flags.parent) || undefined,
      priority: one(flags.priority) || undefined,
      urgency: urgency === undefined || urgency === true ? undefined : Number(urgency),
      tags: tagsFlag(flags),
      notes: one(flags.notes) || undefined,
      stageCode: one(flags.stage) || undefined,
      by: ctx.actor,
      person: ctx.person,
      // CLI creates belong to the caller by default (the UI passes its own holder).
      holder: holder && holder !== true ? String(holder) : ctx.person,
    },
    ctx.actor,
    { cwd: ctx.cwd },
  )
  if (bool(flags.json)) writeJson(resultPayload('create', result))
  else write(result.message + (result.warning ? `\n⚠ ${result.warning}` : ''))
}

export async function claimCommand(ctx, flags) {
  const id = requireId(ctx, flags, 'claim')
  const result = await act(
    ctx.root,
    ctx.config,
    { action: 'claim', id, by: ctx.actor, person: ctx.person, force: bool(flags.force) },
    ctx.actor,
    { cwd: ctx.cwd },
  )
  if (bool(flags.json)) writeJson(resultPayload('claim', result))
  else write(result.message + (result.warning ? `\n⚠ ${result.warning}` : ''))
}

export async function releaseCommand(ctx, flags) {
  const id = requireId(ctx, flags, 'release')
  const result = await act(
    ctx.root,
    ctx.config,
    { action: 'release', id, by: ctx.actor, person: ctx.person, force: bool(flags.force) },
    ctx.actor,
    { cwd: ctx.cwd },
  )
  if (bool(flags.json)) writeJson(resultPayload('release', result))
  else write(result.message + (result.warning ? `\n⚠ ${result.warning}` : ''))
}

export async function blockCommand(ctx, flags) {
  const id = requireId(ctx, flags, 'block')
  const result = await act(
    ctx.root,
    ctx.config,
    { action: 'block', id, by: ctx.actor, person: ctx.person },
    ctx.actor,
    { cwd: ctx.cwd },
  )
  if (bool(flags.json)) writeJson(resultPayload('block', result))
  else write(result.message + (result.warning ? `\n⚠ ${result.warning}` : ''))
}

export async function doneCommand(ctx, flags) {
  const id = requireId(ctx, flags, 'done')
  const result = await act(
    ctx.root,
    ctx.config,
    {
      action: 'done',
      id,
      by: ctx.actor,
      person: ctx.person,
      version: one(flags.version) || undefined,
      evidence: one(flags.evidence) || undefined,
      force: bool(flags.force),
    },
    ctx.actor,
    { cwd: ctx.cwd },
  )
  if (bool(flags.json)) writeJson(resultPayload('done', result))
  else write(result.message + (result.warning ? `\n⚠ ${result.warning}` : '') + doneMilestoneHint(result))
}

export async function updateCommand(ctx, flags) {
  const id = requireId(ctx, flags, 'update')
  const payload = { action: 'update', id, by: ctx.actor, person: ctx.person }
  let changed = false
  for (const [flag, field] of [
    ['title', 'title'],
    ['priority', 'priority'],
    ['notes', 'notes'],
  ]) {
    if (flags[flag] !== undefined) {
      payload[field] = String(one(flags[flag]))
      changed = true
    }
  }
  if (flags.urgency !== undefined) {
    payload.urgency = Number(one(flags.urgency))
    changed = true
  }
  if (flags.tags !== undefined) {
    payload.tags = list(flags.tags)
    changed = true
  }
  if (flags.parent !== undefined) {
    payload.parentId = one(flags.parent) === '' ? null : String(one(flags.parent))
    changed = true
  }
  if (!changed) throw new TodoError('INVALID', 'update 至少需要一个字段：--title/--priority/--urgency/--tags/--notes/--parent')
  const result = await act(ctx.root, ctx.config, payload, ctx.actor, { cwd: ctx.cwd })
  if (bool(flags.json)) writeJson(resultPayload('update', result))
  else write(result.message + (result.warning ? `\n⚠ ${result.warning}` : ''))
}

export async function whoami(ctx, flags) {
  const paths = pathsOf(ctx.root, ctx.config)
  const board = storeFor(ctx.root, ctx.config).readSync()
  const info = ctx.actorInfo || { actor: ctx.actor, source: 'flag', gitName: '', hasPrefix: ctx.actor.includes(':') }
  const person = ctx.person || info.person || info.gitName || info.actor || ctx.actor
  const personSource = info.personSource || (info.gitName ? 'git' : info.source)
  const data = {
    ok: true,
    root: ctx.root,
    actor: ctx.actor,
    actorSource: info.source,
    person,
    personSource,
    gitName: info.gitName,
    hasPrefix: info.hasPrefix,
    tool: ctx.tool,
    revision: board ? board.revision : null,
    tasks: board ? board.tasks.length : 0,
    paths,
    config: {
      batch: ctx.config.batch,
      archive: ctx.config.archive,
      version: ctx.config.version,
      history: ctx.config.history,
      tag: ctx.config.tag,
      context: ctx.config.context,
      actor: ctx.config.actor,
      skill: ctx.config.skill,
    },
  }
  if (bool(flags.json)) {
    writeJson(data)
    return
  }
  const lines = [
    `root     ${ctx.root}`,
    `actor    ${ctx.actor} (${info.source}, ${ctx.tool})`,
    `person   ${person}（${personSource === 'git' ? 'git user.name' : '无 git user.name，取 actor 去前缀'}）`,
    `git name ${info.gitName || '（未配置）'}`,
    `prefix   ${info.hasPrefix ? '有工具前缀' : `缺少 ${'<agent>:'} 前缀（建议设置 PTODO_ACTOR）`}`,
    `board    ${paths.store}${existsSync(paths.store) ? '' : '（未初始化）'}`,
    `milestones ${paths.milestones}`,
    `tags     ${paths.tags}`,
    `archive  ${paths.archive}`,
    `history  ${paths.history}`,
    `config   ${paths.config}${existsSync(paths.config) ? '' : '（使用默认值）'}`,
    `revision ${board ? board.revision : '—'} · tasks ${board ? board.tasks.length : 0}`,
  ]
  write(lines.join('\n'))
}

export async function initCommand(ctx, flags) {
  const paths = pathsOf(ctx.root, ctx.config)
  const template = one(flags.template) === 'standard' ? 'standard' : 'simple'
  if (existsSync(paths.store)) {
    write(`已存在看板：${paths.store}`)
    return
  }
  const board = emptyBoard(ctx.root.split(/[\\/]/).filter(Boolean).pop() || 'project')
  await writeAtomic(paths.store, `${JSON.stringify(board, null, 2)}\n`)
  await initOrg(ctx.root, ctx.config)
  const lines = [`已初始化项目待办：${paths.store}`, `默认里程碑/阶段：${paths.milestones}`]
  if (template === 'standard') {
    await initTags(ctx.root, ctx.config)
    await writeAtomic(paths.config, `${JSON.stringify(normalizeConfig({}), null, 2)}\n`)
    lines.push(`已写入配置：${paths.config}`, `已写入标签库：${paths.tags}`)
  }
  write(lines.join('\n'))
}

export async function timelineCommand(ctx, flags) {
  const data = await getTimeline(ctx.root, ctx.config, {
    scope: one(flags.scope) || 'project',
    tag: one(flags.tag) || undefined,
    taskId: one(flags.task) || undefined,
    q: one(flags.q) || undefined,
    type: one(flags.type) || undefined,
    limit: Number(one(flags.limit)) || 20,
  })
  if (bool(flags.json)) {
    writeJson({ ok: true, action: 'timeline', ...data })
    return
  }
  write(formatTimeline(data))
}
