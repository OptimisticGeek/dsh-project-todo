/**
 * `ptodo doctor`: explain exactly which data files, config, git resolver and
 * skill installs the current invocation will use, and surface v2/v3 health
 * issues (dependency cycles, missing context, stale resources, draft tags).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathsOf } from '../config.js'
import { storeFor } from '../store.js'
import { orgStoreFor } from '../org.js'
import { tagStoreFor } from '../tags.js'
import { shortHashFromGitDir } from '../version.js'
import { findDependencyCycle } from '../deps.js'
import { hasGitUser, actorHint } from '../actor.js'
import { skillReport } from './skill.mjs'
import { bool } from './args.mjs'
import { write, writeJson } from './output.mjs'

const PACKAGE = fileURLToPath(new URL('../../package.json', import.meta.url))

function readVersion() {
  try {
    return JSON.parse(readFileSync(PACKAGE, 'utf8'))
  } catch {
    return { version: 'unknown', name: 'dsh-project-todo' }
  }
}

function rawBoardVersion(file) {
  try {
    return Number(JSON.parse(readFileSync(file, 'utf8')).version)
  } catch {
    return 0
  }
}

/** A `doneVersion` that names a version note: `x.y.z`, optionally `v`-prefixed. */
const VERSION_DOC_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

/** Where version notes live: `version.docDir`, else the first existing default. */
function versionDocDir(root, config) {
  const explicit = String(config.version?.docDir || '').trim()
  if (explicit) return path.resolve(root, explicit)
  const candidates = [path.join(root, 'docs', 'version'), path.join(root, 'utp', 'docs', 'version')]
  return candidates.find((dir) => existsSync(dir)) || candidates[0]
}

/**
 * One aggregated warning for released versions without `<version>.md`.
 * Done tasks in the board and the archive both count; git short hashes and
 * other non-`x.y.z` doneVersions are ignored because they are not releases.
 */
function versionDocCheck(root, config, board, archive) {
  const counts = new Map()
  for (const task of [...(board?.tasks || []), ...(archive?.tasks || [])]) {
    if (task.status !== 'done') continue
    const version = String(task.doneVersion == null ? '' : task.doneVersion).trim()
    if (!version || !VERSION_DOC_RE.test(version)) continue
    counts.set(version, (counts.get(version) || 0) + 1)
  }
  if (!counts.size) return { name: 'version', status: 'ok', detail: '暂无带 x.y.z 版本号的已完成任务' }
  const dir = versionDocDir(root, config)
  const missing = [...counts.entries()].filter(([version]) => !existsSync(path.join(dir, `${version}.md`)))
  if (!missing.length) return { name: 'version', status: 'ok', detail: `版本文档齐全（${dir}）` }
  missing.sort((left, right) => left[0].localeCompare(right[0], 'en', { numeric: true }))
  const shown = missing.slice(0, 3)
  const rest = missing.length - shown.length
  const detail = `版本文档缺失：${shown.map(([version, count]) => `${version}（${count} 个任务）`).join('、')}${
    rest > 0 ? ` 等 ${missing.length} 个版本` : ''
  }；建议在 ${dir} 创建 ${shown.map(([version]) => `${version}.md`).join('、')}（只提醒，不阻断 done）`
  return { name: 'version', status: 'warn', detail }
}

