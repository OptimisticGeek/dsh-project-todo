/**
 * Page/script-only actions. These are intentionally not taught by the skill:
 * the agent-facing protocol only needs status/list/get/next/create/claim/
 * update/done/block/release.
 */
import { act, exportProject, getPeople, importProjectFile, repairPeople } from '../service.js'
import { TodoError } from '../model.js'
import { one, bool, list } from './args.mjs'
import { write, writeJson, resultPayload } from './output.mjs'
import { timelineCommand } from './commands.mjs'

function idOf(ctx, flags, action) {
  const id = one(flags.id) || (ctx.positional && ctx.positional[1])
  if (!id || id === true) throw new TodoError('INVALID', `${action} 需要任务 ID`)
  return String(id)
}

async function call(ctx, payload) {
  return act(ctx.root, ctx.config, { ...payload, by: ctx.actor, person: ctx.person }, ctx.actor, { cwd: ctx.cwd })
}

function emit(ctx, flags, action, result) {
  if (bool(flags.json)) writeJson(resultPayload(action, result))
  else write(result.message + (result.warning ? `\n⚠ ${result.warning}` : ''))
}

export async function adminCommand(ctx, flags) {
  const action = ctx.positional && ctx.positional[0]
  if (!action) throw new TodoError('INVALID', 'admin 需要子命令，例如 ptodo admin archive T-0001')
  switch (action) {
    case 'reopen':
    case 'unblock':
      return emit(ctx, flags, action, await call(ctx, { action, id: idOf(ctx, flags, action) }))
    case 'archive':
      return emit(ctx, flags, 'archive', await call(ctx, { action: 'archive', id: idOf(ctx, flags, action) }))
    case 'unarchive':
      return emit(ctx, flags, 'unarchive', await call(ctx, { action: 'unarchive', id: idOf(ctx, flags, action) }))
    case 'archive-batch': {
      const ids = list(flags.ids)
      const milestone = one(flags.milestone)
      const stage = one(flags.stage)
      const milestoneCode = milestone && milestone !== true ? String(milestone) : undefined
      const stageCode = stage && stage !== true ? String(stage) : undefined
      if (!ids.length && !milestoneCode && !stageCode) {
        throw new TodoError('INVALID', 'archive-batch 需要 --ids、--milestone 或 --stage')
      }
      const payload = {
        action: 'archive_batch',
        ids: ids.length ? ids : undefined,
        milestoneCode,
        stageCode,
        doneOnly: flags['include-open'] === undefined ? true : !bool(flags['include-open']),
      }
      const result = await call(ctx, payload)
      if (bool(flags.json)) writeJson(resultPayload('archive_batch', result))
      else write(result.message + (result.warning ? `\n⚠ ${result.warning}` : ''))
      return
    }
    case 'delete':
      return emit(
        ctx,
        flags,
        'delete',
        await call(ctx, {
          action: 'delete',
          id: idOf(ctx, flags, 'delete'),
          cascade: bool(flags.cascade),
          purge: bool(flags.purge),
        }),
      )
    case 'claim-batch': {
      const tag = one(flags.tag)
      return emit(
        ctx,
        flags,
        'claim_batch',
        await call(ctx, {
          action: 'claim_batch',
          tag: tag && tag !== true ? String(tag) : undefined,
          limit: Number(one(flags.limit)) || undefined,
          force: bool(flags.force),
        }),
      )
    }
    case 'release-batch': {
      const tag = one(flags.tag)
      return emit(ctx, flags, 'release_batch', await call(ctx, { action: 'release_batch', tag: tag && tag !== true ? String(tag) : undefined }))
    }
    case 'check':
      return emit(ctx, flags, 'check', await call(ctx, { action: 'check' }))
    case 'people': {
      const data = await getPeople(ctx.root, ctx.config, { person: ctx.person, cwd: ctx.cwd })
      if (bool(flags.json)) {
        writeJson({ ok: true, action: 'people', ...data })
        return
      }
      const lines = [`当前人员：${data.person || '（未知）'}（共 ${data.people.length} 人）`]
      for (const entry of data.people) {
        lines.push(`  ${entry.name} [${entry.source}] 进行中 ${entry.active} · 已完成 ${entry.done}`)
      }
      write(lines.join('\n'))
      return
    }
    case 'repair-people': {
      const person = one(flags.person) || ctx.person
      const result = await repairPeople(ctx.root, ctx.config, {
        person,
        by: ctx.actor,
        cwd: ctx.cwd,
        dryRun: bool(flags['dry-run']),
      })
      if (bool(flags.json)) {
        writeJson(result)
        return
      }
      if (!result.changes.length) {
        write(`没有需要修复的人员字段（有效人员：${result.validPeople.join('、')}）`)
        return
      }
      const lines = [
        `${result.dryRun ? '预览' : '已修复'} ${result.changes.length} 处无效人员字段 → ${result.person}`,
        `有效人员：${result.validPeople.join('、')}`,
      ]
      for (const change of result.changes) lines.push(`  ${change.id}.${change.field}: ${change.from} → ${change.to}`)
      if (result.dryRun) lines.push('未写盘；去掉 --dry-run 执行。')
      write(lines.join('\n'))
      return
    }
    case 'timeline-clear':
      return emit(ctx, flags, 'timeline_clear', await call(ctx, { action: 'timeline_clear', confirm: bool(flags.confirm) }))
    case 'import': {
      const result = await call(ctx, {
        action: 'import',
        source: one(flags.source) || undefined,
        dryRun: bool(flags['dry-run']),
      })
      if (bool(flags.json)) return writeJson(result)
      if (result.dryRun) {
        write(`预览导入：将导入 ${result.willImport} 条，跳过 ${result.skipped} 条（来源 ${result.source}）`)
      } else {
        write(`导入完成：导入 ${result.imported} 条，跳过 ${result.skipped} 条（来源 ${result.source}）${result.warning ? `\n⚠ ${result.warning}` : ''}`)
      }
      return
    }
    case 'import-file': {
      const file = one(flags.file) || (ctx.positional && ctx.positional[1])
      if (!file || file === true) throw new TodoError('INVALID', 'import-file 需要文件路径')
      const result = await importProjectFile(ctx.root, ctx.config, {
        file: String(file),
        format: one(flags.format) || undefined,
        dryRun: bool(flags['dry-run']),
        by: ctx.actor,
      })
      if (bool(flags.json)) return writeJson({ ok: true, action: 'import_file', ...result })
      write(
        result.dryRun
          ? `预览导入：将导入 ${result.imported} 条，跳过 ${result.skipped} 条`
          : `导入完成：导入 ${result.imported} 条，跳过 ${result.skipped} 条${result.warning ? `\n⚠ ${result.warning}` : ''}`,
      )
      return
    }
    case 'export': {
      const result = await exportProject(ctx.root, ctx.config, {
        format: one(flags.format) === 'xlsx' ? 'xlsx' : 'md',
        scope: one(flags.scope) || 'active',
      })
      if (bool(flags.json)) return writeJson({ ok: true, action: 'export', ...result })
      write(`已导出 ${result.filename}\n${result.path}`)
      return
    }
    case 'timeline':
      return timelineCommand(ctx, flags)
    default:
      throw new TodoError('INVALID', `未知 admin 子命令：${action}`)
  }
}
