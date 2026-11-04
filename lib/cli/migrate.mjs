/**
 * One-time migration to `docs/ptodo/` and to the v3 schema.
 *
 * Two cases share one command:
 *   1. legacy `.dsh/**` board → `docs/ptodo/**` (old files removed afterwards);
 *   2. already at `docs/ptodo/**` but board version < 3 → in-place upgrade with
 *      a backup in `docs/ptodo/.backup/`.
 *
 * `--dry-run` never writes. Revisions, IDs and nextId are preserved.
 */
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { TodoStore, storeFor, writeAtomic } from '../store.js'
import { deriveParents, normalizeArchive, normalizeBoard, validateArchive, validateBoard } from '../model.js'
import { initOrg } from '../org.js'
import { tagStoreFor } from '../tags.js'
import { TodoError } from '../model.js'
import { pathsOf } from '../config.js'
import { bool } from './args.mjs'
import { write, writeJson } from './output.mjs'

function legacyConfig(config) {
  return {
    ...config,
    store: { path: '.dsh/todos.json' },
    archive: { ...config.archive, path: '.dsh/archive.json' },
    history: { ...config.history, path: '.dsh/todos.history.jsonl' },
  }
}

function sameBoard(left, right) {
  return JSON.stringify(left.tasks) === JSON.stringify(right.tasks) && left.revision === right.revision && left.nextId === right.nextId
}

