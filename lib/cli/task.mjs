/**
 * `ptask task ...` — the agent-facing task domain.
 *
 * Six verbs are taught by the skill (create/ready/start/done/release/block);
 * the rest are management commands (list/get/update/dep/...).
 */
import { act, getState, getTask } from '../service.js'
import { TodoError } from '../model.js'
import { formatStartBrief, formatTaskText } from '../format.js'
import { renderBrief, renderContext, renderList, renderSummary } from '../view.js'
import { bool, list, one } from './args.mjs'
import { write, writeJson, resultPayload, doneMilestoneHint } from './output.mjs'
import { noteWarnings } from './note-guard.mjs'

function viewPick(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    effectiveStatus: task.effectiveStatus,
    priority: task.priority,
    urgency: task.urgency,
    holder: task.holder,
    role: task.role,
    stageCode: task.stageCode,
    stageName: task.stageName,
    milestoneName: task.milestoneName,
    legacyId: task.legacyId,
    doneVersion: task.doneVersion,
    doneEvidence: task.doneEvidence,
    doneAt: task.doneAt,
    archivedAt: task.archivedAt,
  }
}

function findTask(state, id) {
  return state.board.tasks.find((task) => task.id === id) || state.archived.find((task) => task.id === id) || null
}

function idOf(ctx, flags, action) {
  const id = one(flags.id) || (ctx.positional && ctx.positional[1])
  if (!id || id === true) throw new TodoError('INVALID', `${action} 需要任务 ID，例如 T-0007`)
  return String(id)
}

function stageOf(flags) {
  const stage = one(flags.stage)
  return stage && stage !== true ? String(stage) : undefined
}

function tagsOf(flags) {
  return flags.tags === undefined ? undefined : list(flags.tags)
}

function emit(ctx, flags, action, result, text) {
  if (bool(flags.json)) writeJson(resultPayload(action, result))
  else write(text === undefined ? result.message : text)
}

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 }

/** Rank the ready queue and explain the first pick. Read-only, never claims. */
function recommend(state) {
  const ready = state.board.tasks.filter((task) => task.isReady)
  const sorted = [...ready].sort(
    (left, right) =>
      (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9) ||
      (right.urgency || 0) - (left.urgency || 0) ||
      String(left.createdAt || '').localeCompare(String(right.createdAt || '')),
  )
  const task = sorted[0]
  if (!task) return { task: null, reasons: [], alternatives: [], queueSize: 0 }
  const reasons = [
    `${task.priority}：当前就绪队列中优先级最高`,
    `紧急度 ${task.urgency || 3}；同优先级下按紧急度降序、再按创建时间升序`,
    '硬依赖与必填前置条件均已满足',
    '未被指派（holder 为空），可直接开工',
    sorted.length === 1 ? '就绪队列仅此一条' : `队列共 ${sorted.length} 条，取排序首位`,
  ]
  return {
    task,
    reasons,
    queueSize: sorted.length,
    alternatives: sorted.slice(1, 3).map((entry) => ({ id: entry.id, title: entry.title, priority: entry.priority, urgency: entry.urgency })),
  }
}

