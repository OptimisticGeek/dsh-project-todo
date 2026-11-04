/**
 * `ptodo context ...` — goal / decisions / progress / open loops.
 */
import { act, getTask } from '../service.js'
import { TodoError } from '../model.js'
import { bool, one } from './args.mjs'
import { write, writeJson, resultPayload } from './output.mjs'

function idOf(ctx) {
  const id = ctx.positional && ctx.positional[1]
  if (!id) throw new TodoError('INVALID', 'context 命令需要任务 ID')
  return String(id)
}

function textOf(ctx, flags) {
  return one(flags.text) || (ctx.positional && ctx.positional[2]) || ''
}

export async function contextCommand(ctx, flags) {
  const action = (ctx.positional && ctx.positional[0]) || 'get'
  const id = idOf(ctx)
  if (action === 'get') {
    const detail = await getTask(ctx.root, ctx.config, id, { cwd: ctx.cwd })
    if (bool(flags.json)) writeJson({ ok: true, action: 'context_get', id, context: detail.task.context })
    else {
      const context = detail.task.context
      const lines = [`${id} ${detail.task.title}`]
      if (context.goal) lines.push(`目标：${context.goal}`)
      if (context.progress) lines.push(`进度：${context.progress}`)
      lines.push(`决策（${context.decisions.length}）：`)
      for (const entry of context.decisions) lines.push(`  - ${entry.text}（${entry.by || '—'}）`)
      lines.push(`未关闭事项（${context.openLoops.length}）：`)
      context.openLoops.forEach((entry, index) => lines.push(`  ${index + 1}. ${entry.text}`))
      write(lines.join('\n'))
    }
    return
  }
  if (action === 'decision') {
    const text = textOf(ctx, flags)
    if (!text) throw new TodoError('INVALID', 'context decision 需要文本')
    const result = await act(ctx.root, ctx.config, { action: 'context_decision', id, text: String(text), by: ctx.actor }, ctx.actor, { cwd: ctx.cwd })
    if (bool(flags.json)) writeJson(resultPayload('context_decision', result))
    else write(result.message)
    return
  }
  if (action === 'progress') {
    const text = textOf(ctx, flags)
    const result = await act(ctx.root, ctx.config, { action: 'context_progress', id, text: String(text || ''), by: ctx.actor }, ctx.actor, { cwd: ctx.cwd })
    if (bool(flags.json)) writeJson(resultPayload('context_progress', result))
    else write(result.message)
    return
  }
  if (action === 'loop') {
    const close = one(flags.close)
    const text = textOf(ctx, flags)
    const result = await act(
      ctx.root,
      ctx.config,
      { action: 'context_loop', id, text: String(text || ''), close: close && close !== true ? Number(close) : undefined, by: ctx.actor },
      ctx.actor,
      { cwd: ctx.cwd },
    )
    if (bool(flags.json)) writeJson(resultPayload('context_loop', result))
    else write(result.message)
    return
  }
  throw new TodoError('INVALID', `未知 context 子命令：${action}（get/decision/progress/loop）`)
}
