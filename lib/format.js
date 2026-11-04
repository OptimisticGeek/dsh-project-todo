/**
 * Text projections shared by the CLI and the per-step agent context.
 */
import { STATUS_LABELS, URGENCY_LABELS, counts, progressOf, rootTasks, sortTasks } from './model.js'

function urgencyLabel(task) {
  return URGENCY_LABELS[task.urgency] || String(task.urgency)
}

function lineOfTask(board, task, indent) {
  const pad = '  '.repeat(indent)
  const progress = board.tasks.some((candidate) => candidate.parentId === task.id)
    ? ` (${progressOf(board, task).done}/${progressOf(board, task).total})`
    : ''
  const holder = task.holder ? ` — ${task.holder}` : ''
  const note = task.notes ? ` · ${task.notes}` : ''
  const tags = task.tags && task.tags.length ? ` #${task.tags.join(' #')}` : ''
  const version = task.status === 'done' && task.doneVersion ? ` · 版本 ${task.doneVersion}` : ''
  const stage = task.stageCode && task.stageCode !== 'default' ? ` [${task.stageCode}]` : ''
  return `${pad}${task.id} [${task.priority}/紧急 ${urgencyLabel(task)}]${stage} ${task.title} — ${STATUS_LABELS[task.status]}${progress}${tags}${holder}${note}${version}`
}

function renderTree(board, task, indent, out) {
  out.push(lineOfTask(board, task, indent))
  for (const child of sortTasks(board.tasks.filter((candidate) => candidate.parentId === task.id))) {
    renderTree(board, child, indent + 1, out)
  }
}

/** Full board text for `ptodo list` / `ptodo task list`. */
export function formatBoardText(board, options = {}) {
  const summary = counts(board)
  const out = []
  out.push(`项目待办（${board.project}，revision ${board.revision}）`)
  out.push(
    `进行中 ${summary.doing} · 未开始 ${summary.open} · 阻塞 ${summary.blocked} · 已完成 ${summary.done} · 已取消 ${summary.cancelled}`,
  )
  const roots = rootTasks(board.tasks)
  if (!roots.length) {
    out.push('', '（暂无任务；用 ptodo task create 新建）')
    return out.join('\n')
  }
  out.push('')
  if (options.grouped && options.milestones && options.stages) {
    const stagesByMilestone = new Map()
    for (const stage of options.stages) {
      if (!stagesByMilestone.has(stage.milestoneCode)) stagesByMilestone.set(stage.milestoneCode, [])
      stagesByMilestone.get(stage.milestoneCode).push(stage)
    }
    const ordered = [...options.milestones].sort((left, right) => left.order - right.order || left.code.localeCompare(right.code))
    for (const milestone of ordered) {
      out.push(`## ${milestone.code} ${milestone.name}${milestone.effectiveStatus ? `（${milestone.effectiveStatus}）` : ''}`)
      const stages = (stagesByMilestone.get(milestone.code) || []).sort(
        (left, right) => left.order - right.order || left.code.localeCompare(right.code),
      )
      for (const stage of stages) {
        const tasks = roots.filter((task) => task.stageCode === stage.code)
        if (!tasks.length && stage.code !== 'default') continue
        const progress = stage.progress ? `${stage.progress.done}/${stage.progress.total}` : ''
        out.push(`### ${stage.code} ${stage.name}${progress ? ` (${progress})` : ''}${stage.effectiveStatus === 'blocked_by_upstream' ? ' ⚠' : ''}`)
        if (!tasks.length) out.push('  （暂无任务）')
        for (const task of tasks) renderTree(board, task, 1, out)
      }
      out.push('')
    }
    return out.join('\n').trimEnd()
  }
  for (const root of roots) renderTree(board, root, 0, out)
  return out.join('\n')
}

