/**
 * `ptodo cause ...` — narrative causality (never affects scheduling).
 */
import { act, getTask } from '../service.js'
import { TodoError } from '../model.js'
import { bool, one } from './args.mjs'
import { write, writeJson, resultPayload } from './output.mjs'

function taskIdOf(ctx, flags) {
  const id = (ctx.positional && ctx.positional[1]) || one(flags.id)
  if (!id || id === true) throw new TodoError('INVALID', 'cause 命令需要任务 ID')
  return String(id)
}

export async function causeCommand(ctx, flags) {
  const action = (ctx.positional && ctx.positional[0]) || 'list'
  const id = taskIdOf(ctx, flags)
  if (action === 'add' || action === 'remove') {
    const type = one(flags.type)
    const ref = one(flags.ref)
    if (!type || type === true || !ref || ref === true) {
      throw new TodoError('INVALID', `cause ${action} 需要 --type 与 --ref`)
    }
    const result = await act(
      ctx.root,
      ctx.config,
      {
        action: action === 'add' ? 'cause_add' : 'cause_remove',
        id,
        type: String(type),
        ref: String(ref),
        note: one(flags.note) || '',
        by: ctx.actor,
      },
      ctx.actor,
      { cwd: ctx.cwd },
    )
    if (bool(flags.json)) writeJson(resultPayload(action === 'add' ? 'cause_add' : 'cause_remove', result))
    else write(result.message)
    return
  }
  if (action === 'list') {
    const detail = await getTask(ctx.root, ctx.config, id, { cwd: ctx.cwd })
    if (bool(flags.json)) writeJson({ ok: true, action: 'cause_list', id, causedBy: detail.task.causedBy, causes: detail.task.causes })
    else {
      const lines = [`${id} 原因：`, ...(detail.task.causedBy || []).map((edge) => `  - ${edge.type}:${edge.ref}${edge.note ? ` ${edge.note}` : ''}`)]
      lines.push('影响：', ...(detail.task.causes || []).map((edge) => `  - ${edge.type}:${edge.ref}${edge.note ? ` ${edge.note}` : ''}`))
      write(lines.join('\n'))
    }
    return
  }
  if (action === 'chain') {
    const result = await act(
      ctx.root,
      ctx.config,
      { action: 'cause_chain', id, depth: Number(one(flags.depth)) || 3, by: ctx.actor },
      ctx.actor,
      { cwd: ctx.cwd },
    )
    if (bool(flags.json)) writeJson(resultPayload('cause_chain', result))
    else {
      const lines = [`因果链：${result.id} ${result.title}${result.cycle ? ' [cycle]' : ''}`]
      lines.push('上游：')
      if (!result.up.length) lines.push('  （无）')
      for (const node of result.up) lines.push(`  ${'  '.repeat(node.depth - 1)}- ${node.id} ${node.title}`)
      lines.push('下游：')
      if (!result.down.length) lines.push('  （无）')
      for (const node of result.down) lines.push(`  ${'  '.repeat(node.depth - 1)}- ${node.id} ${node.title}`)
      write(lines.join('\n'))
    }
    return
  }
  throw new TodoError('INVALID', `未知 cause 子命令：${action}（add/remove/list/chain）`)
}
