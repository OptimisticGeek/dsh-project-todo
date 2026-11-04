/**
 * `ptodo pre ...` — task preconditions (AND gate, independent of stage/milestone).
 */
import { act } from '../service.js'
import { TodoError } from '../model.js'
import { bool, one } from './args.mjs'
import { write, writeJson, resultPayload } from './output.mjs'

function taskIdOf(ctx, flags) {
  const id = (ctx.positional && ctx.positional[1]) || one(flags.id)
  if (!id || id === true) throw new TodoError('INVALID', 'pre 命令需要任务 ID')
  return String(id)
}

function paramsOf(flags) {
  const params = {}
  const task = one(flags.target) || one(flags.task)
  if (task && task !== true) params.taskId = String(task)
  const tag = one(flags.tag)
  if (tag && tag !== true) params.tag = String(tag)
  const resource = one(flags.resource)
  if (resource && resource !== true) params.resourceId = String(resource)
  const commit = one(flags.commit)
  if (commit && commit !== true) params.commit = String(commit)
  return params
}

function emit(ctx, flags, action, result) {
  if (bool(flags.json)) writeJson(resultPayload(action, result))
  else write(result.message)
}

export async function preCommand(ctx, flags) {
  const action = (ctx.positional && ctx.positional[0]) || 'list'
  const id = taskIdOf(ctx, flags)
  if (action === 'add') {
    const type = one(flags.type)
    if (!type || type === true) throw new TodoError('INVALID', 'pre add 需要 --type')
    const result = await act(
      ctx.root,
      ctx.config,
      {
        action: 'pre_add',
        id,
        type: String(type),
        params: paramsOf(flags),
        required: !bool(flags.optional),
        by: ctx.actor,
      },
      ctx.actor,
      { cwd: ctx.cwd },
    )
    emit(ctx, flags, 'pre_add', result)
    return
  }
  if (action === 'confirm') {
    const preId = (ctx.positional && ctx.positional[2]) || one(flags.pre)
    if (!preId) throw new TodoError('INVALID', 'pre confirm 需要前置条件 ID')
    const result = await act(
      ctx.root,
      ctx.config,
      { action: 'pre_confirm', id, preId: String(preId), note: one(flags.note) || undefined, by: ctx.actor },
      ctx.actor,
      { cwd: ctx.cwd },
    )
    emit(ctx, flags, 'pre_confirm', result)
    return
  }
  if (action === 'remove') {
    const preId = (ctx.positional && ctx.positional[2]) || one(flags.pre)
    if (!preId) throw new TodoError('INVALID', 'pre remove 需要前置条件 ID')
    const result = await act(
      ctx.root,
      ctx.config,
      { action: 'pre_remove', id, preId: String(preId), by: ctx.actor },
      ctx.actor,
      { cwd: ctx.cwd },
    )
    emit(ctx, flags, 'pre_remove', result)
    return
  }
  if (action === 'list') {
    const { getTask } = await import('../service.js')
    const detail = await getTask(ctx.root, ctx.config, id, { cwd: ctx.cwd })
    if (bool(flags.json)) writeJson({ ok: true, action: 'pre_list', id, preconditions: detail.preconditions })
    else {
      write(
        detail.preconditions.length
          ? detail.preconditions
              .map((pre) => `${pre.id} ${pre.type}${pre.required === false ? '（可选）' : ''} ${pre.satisfied ? '✅' : '⏳'}`)
              .join('\n')
          : '（暂无前置条件）',
      )
    }
    return
  }
  throw new TodoError('INVALID', `未知 pre 子命令：${action}（add/remove/list/confirm）`)
}