/** One task plus parent chain, children, context and recent history. */
export function formatTaskText(board, task, history = [], extra = {}) {
  const out = []
  const parent = task.parentId ? board.tasks.find((candidate) => candidate.id === task.parentId) : null
  out.push(`${task.id} ${task.title}`)
  out.push(
    `状态 ${STATUS_LABELS[task.status]} · 优先级 ${task.priority} · 紧急度 ${urgencyLabel(task)}` +
      (extra.effectiveStatus && extra.effectiveStatus !== task.status ? ` · 有效状态 ${extra.effectiveStatus}` : ''),
  )
  if (task.stageCode) out.push(`阶段 ${task.stageCode}${extra.stageName ? ` ${extra.stageName}` : ''}`)
  if (task.tags && task.tags.length) out.push(`标签 ${task.tags.join('、')}`)
  if (parent) out.push(`父任务 ${parent.id} ${parent.title}`)
  const children = sortTasks(board.tasks.filter((candidate) => candidate.parentId === task.id))
  if (children.length) {
    const progress = progressOf(board, task)
    out.push(`子任务 ${progress.done}/${progress.total}：`)
    for (const child of children) out.push(`  ${child.id} [${STATUS_LABELS[child.status]}] ${child.title}`)
  }
  if (task.holder) out.push(`持有 ${task.holder}`)
  out.push(`任务编码 ${task.id}`)
  if (task.createdBy) out.push(`创建人 ${task.createdBy}`)
  if (task.claimedBy) out.push(`认领人 ${task.claimedBy}`)
  if (task.doneBy) out.push(`完成人 ${task.doneBy}`)
  if (task.releasedBy) out.push(`释放人 ${task.releasedBy}`)
  out.push(`认领时间 ${task.claimedAt || '—'}`)
  out.push(`状态更新 ${task.statusChangedAt || '—'}`)
  if (task.context?.goal) out.push(`目标：${task.context.goal}`)
  if (task.context?.progress) out.push(`进度：${task.context.progress}`)
  if (task.context?.decisions?.length) {
    out.push(`决策（最近 ${Math.min(3, task.context.decisions.length)} 条）：`)
    for (const entry of task.context.decisions.slice(-3)) out.push(`  - ${entry.text}（${entry.by || '—'}）`)
  }
  if (task.context?.openLoops?.length) {
    out.push('未关闭事项：')
    task.context.openLoops.forEach((entry, index) => out.push(`  ${index + 1}. ${entry.text}`))
  }
  if (task.dependsOn?.length) {
    out.push('依赖：')
    for (const dep of task.dependsOn) out.push(`  - ${dep.id}（${dep.type}）${dep.note ? ` ${dep.note}` : ''}`)
  }
  if (extra.blocking?.length) {
    out.push(`被依赖（${extra.blocking.length}）：`)
    for (const entry of extra.blocking) out.push(`  - ${entry.id}（${entry.type}）`)
  }
  if (task.preconditions?.length) {
    out.push('前置条件：')
    for (const pre of task.preconditions) {
      out.push(`  - ${pre.id} ${pre.type}${pre.required === false ? '（可选）' : ''} ${pre.satisfied ? '✅' : '⏳'}`)
    }
  }
  if (task.resources?.length) {
    out.push('资料：')
    for (const resource of task.resources) out.push(`  - ${resource.id} [${resource.status}] ${resource.title}${resource.url ? ` ${resource.url}` : ''}`)
  }
  if (task.causedBy?.length) {
    out.push('原因：')
    for (const edge of task.causedBy) out.push(`  - ${edge.type}:${edge.ref}${edge.note ? ` ${edge.note}` : ''}`)
  }
  if (task.notes) out.push(`备注：${task.notes}`)
  if (task.legacyId) out.push(`旧编号：${task.legacyId}`)
  out.push(`创建 ${task.createdAt} · 更新 ${task.updatedAt}`)
  if (task.doneAt) out.push(`完成 ${task.doneAt}${task.doneVersion ? ` · 版本 ${task.doneVersion}` : ''}${task.doneEvidence ? ` · 证据 ${task.doneEvidence}` : ''}`)
  if (extra.relatedCommits?.length) {
    out.push('相关提交：')
    for (const commit of extra.relatedCommits) out.push(`  - ${commit.hash} ${commit.subject}`)
  }
  if (history.length) {
    out.push('', '最近变更：')
    for (const entry of history) out.push(`  ${entry.at} ${entry.action}（${entry.by}）`)
  }
  return out.join('\n')
}