export async function taskCommand(ctx, flags) {
  const action = (ctx.positional && ctx.positional[0]) || 'list'
  switch (action) {
    case 'create': {
      const title = one(flags.title)
      if (!title || title === true) throw new TodoError('INVALID', 'task create 需要 --title')
      const urgency = one(flags.urgency)
      const holder = one(flags.holder)
      const claim = bool(flags.claim)
      const notes = one(flags.notes)
      const noteHints = noteWarnings(notes)
      const result = await act(
        ctx.root,
        ctx.config,
        {
          action: 'create',
          title: String(title),
          parentId: one(flags.parent) || undefined,
          priority: one(flags.priority) || undefined,
          urgency: urgency === undefined || urgency === true ? undefined : Number(urgency),
          tags: tagsOf(flags),
          notes: typeof notes === 'string' ? notes : undefined,
          stageCode: stageOf(flags),
          role: bool(flags.container) ? 'container' : undefined,
          by: ctx.actor,
          person: ctx.person,
          // Creating a task is registration, not a claim: leave it unassigned so
          // it shows up in `task ready`. Pass --holder or --claim to assign it now.
          holder: holder && holder !== true ? String(holder) : claim ? ctx.person : null,
        },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      if (bool(flags.json)) writeJson({ ...resultPayload('create', result), noteWarnings: noteHints })
      else {
        write(`${result.message}${result.warning ? `\n⚠ ${result.warning}` : ''}`)
        for (const hint of noteHints) write(`⚠ ${hint}`)
      }
      for (const blockedBy of list(flags['blocked-by'])) {
        const dep = await act(
          ctx.root,
          ctx.config,
          { action: 'dep_add', id: result.task.id, dependsOn: blockedBy, type: one(flags['dep-type']) || 'hard', by: ctx.actor, person: ctx.person },
          ctx.actor,
          { cwd: ctx.cwd },
        )
        if (!bool(flags.json)) write(dep.message)
      }
      return
    }
    case 'list': {
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      const archived = bool(flags.archived)
      const status = one(flags.status)
      const tag = one(flags.tag)
      const stage = stageOf(flags)
      const milestone = one(flags.milestone)
      const query = String(one(flags.query) || '').trim().toLowerCase()
      let tasks = archived ? state.archived : state.board.tasks
      tasks = tasks.filter((task) => {
        if (status && status !== true && status !== 'all' && task.status !== String(status)) return false
        if (stage && task.stageCode !== stage) return false
        if (milestone && milestone !== true && task.milestoneCode !== milestone) return false
        if (tag && tag !== true && !(task.tags || []).includes(String(tag))) return false
        if (bool(flags.blocked) && task.effectiveStatus !== 'blocked') return false
        if (bool(flags.ready) && !task.isReady) return false
        if (query && !`${task.id} ${task.title} ${(task.tags || []).join(' ')}`.toLowerCase().includes(query)) return false
        return true
      })
      const requested = Number(one(flags.limit))
      const limit = bool(flags.all) ? tasks.length : Number.isFinite(requested) && requested > 0 ? requested : 20
      if (bool(flags.json)) {
        writeJson({
          ok: true,
          action: 'list',
          root: ctx.root,
          revision: state.board.revision,
          counts: state.counts,
          archived,
          view: 'list',
          tasks: (bool(flags.full) ? tasks.slice(0, limit) : tasks.slice(0, limit).map(viewPick)),
          total: tasks.length,
        })
        return
      }
      write(renderList(tasks, { limit, archived, title: archived ? '归档任务' : '任务列表' }))
      return
    }
    case 'get':
    case 'show': {
      const id = idOf(ctx, flags, action === 'get' ? 'get' : 'show')
      const view = action === 'get' ? 'full' : bool(flags.full) ? 'full' : bool(flags.context) ? 'context' : 'brief'
      if (view === 'full') {
        const detail = await getTask(ctx.root, ctx.config, id, { cwd: ctx.cwd })
        if (bool(flags.json)) {
          writeJson({
            ok: true,
            action: 'show',
            view,
            task: detail.task,
            parent: detail.parent,
            children: detail.children,
            history: flags['no-history'] === true ? [] : detail.history,
            archived: detail.archived,
            stage: detail.stage,
            milestone: detail.milestone,
            preconditions: detail.preconditions,
            blocking: detail.blocking,
            blockers: detail.task.blockers,
            relatedCommits: detail.relatedCommits,
          })
          return
        }
        write(
          formatTaskText(detail.board, detail.task, flags['no-history'] === true ? [] : detail.history, {
            effectiveStatus: detail.task.effectiveStatus,
            stageName: detail.stage?.name,
            blocking: detail.blocking,
            relatedCommits: detail.relatedCommits,
            maxNotes: bool(flags.full) ? 0 : 300,
          }),
        )
        return
      }
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      const task = findTask(state, id)
      if (!task) throw new TodoError('NOT_FOUND', `没有任务 ${id}`)
      const text = view === 'context' ? renderContext(state, task) : renderBrief(state, task)
      if (bool(flags.json)) {
        const payload = {
          ok: true,
          action: 'show',
          view,
          root: ctx.root,
          revision: state.board.revision,
          task: viewPick(task),
          text,
        }
        if (view === 'brief') {
          payload.goal = task.context?.goal || null
          payload.progress = task.context?.progress || null
          payload.decisions = (task.context?.decisions || []).slice(-2)
          payload.openLoops = (task.context?.openLoops || []).length
          payload.blockers = task.blockers || []
        } else {
          const tasks = new Map([...state.board.tasks, ...state.archived].map((entry) => [entry.id, entry]))
          payload.parent = task.parentId && tasks.get(task.parentId) ? viewPick(tasks.get(task.parentId)) : null
          payload.children = state.board.tasks.filter((entry) => entry.parentId === task.id).map(viewPick)
          payload.dependsOn = (task.dependsOn || []).map((entry) => ({
            ...entry,
            title: tasks.get(entry.id)?.title || null,
            status: tasks.get(entry.id)?.status || null,
          }))
          payload.blocking = (task.blocking || []).map((entry) => ({
            ...entry,
            title: tasks.get(entry.id)?.title || null,
            status: tasks.get(entry.id)?.status || null,
          }))
          payload.preconditions = task.preconditions || []
          payload.resources = task.resources || []
          payload.causedBy = task.causedBy || []
          payload.openLoops = (task.context?.openLoops || []).length
        }
        writeJson(payload)
        return
      }
      write(text)
      return
    }
    case 'update': {
      const id = idOf(ctx, flags, 'update')
      const payload = { action: 'update', id, by: ctx.actor, person: ctx.person }
      let changed = false
      for (const [flag, field] of [
        ['title', 'title'],
        ['priority', 'priority'],
        ['notes', 'notes'],
        ['status', 'status'],
        ['stage', 'stageCode'],
        ['role', 'role'],
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
      if (flags.force !== undefined) payload.force = bool(flags.force)
      if (flags.version !== undefined) payload.version = String(one(flags.version))
      if (flags.evidence !== undefined) payload.evidence = String(one(flags.evidence))
      if (!changed) throw new TodoError('INVALID', 'task update 至少需要一个字段：--title/--priority/--urgency/--tags/--notes/--parent/--stage/--role')
      const result = await act(ctx.root, ctx.config, payload, ctx.actor, { cwd: ctx.cwd })
      emit(ctx, flags, 'update', result)
      return
    }
    case 'ready': {
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      const stage = stageOf(flags)
      const milestone = one(flags.milestone)
      const requested = Number(one(flags.limit))
      const limit = bool(flags.all) ? 0 : Number.isFinite(requested) && requested > 0 ? requested : 3
      let tasks = state.board.tasks.filter((task) => task.isReady)
      if (stage) tasks = tasks.filter((task) => task.stageCode === stage)
      if (milestone && milestone !== true) tasks = tasks.filter((task) => task.milestoneCode === milestone)
      if (bool(flags.json)) {
        writeJson({
          ok: true,
          action: 'ready',
          counts: state.counts,
          view: 'list',
          tasks: (limit > 0 ? tasks.slice(0, limit) : tasks).map(viewPick),
          total: tasks.length,
        })
        return
      }
      if (!tasks.length) {
        write('当前没有就绪任务（ptask ready 为空）。')
        return
      }
      write(renderList(tasks, { limit: limit > 0 ? limit : tasks.length, title: '就绪任务' }))
      return
    }
    case 'start': {
      const id = idOf(ctx, flags, 'start')
      const result = await act(ctx.root, ctx.config, { action: 'start', id, by: ctx.actor, person: ctx.person }, ctx.actor, { cwd: ctx.cwd })
      if (bool(flags.json)) writeJson(resultPayload('start', result))
      else write(formatStartBrief(result.brief, { full: bool(flags.full) }))
      return
    }
    case 'done': {
      const id = idOf(ctx, flags, 'done')
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
          backfill: bool(flags.backfill),
        },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      if (bool(flags.json)) writeJson(resultPayload('done', result))
      else {
        write(result.message + (result.unlocked.length ? `\n被解锁：${result.unlocked.join('、')}` : '') + doneMilestoneHint(result))
      }
      return
    }
    case 'release': {
      const id = idOf(ctx, flags, 'release')
      const result = await act(
        ctx.root,
        ctx.config,
        { action: 'release', id, by: ctx.actor, person: ctx.person, note: one(flags.note) || undefined, force: bool(flags.force) },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      if (bool(flags.json)) writeJson(resultPayload('release', result))
      else {
        const handoff = result.handoff
        write(
          [
            result.message || `已释放 ${id}`,
            handoff?.progress ? `进度：${handoff.progress}` : '',
            handoff?.openLoops?.length ? `未关闭：${handoff.openLoops.map((entry) => entry.text).join('；')}` : '',
            `下一步：${handoff?.nextStep || 'task start'}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }
      return
    }
    case 'block': {
      const id = idOf(ctx, flags, 'block')
      const reason = one(flags.reason)
      if (!reason || reason === true) throw new TodoError('INVALID', 'task block 需要 --reason')
      const result = await act(ctx.root, ctx.config, { action: 'block', id, by: ctx.actor, person: ctx.person, reason: String(reason) }, ctx.actor, { cwd: ctx.cwd })
      emit(ctx, flags, 'block', result)
      return
    }
    case 'unblock': {
      const id = idOf(ctx, flags, 'unblock')
      const result = await act(ctx.root, ctx.config, { action: 'unblock', id, by: ctx.actor, person: ctx.person }, ctx.actor, { cwd: ctx.cwd })
      emit(ctx, flags, 'unblock', result)
      return
    }
    case 'reopen': {
      const id = idOf(ctx, flags, 'reopen')
      const result = await act(ctx.root, ctx.config, { action: 'reopen', id, by: ctx.actor, person: ctx.person }, ctx.actor, { cwd: ctx.cwd })
      emit(ctx, flags, 'reopen', result)
      return
    }
    case 'dep': {
      const sub = (ctx.positional && ctx.positional[1]) || 'list'
      const id = one(flags.id) || (ctx.positional && ctx.positional[2])
      if (!id || id === true) throw new TodoError('INVALID', `task dep ${sub} 需要任务 ID`)
      if (sub === 'list') {
        const detail = await getTask(ctx.root, ctx.config, String(id), { cwd: ctx.cwd })
        if (bool(flags.json)) {
          writeJson({ ok: true, action: 'dep_list', id: detail.task.id, dependsOn: detail.task.dependsOn, blocking: detail.blocking })
          return
        }
        const lines = [`${detail.task.id} 依赖：`]
        if (!detail.task.dependsOn.length) lines.push('  （无）')
        for (const dep of detail.task.dependsOn) lines.push(`  - ${dep.id}（${dep.type}）${dep.note ? ` ${dep.note}` : ''}`)
        lines.push('被依赖：')
        if (!detail.blocking.length) lines.push('  （无）')
        for (const entry of detail.blocking) lines.push(`  - ${entry.id}（${entry.type}）`)
        write(lines.join('\n'))
        return
      }
      const dependsOn = one(flags['blocked-by']) || one(flags.on) || (ctx.positional && ctx.positional[3])
      if (!dependsOn || dependsOn === true) throw new TodoError('INVALID', `task dep ${sub} 需要 --blocked-by <ID>`)
      const result = await act(
        ctx.root,
        ctx.config,
        {
          action: sub === 'add' ? 'dep_add' : 'dep_remove',
          id: String(id),
          dependsOn: String(dependsOn),
          type: one(flags.type) || 'hard',
          note: one(flags.note) || undefined,
          by: ctx.actor,
        },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      emit(ctx, flags, sub === 'add' ? 'dep_add' : 'dep_remove', result)
      return
    }
    case 'suggest': {
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      const pick = recommend(state)
      if (bool(flags.json)) {
        writeJson({ ok: true, action: 'suggest', ...pick })
        return
      }
      if (!pick.task) {
        write('当前没有就绪任务；先处理阻塞项或新建可开工任务。')
        return
      }
      const lines = [
        `建议开工：${pick.task.id} [${pick.task.priority}/紧急 ${pick.task.urgency}] ${pick.task.title}`,
        '理由：',
        ...pick.reasons.map((reason) => `  - ${reason}`),
      ]
      if (pick.alternatives.length) lines.push(`备选：${pick.alternatives.map((entry) => `${entry.id} ${entry.title}`).join('；')}`)
      write(lines.join('\n'))
      return
    }
    case 'sync-parents': {
      const result = await act(
        ctx.root,
        ctx.config,
        { action: 'sync_parents', dryRun: bool(flags['dry-run']), by: ctx.actor, person: ctx.person },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      if (bool(flags.json)) {
        writeJson({
          ok: true,
          action: 'sync_parents',
          count: result.count,
          dryRun: result.dryRun,
          changes: result.changes,
          message: result.message,
        })
        return
      }
      const lines = [result.message]
      for (const change of result.changes) {
        lines.push(`  ${change.id} ${change.title}：${change.from} → ${change.to}（${change.children} 子，归档 ${change.archivedChildren}）`)
      }
      if (result.dryRun) lines.push('未写盘；去掉 --dry-run 执行。')
      write(lines.join('\n'))
      return
    }
    case 'status': {
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      const summary = renderSummary(state, { limit: 2, maxChars: 400 })
      if (bool(flags.json)) {
        writeJson({
          ok: true,
          action: 'status',
          root: ctx.root,
          actor: ctx.actor,
          revision: state.board.revision,
          counts: state.counts,
          view: 'summary',
          summary,
        })
        return
      }
      write(summary)
      return
    }
    default:
      throw new TodoError('INVALID', `未知任务子命令：${action}（create/list/show/update/ready/start/done/release/block/dep/suggest/sync-parents）`)
  }
}

/** Old top-level `next` / `continue` aliases. */
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
  const detail = await getTask(ctx.root, ctx.config, result.claimed[0], { cwd: ctx.cwd })
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

export async function continueCommand(ctx, flags) {
  const limit = flags.limit === undefined ? 3 : flags.limit
  return nextCommand(ctx, { ...flags, limit })
}
