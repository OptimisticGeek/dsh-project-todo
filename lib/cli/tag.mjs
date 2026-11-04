/**
 * `ptodo tag ...` — the project tag registry.
 */
import { act, getState } from '../service.js'
import { TodoError } from '../model.js'
import { bool, list, one } from './args.mjs'
import { write, writeJson, resultPayload } from './output.mjs'

function codeOf(ctx, flags, action) {
  const code = one(flags.code) || (ctx.positional && ctx.positional[1])
  if (!code || code === true) throw new TodoError('INVALID', `${action} 需要标签编码`)
  return String(code)
}

function emit(ctx, flags, action, result) {
  if (bool(flags.json)) writeJson(resultPayload(action, result))
  else write(result.message)
}

export async function tagCommand(ctx, flags) {
  const action = (ctx.positional && ctx.positional[0]) || 'list'
  switch (action) {
    case 'add': {
      const name = one(flags.name)
      if (!name || name === true) throw new TodoError('INVALID', 'tag add 需要 --name')
      const result = await act(
        ctx.root,
        ctx.config,
        {
          action: 'tag_add',
          name: String(name),
          code: one(flags.code) || undefined,
          description: one(flags.description) || '',
          aliases: list(flags.aliases),
          status: one(flags.status) || undefined,
          by: ctx.actor,
        },
        ctx.actor,
      )
      emit(ctx, flags, 'tag_add', result)
      return
    }
    case 'update': {
      const code = codeOf(ctx, flags, 'tag update')
      const result = await act(
        ctx.root,
        ctx.config,
        {
          action: 'tag_update',
          code,
          name: one(flags.name) || undefined,
          description: flags.description !== undefined ? String(one(flags.description) || '') : undefined,
          aliases: flags.aliases !== undefined ? list(flags.aliases) : undefined,
          status: one(flags.status) || undefined,
          by: ctx.actor,
        },
        ctx.actor,
      )
      emit(ctx, flags, 'tag_update', result)
      return
    }
    case 'deprecate': {
      const code = codeOf(ctx, flags, 'tag deprecate')
      // `--by` is the global actor flag, so the replacement uses --replacement.
      const replacement = one(flags.replacement) || one(flags['deprecated-by'])
      const result = await act(
        ctx.root,
        ctx.config,
        { action: 'tag_deprecate', code, replacement: replacement && replacement !== true ? String(replacement) : undefined, by: ctx.actor },
        ctx.actor,
      )
      emit(ctx, flags, 'tag_deprecate', result)
      return
    }
    case 'list': {
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      let tags = state.tags
      const status = one(flags.status)
      if (status && status !== true) tags = tags.filter((tag) => tag.status === status)
      if (bool(flags.json)) writeJson({ ok: true, action: 'tag_list', tags })
      else write(tags.map((tag) => `${tag.code} ${tag.name} [${tag.status}] ×${tag.usageCount}${tag.deprecatedBy ? ` → ${tag.deprecatedBy}` : ''}`).join('\n') || '（暂无标签）')
      return
    }
    case 'todos': {
      const code = codeOf(ctx, flags, 'tag todos')
      const state = await getState(ctx.root, ctx.config, { cwd: ctx.cwd })
      const tasks = (bool(flags.archived) ? state.archived : state.board.tasks).filter((task) => (task.tags || []).includes(code))
      if (bool(flags.json)) writeJson({ ok: true, action: 'tag_todos', code, tasks })
      else write(tasks.map((task) => `${task.id} [${task.status}] ${task.title}`).join('\n') || `没有任务使用标签 ${code}`)
      return
    }
    default:
      throw new TodoError('INVALID', `未知 tag 子命令：${action}（add/update/deprecate/list/todos）`)
  }
}
