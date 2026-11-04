/**
 * Computed briefings for the two abstract views:
 *   - start:  what this task is, what came before, what changed, what to do next
 *   - release/handoff: where the work stopped and what is still open
 *
 * The agent should never have to stitch these from `get` + `dep list` +
 * `res list`; the CLI does the joining here.
 */
import { decorateTask, evaluatePreconditions, buildContext, orgOfTask } from './derive.js'

function upstreamOf(task, ctx) {
  return (task.dependsOn || [])
    .map((dep) => {
      const upstream = ctx.tasks.get(dep.id)
      return upstream ? { dep, task: upstream } : null
    })
    .filter(Boolean)
}

export function buildStartBrief(state, task) {
  const ctx = buildContext(state)
  const decorated = decorateTask(task, ctx)
  const { stage, milestone } = orgOfTask(task, ctx)
  const upstream = upstreamOf(task, ctx)
  const doneUpstream = upstream
    .filter((entry) => entry.task.status === 'done')
    .map((entry) => ({
      id: entry.task.id,
      title: entry.task.title,
      type: entry.dep.type,
      version: entry.task.doneVersion || null,
      evidence: entry.task.doneEvidence || null,
      handoff: entry.task.context?.progress || null,
    }))
  const pendingUpstream = upstream
    .filter((entry) => entry.task.status !== 'done')
    .map((entry) => ({ id: entry.task.id, title: entry.task.title, status: entry.task.status, type: entry.dep.type }))
  const changes = []
  for (const resource of decorated.staleResources || []) {
    changes.push(`资料 ${resource.id}《${resource.title}》已被 ${resource.supersededBy || '新资料'} 替换，请复核`)
  }
  for (const entry of upstream) {
    if (entry.task.updatedAt && entry.task.updatedAt > (task.createdAt || '')) {
      changes.push(`上游 ${entry.task.id}《${entry.task.title}》在你创建本任务后有更新（${entry.task.updatedAt}）`)
    }
  }
  const resources = { draft: [], approved: [], superseded: [] }
  for (const resource of task.resources || []) {
    const bucket = resources[resource.status] || resources.draft
    bucket.push({ id: resource.id, title: resource.title, type: resource.type, url: resource.url })
  }
  const preconditions = evaluatePreconditions(task, { ...ctx, task })
  const unmet = preconditions.filter((pre) => pre.required !== false && !pre.satisfied)
  let nextStep
  if (unmet.length) {
    nextStep = `先满足前置条件：${unmet.map((pre) => pre.id).join('、')}`
  } else if ((task.context?.openLoops || []).length) {
    nextStep = `先处理未关闭事项：${task.context.openLoops[0].text}`
  } else if (task.context?.goal) {
    nextStep = `按目标推进：${task.context.goal}`
  } else if (doneUpstream.length) {
    nextStep = `参考上游 ${doneUpstream.map((entry) => entry.id).join('、')} 的完成证据继续`
  } else {
    nextStep = '补充 context.goal 后再开始，便于下一位接手'
  }
  return {
    task: {
      id: task.id,
      title: task.title,
      priority: task.priority,
      urgency: task.urgency,
      status: task.status,
      effectiveStatus: decorated.effectiveStatus,
    },
    stage: stage ? { code: stage.code, name: stage.name } : null,
    milestone: milestone ? { code: milestone.code, name: milestone.name } : null,
    goal: task.context?.goal || null,
    progress: task.context?.progress || null,
    decisions: (task.context?.decisions || []).slice(-3),
    upstreamDone: doneUpstream,
    upstreamPending: pendingUpstream,
    changes,
    resources,
    openLoops: task.context?.openLoops || [],
    preconditions,
    blocking: decorated.blocking,
    nextStep,
  }
}

/** Handoff text written on release and shown to the next holder. */
export function buildHandoff(task, note) {
  return {
    id: task.id,
    title: task.title,
    progress: task.context?.progress || null,
    openLoops: task.context?.openLoops || [],
    note: note || null,
    nextStep: task.context?.progress ? `从「${task.context.progress}」继续` : '先执行 task start 查看开工简报',
  }
}
