/**
 * `ptodo milestone ...` and `ptodo stage ...`.
 */
import { act, getState } from '../service.js'
import { TodoError } from '../model.js'
import { bool, list, one } from './args.mjs'
import { write, writeJson, resultPayload } from './output.mjs'

function codeOf(ctx, flags, action) {
  const code = one(flags.code) || (ctx.positional && ctx.positional[1])
  if (!code || code === true) throw new TodoError('INVALID', `${action} 需要编码`)
  return String(code)
}

function emit(ctx, flags, action, result) {
  if (bool(flags.json)) writeJson(resultPayload(action, result))
  else write(result.message)
}

function formatMilestones(state) {
  if (!state.milestones.length) return '（暂无里程碑）'
  const lines = []
  for (const milestone of state.milestones.sort((left, right) => left.order - right.order || left.code.localeCompare(right.code))) {
    lines.push(
      `${milestone.code} ${milestone.name} [${milestone.status}${milestone.effectiveStatus !== milestone.status ? `/${milestone.effectiveStatus}` : ''}] ${milestone.progress.done}/${milestone.progress.total}`,
    )
    const stages = state.stages
      .filter((stage) => stage.milestoneCode === milestone.code)
      .sort((left, right) => left.order - right.order || left.code.localeCompare(right.code))
    for (const stage of stages) lines.push(`  ${stage.code} ${stage.name} [${stage.status}] ${stage.progress.done}/${stage.progress.total}`)
    if (milestone.dependsOnMilestone.length) {
      lines.push(`  前置：${milestone.dependsOnMilestone.map((dep) => dep.code).join('、')}`)
    }
  }
  return lines.join('\n')
}