export async function doctorCommand(ctx, flags) {
  const pkg = readVersion()
  const paths = pathsOf(ctx.root, ctx.config)
  const store = storeFor(ctx.root, ctx.config)
  const board = store.readSync()
  const archive = await store.readArchive()
  const org = await orgStoreFor(ctx.root, ctx.config).read()
  const tags = await tagStoreFor(ctx.root, ctx.config).read()
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const skills = skillReport(ctx, flags)
  const hasBoard = existsSync(paths.store)
  const hasConfig = existsSync(paths.config)
  const gitHash = shortHashFromGitDir(ctx.cwd) || shortHashFromGitDir(ctx.root)
  const info = ctx.actorInfo || { source: 'flag', gitName: '', hasPrefix: true }
  const cycle = board ? findDependencyCycle(board) : null
  const known = new Map([...(board?.tasks || []), ...(archive?.tasks || [])].map((task) => [task.id, task]))
  const cancelledDeps = board
    ? board.tasks.flatMap((task) =>
        (task.dependsOn || [])
          .filter((dep) => {
            const target = known.get(dep.id)
            return !target || target.status === 'cancelled'
          })
          .map((dep) => `${task.id}→${dep.id}`),
      )
    : []
  const tasks = board?.tasks || []
  const missingGoal = tasks.length ? Math.round((tasks.filter((task) => !task.context?.goal).length / tasks.length) * 100) : 0
  const staleCount = tasks.reduce((total, task) => total + (task.resources || []).filter((resource) => resource.status === 'superseded').length, 0)
  const draftTags = tags.tags.filter((tag) => tag.status === 'draft').length
  const pendingMigration = hasBoard && rawBoardVersion(paths.store) < 3
  const skillDrift = skills.results.some((item) => item.state !== 'linked' && item.state !== 'copy')

  const checks = [
    { name: 'package', status: 'ok', detail: `${pkg.name}@${pkg.version}` },
    { name: 'node', status: nodeMajor >= 20 ? 'ok' : 'fail', detail: process.versions.node },
    { name: 'root', status: 'ok', detail: ctx.root },
    {
      name: 'board',
      status: hasBoard ? (pendingMigration ? 'warn' : 'ok') : 'warn',
      detail: `${paths.store}${board ? `（revision ${board.revision}，${board.tasks.length} 条）` : '（未初始化，运行 ptodo init）'}${pendingMigration ? '（v2，首次写入将自动备份并升级 v3）' : ''}`,
    },
    { name: 'org', status: existsSync(paths.milestones) ? 'ok' : 'warn', detail: `${paths.milestones}（M ${org.milestones.length} / S ${org.stages.length}）` },
    { name: 'tags', status: existsSync(paths.tags) ? 'ok' : 'warn', detail: `${paths.tags}（${tags.tags.length} 个，draft ${draftTags}）` },
    { name: 'archive', status: 'ok', detail: `${paths.archive}${existsSync(paths.archive) ? '' : '（尚未归档，首次归档时创建）'}` },
    { name: 'history', status: existsSync(paths.history) ? 'ok' : 'warn', detail: paths.history },
    { name: 'snapshot', status: existsSync(paths.markdown) ? 'ok' : 'warn', detail: paths.markdown },
    { name: 'config', status: hasConfig ? 'ok' : 'ok', detail: `${paths.config}${hasConfig ? '' : '（使用默认值）'}` },
    { name: 'git', status: gitHash ? 'ok' : 'warn', detail: gitHash ? `HEAD ${gitHash}` : '当前目录无 git，完成时需 --version' },
    versionDocCheck(ctx.root, ctx.config, board, archive),
    {
      name: 'actor',
      status: info.hasPrefix || !hasGitUser(ctx.cwd) ? 'ok' : 'warn',
      detail: `${ctx.actor}（${info.source}${info.gitName ? `，git=${info.gitName}` : ''}）${actorHint(info) ? ` — ${actorHint(info)}` : ''}`,
    },
    {
      name: 'deps',
      status: cycle ? 'fail' : cancelledDeps.length ? 'warn' : 'ok',
      detail: cycle
        ? `成环：${cycle.join(' → ')}`
        : cancelledDeps.length
          ? `指向取消/缺失任务的依赖：${cancelledDeps.join('、')}`
          : '无任务依赖成环',
    },
    { name: 'context', status: missingGoal > 50 ? 'warn' : 'ok', detail: `目标缺失率 ${missingGoal}%` },
    { name: 'resources', status: staleCount ? 'warn' : 'ok', detail: `过期资料引用 ${staleCount} 条` },
    {
      name: 'skills',
      status: skillDrift ? 'warn' : 'ok',
      detail: skills.results.map((item) => `${item.name}:${item.state}`).join(' '),
    },
  ]

  if (bool(flags.json)) {
    writeJson({ ok: true, action: 'doctor', checks, paths, skills, actor: info })
    return
  }
  const symbol = { ok: '✅', warn: '⚠', fail: '❌' }
  write(
    [
      `ptodo ${pkg.version} · ${paths.root}`,
      ...checks.map((check) => `${symbol[check.status] || '·'} ${check.name.padEnd(8)} ${check.detail}`),
    ].join('\n'),
  )
}