async function backupTarget(target, paths) {
  const dir = path.join(paths.dataDir, '.backup', `v2-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(dir, { recursive: true })
  for (const file of [target.file, target.archiveFile, target.historyFile]) {
    if (existsSync(file)) await copyFile(file, path.join(dir, path.basename(file))).catch(() => {})
  }
  return dir
}

async function bootstrapTags(store, config, board, by) {
  const codes = [...new Set(board.tasks.flatMap((task) => task.tags || []))]
  if (!codes.length) return []
  const result = await tagStoreFor(store.root, config).ensure(codes, by, {})
  return result.created
}

export async function migrateCommand(ctx, flags) {
  const config = ctx.config
  const paths = pathsOf(ctx.root, config)
  const source = new TodoStore(ctx.root, legacyConfig(config))
  const target = storeFor(ctx.root, config)
  const dryRun = bool(flags['dry-run'])
  const keepLegacy = bool(flags['keep-legacy'])
  const force = bool(flags.force)

  if (!existsSync(source.file)) {
    // Case 2: already in docs/ptodo; upgrade v2 → v3 in place.
    if (!existsSync(target.file)) throw new TodoError('NOT_FOUND', `没有找到看板：${target.file}`)
    const raw = JSON.parse(readFileSync(target.file, 'utf8'))
    const version = Number(raw.version)
    const board = normalizeBoard(raw)
    deriveParents(board)
    validateBoard(board)
    const archive = await target.readArchive()
    if (version >= 3) {
      const message = `已是 v3 布局，无需迁移：${target.file}`
      if (bool(flags.json)) writeJson({ ok: true, action: 'migrate', migrated: false, message, target: target.file })
      else write(message)
      return
    }
    const tags = [...new Set(board.tasks.flatMap((task) => task.tags || []))]
    const summary = {
      ok: true,
      action: 'migrate',
      dryRun,
      migrated: !dryRun,
      mode: 'schema',
      fromVersion: version,
      toVersion: 3,
      tasks: board.tasks.length,
      archiveTasks: archive.tasks.length,
      tags,
      target: target.file,
      milestones: paths.milestones,
      tagsFile: paths.tags,
    }
    if (dryRun) {
      if (bool(flags.json)) writeJson(summary)
      else {
        write(
          [
            '迁移预览（不写盘）：',
            `  看板   ${target.file}（v${version} → v3，${board.tasks.length} 条）`,
            `  归档   ${target.archiveFile}（${archive.tasks.length} 条）`,
            `  新增   ${paths.milestones}（默认里程碑/阶段）`,
            `  标签   ${tags.length} 个将登记为 draft：${tags.join('、') || '（无）'}`,
            `  备份   docs/ptodo/.backup/v2-<时间>/`,
          ].join('\n'),
        )
      }
      return
    }
    const backup = await backupTarget(target, paths)
    await writeAtomic(target.file, `${JSON.stringify(board, null, 2)}\n`)
    await writeAtomic(target.archiveFile, `${JSON.stringify(archive, null, 2)}\n`)
    if (!existsSync(paths.milestones)) await initOrg(ctx.root, config)
    const created = await bootstrapTags(target, config, board, ctx.actor)
    if (bool(flags.json)) writeJson({ ...summary, backup, tagsCreated: created })
    else {
      write(
        [
          `迁移完成：v${version} → v3，${board.tasks.length} 条任务`,
          `默认里程碑/阶段：${paths.milestones}`,
          `标签登记：新增 ${created.length} 个 draft`,
          `备份：${backup}`,
        ].join('\n'),
      )
    }
    return
  }

  // Case 1: move .dsh/** to docs/ptodo/**.
  const board = await source.read()
  const archive = await source.readArchive()
  const history = await source.readHistoryLog()
  let backupDir = ''
  if (existsSync(target.file)) {
    const current = await target.read()
    if (sameBoard(current, board)) {
      const message = `目标已是最新，无需迁移：${target.file}`
      if (bool(flags.json)) writeJson({ ok: true, action: 'migrate', migrated: false, message, target: target.file })
      else write(message)
      return
    }
    if (!force && !dryRun) {
      throw new TodoError('CONFLICT', `目标已存在且内容不同：${target.file}；使用 --force 先备份再覆盖`)
    }
    if (force && !dryRun) {
      backupDir = path.join(paths.dataDir, `.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`)
      await mkdir(backupDir, { recursive: true })
      for (const file of [target.file, target.archiveFile, target.historyFile]) {
        if (existsSync(file)) await copyFile(file, path.join(backupDir, path.basename(file)))
      }
    }
  }

  const tags = [...new Set(board.tasks.flatMap((task) => task.tags || []))]
  const summary = {
    ok: true,
    action: 'migrate',
    dryRun,
    migrated: !dryRun,
    mode: 'legacy-layout',
    source: {
      board: source.file,
      archive: source.archiveFile,
      history: source.historyFile,
      tasks: board.tasks.length,
      revision: board.revision,
      archiveTasks: archive.tasks.length,
      historyEntries: history.length,
    },
    target: {
      board: target.file,
      archive: target.archiveFile,
      history: target.historyFile,
      markdown: paths.markdown,
      archiveMarkdown: paths.archiveMarkdown,
    },
    history: '旧 history 丢弃（按用户要求，新 history 从空开始）',
    tags,
    legacy: keepLegacy ? 'retained' : 'deleted',
    backup: backupDir || null,
  }

  if (dryRun) {
    if (bool(flags.json)) writeJson(summary)
    else {
      write(
        [
          '迁移预览（不写盘）：',
          `  源   ${source.file}（${board.tasks.length} 条，revision ${board.revision}，v${board.version}）`,
          `  归档 ${source.archiveFile}（${archive.tasks.length} 条）`,
          `  日志 ${source.historyFile}（${history.length} 条，迁移后丢弃）`,
          `  目标 ${target.file}（v3，默认里程碑/阶段）`,
          `  标签 ${tags.length} 个将登记为 draft：${tags.join('、') || '（无）'}`,
          `  快照 ${paths.markdown} / ${paths.archiveMarkdown}`,
          `  旧文件 ${keepLegacy ? '保留' : '迁移成功后删除'}`,
        ].join('\n'),
      )
    }
    return
  }

  await mkdir(paths.dataDir, { recursive: true })
  await writeAtomic(target.file, `${JSON.stringify(board, null, 2)}\n`)
  await writeAtomic(target.archiveFile, `${JSON.stringify(archive, null, 2)}\n`)
  if (!existsSync(paths.milestones)) await initOrg(ctx.root, config)
  await bootstrapTags(target, config, board, ctx.actor)
  // Old history is discarded by design; tag bootstrap ran before this truncate.
  await writeAtomic(target.historyFile, '')
  await target.writeMarkdown(board, archive)

  // Validate before deleting anything.
  const verified = await target.read()
  if (!sameBoard(verified, board)) throw new TodoError('IO_ERROR', '迁移校验失败：目标看板与源不一致')
  await target.readArchive()

  if (!keepLegacy) {
    for (const file of [source.file, source.archiveFile, source.historyFile]) {
      await rm(file, { force: true })
    }
  }

  if (bool(flags.json)) writeJson(summary)
  else {
    write(
      [
        `迁移完成：${board.tasks.length} 条任务（revision ${board.revision}）→ ${target.file}`,
        `归档 ${archive.tasks.length} 条 → ${target.archiveFile}`,
        `默认里程碑/阶段 → ${paths.milestones}`,
        `旧 history ${history.length} 条已丢弃；旧文件${keepLegacy ? '保留' : '已删除'}`,
        `快照已重建：${paths.markdown}`,
      ].join('\n'),
    )
  }
}