export async function milestoneCommand(ctx, flags) {
  const action = (ctx.positional && ctx.positional[0]) || 'list'
  switch (action) {
    case 'create': {
      const name = one(flags.name)
      if (!name || name === true) throw new TodoError('INVALID', 'milestone create 需要 --name')
      const result = await act(
        ctx.root,
        ctx.config,
        { action: 'milestone_create', name: String(name), description: one(flags.description) || '', stages: list(flags.stages), by: ctx.actor },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      emit(ctx, flags, 'milestone_create', result)
      return
    }
    case 'list': {
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      if (bool(flags.json)) writeJson({ ok: true, action: 'milestone_list', milestones: state.milestones, stages: state.stages })
      else write(formatMilestones(state))
      return
    }
    case 'get': {
      const code = codeOf(ctx, flags, 'milestone get')
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      const milestone = state.milestones.find((entry) => entry.code === code)
      if (!milestone) throw new TodoError('NOT_FOUND', `没有里程碑 ${code}`)
      const stages = state.stages.filter((stage) => stage.milestoneCode === code)
      if (bool(flags.json)) writeJson({ ok: true, action: 'milestone_get', milestone, stages })
      else write(`${milestone.code} ${milestone.name} [${milestone.status}] ${milestone.progress.done}/${milestone.progress.total}\n阶段：${stages.map((stage) => stage.code).join('、') || '（无）'}`)
      return
    }
    case 'update': {
      const code = codeOf(ctx, flags, 'milestone update')
      const result = await act(
        ctx.root,
        ctx.config,
        {
          action: 'milestone_update',
          code,
          name: one(flags.name) || undefined,
          description: flags.description !== undefined ? String(one(flags.description) || '') : undefined,
          status: one(flags.status) || undefined,
          order: flags.order !== undefined ? Number(one(flags.order)) : undefined,
          by: ctx.actor,
        },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      emit(ctx, flags, 'milestone_update', result)
      return
    }
    case 'delete': {
      const code = codeOf(ctx, flags, 'milestone delete')
      const result = await act(
        ctx.root,
        ctx.config,
        { action: 'milestone_delete', code, force: bool(flags.force), by: ctx.actor },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      emit(ctx, flags, 'milestone_delete', result)
      return
    }
    case 'dep': {
      const sub = (ctx.positional && ctx.positional[1]) || 'list'
      const code = one(flags.code) || (ctx.positional && ctx.positional[2])
      if (!code || code === true) throw new TodoError('INVALID', `milestone dep ${sub} 需要里程碑编码`)
      if (sub === 'list') {
        const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
        const milestone = state.milestones.find((entry) => entry.code === code)
        if (!milestone) throw new TodoError('NOT_FOUND', `没有里程碑 ${code}`)
        if (bool(flags.json)) writeJson({ ok: true, action: 'milestone_dep_list', milestone })
        else write(milestone.dependsOnMilestone.length ? milestone.dependsOnMilestone.map((dep) => dep.code).join('\n') : '（无前置）')
        return
      }
      const on = one(flags.on) || (ctx.positional && ctx.positional[3])
      if (!on || on === true) throw new TodoError('INVALID', `milestone dep ${sub} 需要 --on`)
      const result = await act(
        ctx.root,
        ctx.config,
        { action: sub === 'add' ? 'milestone_dep_add' : 'milestone_dep_remove', code: String(code), on: String(on), note: one(flags.note) || '', by: ctx.actor },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      emit(ctx, flags, sub === 'add' ? 'milestone_dep_add' : 'milestone_dep_remove', result)
      return
    }
    default:
      throw new TodoError('INVALID', `未知 milestone 子命令：${action}`)
  }
}

export async function stageCommand(ctx, flags) {
  const action = (ctx.positional && ctx.positional[0]) || 'list'
  switch (action) {
    case 'create': {
      const name = one(flags.name)
      if (!name || name === true) throw new TodoError('INVALID', 'stage create 需要 --name')
      const result = await act(
        ctx.root,
        ctx.config,
        {
          action: 'stage_create',
          milestoneCode: one(flags.milestone) || 'default',
          name: String(name),
          description: one(flags.description) || '',
          status: one(flags.status) || undefined,
          by: ctx.actor,
        },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      emit(ctx, flags, 'stage_create', result)
      return
    }
    case 'list': {
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      let stages = state.stages
      const milestone = one(flags.milestone)
      if (milestone && milestone !== true) stages = stages.filter((stage) => stage.milestoneCode === milestone)
      stages = stages.sort((left, right) => left.order - right.order || left.code.localeCompare(right.code))
      if (bool(flags.json)) writeJson({ ok: true, action: 'stage_list', stages })
      else write(stages.map((stage) => `${stage.code} ${stage.name} [${stage.status}] ${stage.progress.done}/${stage.progress.total} · ${stage.milestoneCode}`).join('\n'))
      return
    }
    case 'get': {
      const code = codeOf(ctx, flags, 'stage get')
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      const stage = state.stages.find((entry) => entry.code === code)
      if (!stage) throw new TodoError('NOT_FOUND', `没有阶段 ${code}`)
      if (bool(flags.json)) writeJson({ ok: true, action: 'stage_get', stage })
      else write(`${stage.code} ${stage.name} [${stage.status}] ${stage.progress.done}/${stage.progress.total} · ${stage.milestoneCode}`)
      return
    }
    case 'update': {
      const code = codeOf(ctx, flags, 'stage update')
      const result = await act(
        ctx.root,
        ctx.config,
        {
          action: 'stage_update',
          code,
          name: one(flags.name) || undefined,
          description: flags.description !== undefined ? String(one(flags.description) || '') : undefined,
          status: one(flags.status) || undefined,
          milestoneCode: one(flags.milestone) || undefined,
          order: flags.order !== undefined ? Number(one(flags.order)) : undefined,
          by: ctx.actor,
        },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      emit(ctx, flags, 'stage_update', result)
      return
    }
    case 'reorder': {
      const code = codeOf(ctx, flags, 'stage reorder')
      const order = one(flags.order)
      if (order === undefined || order === true) throw new TodoError('INVALID', 'stage reorder 需要 --order')
      const result = await act(ctx.root, ctx.config, { action: 'stage_reorder', code, order: Number(order), by: ctx.actor }, ctx.actor, { cwd: ctx.cwd })
      emit(ctx, flags, 'stage_reorder', result)
      return
    }
    case 'delete': {
      const code = codeOf(ctx, flags, 'stage delete')
      const result = await act(
        ctx.root,
        ctx.config,
        { action: 'stage_delete', code, moveTo: one(flags['move-to']) || undefined, force: bool(flags.force), by: ctx.actor },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      emit(ctx, flags, 'stage_delete', result)
      return
    }
    case 'dep': {
      const sub = (ctx.positional && ctx.positional[1]) || 'list'
      const code = one(flags.code) || (ctx.positional && ctx.positional[2])
      if (!code || code === true) throw new TodoError('INVALID', `stage dep ${sub} 需要阶段编码`)
      if (sub === 'list') {
        const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
        const stage = state.stages.find((entry) => entry.code === code)
        if (!stage) throw new TodoError('NOT_FOUND', `没有阶段 ${code}`)
        if (bool(flags.json)) writeJson({ ok: true, action: 'stage_dep_list', stage })
        else {
          write(
            [
              `阶段前置：${stage.dependsOnStage.map((dep) => dep.code).join('、') || '（无）'}`,
              `里程碑前置：${stage.dependsOnMilestone.map((dep) => dep.code).join('、') || '（无）'}`,
            ].join('\n'),
          )
        }
        return
      }
      const on = one(flags.on) || (ctx.positional && ctx.positional[3])
      if (!on || on === true) throw new TodoError('INVALID', `stage dep ${sub} 需要 --on`)
      const result = await act(
        ctx.root,
        ctx.config,
        {
          action: sub === 'add' ? 'stage_dep_add' : 'stage_dep_remove',
          code: String(code),
          on: String(on),
          onMilestone: bool(flags['on-milestone']),
          note: one(flags.note) || '',
          by: ctx.actor,
        },
        ctx.actor,
        { cwd: ctx.cwd },
      )
      emit(ctx, flags, sub === 'add' ? 'stage_dep_add' : 'stage_dep_remove', result)
      return
    }
    default:
      throw new TodoError('INVALID', `未知 stage 子命令：${action}`)
  }
}