/** Short summary for the per-step agent context. */
export function formatAgentSummary(board, limit = 3, extra = {}) {
  const summary = counts(board)
  if (!board.tasks.length) return '本项目暂无待办（可用 ptodo task create 新建，数据存于 docs/ptodo/todos.json）。'
  const out = []
  out.push(
    `项目待办：进行中 ${summary.doing}，未开始 ${summary.open}，阻塞 ${summary.blocked}，已完成 ${summary.done}。`,
  )
  const doing = sortTasks(board.tasks.filter((task) => task.status === 'doing' && !hasChildren(board, task)))
  if (doing.length) {
    out.push(`进行中：${doing.map((task) => `${task.id} ${task.title}（${task.holder || '?'}）`).join('；')}`)
  }
  const ready = Array.isArray(extra.ready)
    ? extra.ready
    : sortTasks(board.tasks.filter((task) => task.status === 'open' && !hasChildren(board, task))).slice(0, limit)
  if (ready.length) {
    out.push(
      `建议优先：${ready
        .slice(0, limit)
        .map((task) => `${task.id} [${task.priority}/紧急${urgencyLabel(task)}] ${task.title}`)
        .join('；')}`,
    )
  }
  return out.join('\n')
}

function hasChildren(board, task) {
  return board.tasks.some((candidate) => candidate.parentId === task.id)
}

/** Text projection of `getTimeline` data. */
export function formatTimeline(data) {
  if (!data.entries.length) {
    return data.q ? `没有匹配「${data.q}」的日志（全程共 ${data.total} 条）。` : '暂无变更记录。'
  }
  const label = (status) => (status ? STATUS_LABELS[status] || status : '—')
  const header = `最近 ${data.entries.length} 条 · 匹配 ${data.matched} / 总 ${data.total} 条`
  const lines = data.entries.map((entry) => {
    const moves = entry.transitions.length
      ? entry.transitions
          .map(
            (transition) =>
              `${transition.id}${transition.title ? ' ' + transition.title : ''} ${label(transition.from)}→${label(transition.to)}${transition.version ? `（版本 ${transition.version}）` : ''}`,
          )
          .join('；')
      : '（无状态变化）'
    const changes =
      entry.changes && entry.changes.length
        ? ' · ' +
          entry.changes.map((change) => `${change.id}.${change.field}: ${change.from ?? '∅'}→${change.to ?? '∅'}`).join('；')
        : ''
    return `${entry.at} ${entry.action} ${moves}${changes}（${entry.by}）`
  })
  return [header, ...lines].join('\n')
}

/** Text projection of a start brief. */
export function formatStartBrief(brief) {
  const out = []
  out.push(`开工简报：${brief.task.id} ${brief.task.title}`)
  out.push(
    `${brief.stage ? `${brief.stage.code} ${brief.stage.name}` : '未分类'}` +
      `${brief.milestone ? ` / ${brief.milestone.code} ${brief.milestone.name}` : ''} · ${brief.task.priority} · 紧急 ${URGENCY_LABELS[brief.task.urgency] || brief.task.urgency}`,
  )
  if (brief.goal) out.push(`目标：${brief.goal}`)
  if (brief.progress) out.push(`进度：${brief.progress}`)
  if (brief.decisions.length) {
    out.push('最近决策：')
    for (const entry of brief.decisions) out.push(`  - ${entry.text}（${entry.by || '—'}）`)
  }
  if (brief.upstreamDone.length) {
    out.push('前序已完成：')
    for (const entry of brief.upstreamDone) {
      out.push(`  - ${entry.id} ${entry.title}${entry.version ? ` · 版本 ${entry.version}` : ''}${entry.evidence ? ` · 证据 ${entry.evidence}` : ''}`)
    }
  }
  if (brief.upstreamPending.length) {
    out.push('前序未完成：')
    for (const entry of brief.upstreamPending) out.push(`  - ${entry.id} ${entry.title}（${STATUS_LABELS[entry.status] || entry.status}）`)
  }
  if (brief.changes.length) {
    out.push('变更提示：')
    for (const line of brief.changes) out.push(`  ⚠ ${line}`)
  }
  const resources = [...brief.resources.draft, ...brief.resources.approved, ...brief.resources.superseded]
  if (resources.length) {
    out.push('资料：')
    for (const resource of brief.resources.approved) out.push(`  ✅ ${resource.id} ${resource.title}`)
    for (const resource of brief.resources.draft) out.push(`  ⏳ ${resource.id} ${resource.title}`)
    for (const resource of brief.resources.superseded) out.push(`  ♻ ${resource.id} ${resource.title}`)
  }
  if (brief.openLoops.length) {
    out.push('未关闭事项：')
    brief.openLoops.forEach((entry, index) => out.push(`  ${index + 1}. ${entry.text}`))
  }
  out.push(`下一步：${brief.nextStep}`)
  return out.join('\n')
}
