/**
 * `ptodo res ...` — task-local resources (specs, designs, repos, URLs).
 */
import { act } from '../service.js'
import { TodoError } from '../model.js'
import { bool, one } from './args.mjs'
import { write, writeJson, resultPayload } from './output.mjs'

function taskIdOf(ctx, flags) {
  const id = (ctx.positional && ctx.positional[1]) || one(flags.id)
  if (!id || id === true) throw new TodoError('INVALID', 'res 命令需要任务 ID')
  return String(id)
}

function emit(ctx, flags, action, result) {
  if (bool(flags.json)) writeJson(resultPayload(action, result))
  else write(result.message)
}

export async function resCommand(ctx, flags) {
  const action = (ctx.positional && ctx.positional[0]) || 'list'
  const id = taskIdOf(ctx, flags)
  if (action === 'add') {
    const title = one(flags.title)
    if (!title || title === true) throw new TodoError('INVALID', 'res add 需要 --title')
    const result = await act(
      ctx.root,
      ctx.config,
      {
        action: 'res_add',
        id,
        title: String(title),
        type: one(flags.type) || 'doc',
        url: one(flags.url) || '',
        note: one(flags.note) || '',
        by: ctx.actor,
      },
      ctx.actor,
      { cwd: ctx.cwd },
    )
    emit(ctx, flags, 'res_add', result)
    return
  }
  if (action === 'approve') {
    const resourceId = (ctx.positional && ctx.positional[2]) || one(flags.resource)
    if (!resourceId) throw new TodoError('INVALID', 'res approve 需要资料 ID')
    const result = await act(
      ctx.root,
      ctx.config,
      { action: 'res_approve', id, resourceId: String(resourceId), note: one(flags.note) || undefined, by: ctx.actor },
      ctx.actor,
      { cwd: ctx.cwd },
    )
    emit(ctx, flags, 'res_approve', result)
    return
  }
  if (action === 'supersede') {
    const resourceId = (ctx.positional && ctx.positional[2]) || one(flags.resource)
    const replacement = one(flags['by-resource']) || one(flags.replacement)
    if (!resourceId || !replacement) throw new TodoError('INVALID', 'res supersede 需要资料 ID 与 --by-resource <新资料ID>')
    const result = await act(
      ctx.root,
      ctx.config,
      { action: 'res_supersede', id, resourceId: String(resourceId), byResource: String(replacement), by: ctx.actor },
      ctx.actor,
      { cwd: ctx.cwd },
    )
    emit(ctx, flags, 'res_supersede', result)
    return
  }
  if (action === 'list') {
    const result = await act(
      ctx.root,
      ctx.config,
      { action: 'res_list', id, status: one(flags.status) || undefined, by: ctx.actor },
      ctx.actor,
      { cwd: ctx.cwd },
    )
    if (bool(flags.json)) writeJson(resultPayload('res_list', result))
    else {
      const resources = result.resources || []
      write(
        resources.length
          ? resources.map((resource) => `${resource.id} [${resource.status}] ${resource.title}${resource.url ? ` ${resource.url}` : ''}${resource.supersededBy ? ` → ${resource.supersededBy}` : ''}`).join('\n')
          : '（暂无资料）',
      )
    }
    return
  }
  throw new TodoError('INVALID', `未知 res 子命令：${action}（add/approve/supersede/list）`)
}
