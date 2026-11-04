/**
 * Three-layer organisation: milestones and stages.
 *
 * Both live in one file (`docs/ptodo/milestones.json`). The `default` milestone
 * and `default` stage are the inbox: they are synthesised on read when the file
 * is missing, written by `ptodo init`, and can never be deleted.
 *
 * Milestone/stage dependencies are organisational only: they drive
 * `effectiveStatus=blocked_by_upstream` on the org nodes, never task readiness.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  MILESTONE_CODE_RE,
  MILESTONE_STATUSES,
  MILESTONE_VERSION,
  STAGE_CODE_RE,
  STAGE_STATUSES,
  fail,
  nowIso,
} from './model.js'
import { acquireLock, writeAtomic } from './fs-store.js'
import { appendHistory, historyFileOf } from './history.js'

export const DEFAULT_MILESTONE = 'default'
export const DEFAULT_STAGE = 'default'
const PAD = (number) => String(number).padStart(4, '0')

function defaultMilestone() {
  return {
    code: DEFAULT_MILESTONE,
    name: '默认',
    description: '',
    status: 'active',
    order: 0,
    dependsOnMilestone: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    revision: 0,
  }
}

function defaultStage() {
  return {
    code: DEFAULT_STAGE,
    milestoneCode: DEFAULT_MILESTONE,
    name: '未分类',
    description: '',
    status: 'active',
    order: 0,
    dependsOnStage: [],
    dependsOnMilestone: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    revision: 0,
  }
}

export function emptyOrg() {
  return {
    version: MILESTONE_VERSION,
    revision: 0,
    updatedAt: nowIso(),
    nextMilestoneId: 1,
    nextStageId: 1,
    milestones: [defaultMilestone()],
    stages: [defaultStage()],
  }
}

function normalizeDep(entry, regex) {
  if (!entry || typeof entry !== 'object') return null
  const code = String(entry.code || '')
  if (!regex.test(code)) return null
  return { code, note: typeof entry.note === 'string' ? entry.note : '' }
}

function normalizeMilestone(entry) {
  if (!entry || typeof entry !== 'object') return null
  const code = String(entry.code || '')
  if (!MILESTONE_CODE_RE.test(code)) return null
  return {
    code,
    name: String(entry.name == null ? '' : entry.name).trim() || code,
    description: typeof entry.description === 'string' ? entry.description : '',
    status: MILESTONE_STATUSES.includes(entry.status) ? entry.status : 'active',
    order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 0,
    dependsOnMilestone: Array.isArray(entry.dependsOnMilestone)
      ? entry.dependsOnMilestone.map((dep) => normalizeDep(dep, MILESTONE_CODE_RE)).filter(Boolean)
      : [],
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : nowIso(),
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : nowIso(),
    revision: Number.isInteger(entry.revision) && entry.revision >= 0 ? entry.revision : 0,
  }
}

function normalizeStage(entry) {
  if (!entry || typeof entry !== 'object') return null
  const code = String(entry.code || '')
  if (!STAGE_CODE_RE.test(code)) return null
  return {
    code,
    milestoneCode: String(entry.milestoneCode || DEFAULT_MILESTONE),
    name: String(entry.name == null ? '' : entry.name).trim() || code,
    description: typeof entry.description === 'string' ? entry.description : '',
    status: STAGE_STATUSES.includes(entry.status) ? entry.status : 'pending',
    order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 0,
    dependsOnStage: Array.isArray(entry.dependsOnStage)
      ? entry.dependsOnStage.map((dep) => normalizeDep(dep, STAGE_CODE_RE)).filter(Boolean)
      : [],
    dependsOnMilestone: Array.isArray(entry.dependsOnMilestone)
      ? entry.dependsOnMilestone.map((dep) => normalizeDep(dep, MILESTONE_CODE_RE)).filter(Boolean)
      : [],
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : nowIso(),
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : nowIso(),
    revision: Number.isInteger(entry.revision) && entry.revision >= 0 ? entry.revision : 0,
  }
}

/** Fill defaults, migrate old shapes and guarantee the default inbox exists. */
export function normalizeOrg(org) {
  if (!org || typeof org !== 'object') return emptyOrg()
  const milestones = (Array.isArray(org.milestones) ? org.milestones : []).map(normalizeMilestone).filter(Boolean)
  const stages = (Array.isArray(org.stages) ? org.stages : []).map(normalizeStage).filter(Boolean)
  let milestone = milestones.find((entry) => entry.code === DEFAULT_MILESTONE)
  if (!milestone) {
    milestone = defaultMilestone()
    milestones.unshift(milestone)
  }
  let stage = stages.find((entry) => entry.code === DEFAULT_STAGE)
  if (!stage) {
    stage = defaultStage()
    stages.unshift(stage)
  }
  stage.milestoneCode = DEFAULT_MILESTONE
  stage.status = 'active'
  let nextMilestoneId = 1
  let nextStageId = 1
  for (const entry of milestones) {
    if (entry.code !== DEFAULT_MILESTONE) {
      nextMilestoneId = Math.max(nextMilestoneId, Number(entry.code.slice(2)) + 1)
    }
  }
  for (const entry of stages) {
    if (entry.code !== DEFAULT_STAGE) {
      nextStageId = Math.max(nextStageId, Number(entry.code.slice(2)) + 1)
    }
  }
  const rawMilestoneNext = Number(org.nextMilestoneId)
  const rawStageNext = Number(org.nextStageId)
  if (Number.isInteger(rawMilestoneNext) && rawMilestoneNext > nextMilestoneId) nextMilestoneId = rawMilestoneNext
  if (Number.isInteger(rawStageNext) && rawStageNext > nextStageId) nextStageId = rawStageNext
  return {
    version: MILESTONE_VERSION,
    revision: Number.isInteger(org.revision) && org.revision >= 0 ? org.revision : 0,
    updatedAt: typeof org.updatedAt === 'string' ? org.updatedAt : nowIso(),
    nextMilestoneId,
    nextStageId,
    milestones,
    stages,
  }
}

/** Throws DEPENDENCY_CYCLE when a kind-local graph contains a cycle. */
function detectCycle(codes, edgesOf) {
  const state = new Map()
  const stack = []
  const visit = (code) => {
    if (state.get(code) === 1) {
      const at = stack.indexOf(code)
      return [...stack.slice(at), code]
    }
    if (state.get(code) === 2) return null
    state.set(code, 1)
    stack.push(code)
    for (const next of edgesOf(code)) {
      if (!codes.has(next)) continue
      const hit = visit(next)
      if (hit) return hit
    }
    stack.pop()
    state.set(code, 2)
    return null
  }
  for (const code of codes) {
    const hit = visit(code)
    if (hit) return hit
  }
  return null
}

/** Validate a whole org file; throws TodoError. */
export function validateOrg(org) {
  if (!org || typeof org !== 'object') fail('PARSE_ERROR', '里程碑文件不是对象')
  if (org.version !== MILESTONE_VERSION) {
    fail('PARSE_ERROR', `不支持的里程碑文件版本 ${String(org.version)}（期望 ${MILESTONE_VERSION}）`)
  }
  const milestones = new Map()
  for (const entry of org.milestones) {
    if (milestones.has(entry.code)) fail('INVALID', `里程碑编码重复：${entry.code}`)
    milestones.set(entry.code, entry)
  }
  const stages = new Map()
  for (const entry of org.stages) {
    if (stages.has(entry.code)) fail('INVALID', `阶段编码重复：${entry.code}`)
    stages.set(entry.code, entry)
    if (!milestones.has(entry.milestoneCode)) {
      fail('INVALID', `阶段 ${entry.code} 指向不存在的里程碑：${entry.milestoneCode}`)
    }
  }
  if (!milestones.has(DEFAULT_MILESTONE)) fail('INVALID', '缺少默认里程碑 default')
  if (!stages.has(DEFAULT_STAGE)) fail('INVALID', '缺少默认阶段 default')
  if (stages.get(DEFAULT_STAGE).milestoneCode !== DEFAULT_MILESTONE) {
    fail('INVALID', '默认阶段必须挂在默认里程碑下')
  }
  for (const entry of org.milestones) {
    for (const dep of entry.dependsOnMilestone) {
      if (dep.code === entry.code) fail('INVALID', `里程碑 ${entry.code} 不能依赖自己`)
      if (!milestones.has(dep.code)) fail('INVALID', `里程碑 ${entry.code} 的前置不存在：${dep.code}`)
    }
  }
  for (const entry of org.stages) {
    for (const dep of entry.dependsOnStage) {
      if (dep.code === entry.code) fail('INVALID', `阶段 ${entry.code} 不能依赖自己`)
      if (!stages.has(dep.code)) fail('INVALID', `阶段 ${entry.code} 的前置不存在：${dep.code}`)
    }
    for (const dep of entry.dependsOnMilestone) {
      if (!milestones.has(dep.code)) fail('INVALID', `阶段 ${entry.code} 的前置里程碑不存在：${dep.code}`)
    }
  }
  const milestoneCycle = detectCycle(new Set(milestones.keys()), (code) =>
    (milestones.get(code)?.dependsOnMilestone || []).map((dep) => dep.code),
  )
  if (milestoneCycle) fail('DEPENDENCY_CYCLE', `里程碑依赖成环：${milestoneCycle.join(' → ')}`)
  const stageCycle = detectCycle(new Set(stages.keys()), (code) =>
    (stages.get(code)?.dependsOnStage || []).map((dep) => dep.code),
  )
  if (stageCycle) fail('DEPENDENCY_CYCLE', `阶段依赖成环：${stageCycle.join(' → ')}`)
  if (!Number.isInteger(org.nextMilestoneId) || org.nextMilestoneId < 1) fail('PARSE_ERROR', 'nextMilestoneId 非法')
  if (!Number.isInteger(org.nextStageId) || org.nextStageId < 1) fail('PARSE_ERROR', 'nextStageId 非法')
  return org
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export class MilestoneStore {
  constructor(root, config) {
    this.root = root
    this.config = config || {}
    this.file = path.join(root, this.config.milestones?.path || 'docs/ptodo/milestones.json')
    this.historyFile = historyFileOf(root, this.config)
    this.lockFile = `${this.file}.lock`
    this.queue = Promise.resolve()
  }

  async read() {
    if (!existsSync(this.file)) return validateOrg(emptyOrg())
    let text
    try {
      text = readFileSync(this.file, 'utf8')
    } catch (error) {
      fail('IO_ERROR', `读取里程碑失败：${error.message}`)
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      fail('PARSE_ERROR', `里程碑文件不是合法 JSON：${error.message}`)
    }
    return validateOrg(normalizeOrg(parsed))
  }

  readSync() {
    try {
      if (!existsSync(this.file)) return emptyOrg()
      return validateOrg(normalizeOrg(JSON.parse(readFileSync(this.file, 'utf8'))))
    } catch {
      return null
    }
  }

  enqueue(operation) {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async mutate(action, by, mutator) {
    return this.enqueue(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const release = await acquireLock(this.lockFile)
      try {
        const raw = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : emptyOrg()
        const org = normalizeOrg(raw)
        const before = clone(org)
        const result = (await mutator(org)) || {}
        org.revision += 1
        org.updatedAt = nowIso()
        validateOrg(org)
        await writeAtomic(this.file, `${JSON.stringify(org, null, 2)}\n`)
        await appendHistory(this.historyFile, {
          at: nowIso(),
          revision: org.revision,
          action,
          by: by || 'system',
          entity: 'org',
          taskIds: [],
          changes: summarizeOrgChanges(before, org),
        }).catch(() => {})
        return { org, result }
      } finally {
        await release()
      }
    })
  }

  /* ----------------------------------------------------------- milestones */

  async createMilestone(input, by) {
    return this.mutate('milestone_create', by, (org) => {
      const name = String(input.name || '').trim()
      if (!name) fail('INVALID', '里程碑名称不能为空')
      const code = `M-${PAD(org.nextMilestoneId)}`
      org.nextMilestoneId += 1
      const milestone = {
        code,
        name,
        description: typeof input.description === 'string' ? input.description : '',
        status: MILESTONE_STATUSES.includes(input.status) ? input.status : 'active',
        order: Math.max(-1, ...org.milestones.map((entry) => entry.order)) + 1,
        dependsOnMilestone: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
        revision: 0,
      }
      org.milestones.push(milestone)
      const stages = []
      const names = Array.isArray(input.stages) ? input.stages.map((value) => String(value).trim()).filter(Boolean) : []
      if (!names.length) names.push('未分类')
      names.forEach((stageName, index) => {
        const stage = {
          code: `S-${PAD(org.nextStageId)}`,
          milestoneCode: code,
          name: stageName,
          description: '',
          status: index === 0 ? 'active' : 'pending',
          order: index,
          dependsOnStage: [],
          dependsOnMilestone: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
          revision: 0,
        }
        org.nextStageId += 1
        org.stages.push(stage)
        stages.push(stage)
      })
      return { changed: [code, ...stages.map((stage) => stage.code)], milestone, stages }
    })
  }

  async updateMilestone(code, patch, by) {
    return this.mutate('milestone_update', by, (org) => {
      const milestone = org.milestones.find((entry) => entry.code === code)
      if (!milestone) fail('NOT_FOUND', `没有里程碑 ${code}`)
      if (patch.name !== undefined) {
        const name = String(patch.name).trim()
        if (!name) fail('INVALID', '里程碑名称不能为空')
        milestone.name = name
      }
      if (patch.description !== undefined) milestone.description = String(patch.description)
      if (patch.status !== undefined) {
        if (!MILESTONE_STATUSES.includes(patch.status)) fail('INVALID', `里程碑状态非法：${patch.status}`)
        milestone.status = patch.status
      }
      if (patch.order !== undefined) milestone.order = Number(patch.order) || 0
      milestone.updatedAt = nowIso()
      milestone.revision += 1
      return { changed: [code], milestone }
    })
  }

  async deleteMilestone(code, options = {}, by) {
    return this.mutate('milestone_delete', by, (org) => {
      if (code === DEFAULT_MILESTONE) fail('INVALID', '默认里程碑不能删除')
      const milestone = org.milestones.find((entry) => entry.code === code)
      if (!milestone) fail('NOT_FOUND', `没有里程碑 ${code}`)
      const stages = org.stages.filter((entry) => entry.milestoneCode === code)
      if (stages.length && !options.force) {
        fail('CONFLICT', `里程碑 ${code} 还有 ${stages.length} 个阶段；使用 --force 迁移到默认里程碑`)
      }
      for (const stage of stages) {
        stage.milestoneCode = DEFAULT_MILESTONE
        stage.updatedAt = nowIso()
        stage.revision += 1
      }
      org.milestones = org.milestones.filter((entry) => entry.code !== code)
      for (const entry of org.milestones) {
        entry.dependsOnMilestone = entry.dependsOnMilestone.filter((dep) => dep.code !== code)
      }
      for (const stage of org.stages) {
        stage.dependsOnMilestone = stage.dependsOnMilestone.filter((dep) => dep.code !== code)
      }
      return { changed: [code], movedStages: stages.map((stage) => stage.code) }
    })
  }

  async addMilestoneDep(code, on, note, by) {
    return this.mutate('milestone_dep_add', by, (org) => {
      const milestone = org.milestones.find((entry) => entry.code === code)
      const target = org.milestones.find((entry) => entry.code === on)
      if (!milestone) fail('NOT_FOUND', `没有里程碑 ${code}`)
      if (!target) fail('NOT_FOUND', `没有里程碑 ${on}`)
      if (code === on) fail('INVALID', '里程碑不能依赖自己')
      if (milestone.dependsOnMilestone.some((dep) => dep.code === on)) {
        fail('CONFLICT', `里程碑 ${code} 已依赖 ${on}`)
      }
      milestone.dependsOnMilestone.push({ code: on, note: note ? String(note) : '' })
      milestone.updatedAt = nowIso()
      milestone.revision += 1
      validateOrg(org)
      return { changed: [code] }
    })
  }

  async removeMilestoneDep(code, on, by) {
    return this.mutate('milestone_dep_remove', by, (org) => {
      const milestone = org.milestones.find((entry) => entry.code === code)
      if (!milestone) fail('NOT_FOUND', `没有里程碑 ${code}`)
      const before = milestone.dependsOnMilestone.length
      milestone.dependsOnMilestone = milestone.dependsOnMilestone.filter((dep) => dep.code !== on)
      if (milestone.dependsOnMilestone.length === before) fail('NOT_FOUND', `里程碑 ${code} 没有依赖 ${on}`)
      milestone.updatedAt = nowIso()
      milestone.revision += 1
      return { changed: [code] }
    })
  }

  /* --------------------------------------------------------------- stages */

  async createStage(input, by) {
    return this.mutate('stage_create', by, (org) => {
      const milestoneCode = String(input.milestoneCode || DEFAULT_MILESTONE)
      if (!org.milestones.some((entry) => entry.code === milestoneCode)) {
        fail('NOT_FOUND', `没有里程碑 ${milestoneCode}`)
      }
      const name = String(input.name || '').trim()
      if (!name) fail('INVALID', '阶段名称不能为空')
      const peers = org.stages.filter((entry) => entry.milestoneCode === milestoneCode)
      const code = `S-${PAD(org.nextStageId)}`
      org.nextStageId += 1
      const stage = {
        code,
        milestoneCode,
        name,
        description: typeof input.description === 'string' ? input.description : '',
        status: STAGE_STATUSES.includes(input.status) ? input.status : peers.length ? 'pending' : 'active',
        order: Math.max(-1, ...peers.map((entry) => entry.order)) + 1,
        dependsOnStage: [],
        dependsOnMilestone: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
        revision: 0,
      }
      org.stages.push(stage)
      return { changed: [code], stage }
    })
  }

  async updateStage(code, patch, by) {
    return this.mutate('stage_update', by, (org) => {
      const stage = org.stages.find((entry) => entry.code === code)
      if (!stage) fail('NOT_FOUND', `没有阶段 ${code}`)
      if (patch.name !== undefined) {
        const name = String(patch.name).trim()
        if (!name) fail('INVALID', '阶段名称不能为空')
        stage.name = name
      }
      if (patch.description !== undefined) stage.description = String(patch.description)
      if (patch.status !== undefined) {
        if (!STAGE_STATUSES.includes(patch.status)) fail('INVALID', `阶段状态非法：${patch.status}`)
        if (code === DEFAULT_STAGE && patch.status !== 'active') fail('INVALID', '默认阶段必须保持 active')
        stage.status = patch.status
      }
      if (patch.milestoneCode !== undefined && patch.milestoneCode !== stage.milestoneCode) {
        if (code === DEFAULT_STAGE) fail('INVALID', '默认阶段不能移动')
        if (!org.milestones.some((entry) => entry.code === patch.milestoneCode)) {
          fail('NOT_FOUND', `没有里程碑 ${patch.milestoneCode}`)
        }
        stage.milestoneCode = String(patch.milestoneCode)
      }
      if (patch.order !== undefined) stage.order = Number(patch.order) || 0
      stage.updatedAt = nowIso()
      stage.revision += 1
      return { changed: [code], stage }
    })
  }

  async reorderStage(code, order, by) {
    return this.mutate('stage_reorder', by, (org) => {
      const stage = org.stages.find((entry) => entry.code === code)
      if (!stage) fail('NOT_FOUND', `没有阶段 ${code}`)
      const peers = org.stages
        .filter((entry) => entry.milestoneCode === stage.milestoneCode)
        .sort((left, right) => left.order - right.order || left.code.localeCompare(right.code))
      const index = peers.indexOf(stage)
      const target = Math.max(0, Math.min(peers.length - 1, Number(order) || 0))
      peers.splice(index, 1)
      peers.splice(target, 0, stage)
      peers.forEach((entry, at) => {
        if (entry.order !== at) {
          entry.order = at
          entry.updatedAt = nowIso()
          entry.revision += 1
        }
      })
      return { changed: [code] }
    })
  }

  async deleteStage(code, options = {}, by) {
    return this.mutate('stage_delete', by, (org) => {
      if (code === DEFAULT_STAGE) fail('INVALID', '默认阶段不能删除')
      const stage = org.stages.find((entry) => entry.code === code)
      if (!stage) fail('NOT_FOUND', `没有阶段 ${code}`)
      const children = org.stages.filter((entry) => entry.dependsOnStage.some((dep) => dep.code === code))
      if (children.length && !options.force) {
        fail('CONFLICT', `阶段 ${code} 被 ${children.map((entry) => entry.code).join('、')} 依赖；使用 --force 删除前置`)
      }
      org.stages = org.stages.filter((entry) => entry.code !== code)
      for (const entry of org.stages) {
        entry.dependsOnStage = entry.dependsOnStage.filter((dep) => dep.code !== code)
      }
      return { changed: [code] }
    })
  }

  async addStageDep(code, target, type, note, by) {
    return this.mutate('stage_dep_add', by, (org) => {
      const stage = org.stages.find((entry) => entry.code === code)
      if (!stage) fail('NOT_FOUND', `没有阶段 ${code}`)
      if (type === 'milestone') {
        if (!org.milestones.some((entry) => entry.code === target)) fail('NOT_FOUND', `没有里程碑 ${target}`)
        if (stage.dependsOnMilestone.some((dep) => dep.code === target)) fail('CONFLICT', `阶段 ${code} 已依赖里程碑 ${target}`)
        stage.dependsOnMilestone.push({ code: target, note: note ? String(note) : '' })
      } else {
        if (!org.stages.some((entry) => entry.code === target)) fail('NOT_FOUND', `没有阶段 ${target}`)
        if (code === target) fail('INVALID', '阶段不能依赖自己')
        if (stage.dependsOnStage.some((dep) => dep.code === target)) fail('CONFLICT', `阶段 ${code} 已依赖 ${target}`)
        stage.dependsOnStage.push({ code: target, note: note ? String(note) : '' })
      }
      stage.updatedAt = nowIso()
      stage.revision += 1
      validateOrg(org)
      return { changed: [code] }
    })
  }

  async removeStageDep(code, target, type, by) {
    return this.mutate('stage_dep_remove', by, (org) => {
      const stage = org.stages.find((entry) => entry.code === code)
      if (!stage) fail('NOT_FOUND', `没有阶段 ${code}`)
      const field = type === 'milestone' ? 'dependsOnMilestone' : 'dependsOnStage'
      const before = stage[field].length
      stage[field] = stage[field].filter((dep) => dep.code !== target)
      if (stage[field].length === before) fail('NOT_FOUND', `阶段 ${code} 没有依赖 ${target}`)
      stage.updatedAt = nowIso()
      stage.revision += 1
      return { changed: [code] }
    })
  }
}

function summarizeOrgChanges(before, after) {
  const changes = []
  const beforeMilestones = new Map(before.milestones.map((entry) => [entry.code, entry]))
  const afterMilestones = new Map(after.milestones.map((entry) => [entry.code, entry]))
  for (const [code, entry] of afterMilestones) {
    const previous = beforeMilestones.get(code)
    if (!previous) changes.push({ entity: 'milestone', code, action: 'created' })
    else if (JSON.stringify(previous) !== JSON.stringify(entry)) changes.push({ entity: 'milestone', code, action: 'updated' })
  }
  for (const [code] of beforeMilestones) {
    if (!afterMilestones.has(code)) changes.push({ entity: 'milestone', code, action: 'deleted' })
  }
  const beforeStages = new Map(before.stages.map((entry) => [entry.code, entry]))
  const afterStages = new Map(after.stages.map((entry) => [entry.code, entry]))
  for (const [code, entry] of afterStages) {
    const previous = beforeStages.get(code)
    if (!previous) changes.push({ entity: 'stage', code, action: 'created' })
    else if (JSON.stringify(previous) !== JSON.stringify(entry)) changes.push({ entity: 'stage', code, action: 'updated' })
  }
  for (const [code] of beforeStages) {
    if (!afterStages.has(code)) changes.push({ entity: 'stage', code, action: 'deleted' })
  }
  return changes
}

const orgStores = new Map()
export function orgStoreFor(root, config) {
  const key = `${path.resolve(root)}|${JSON.stringify(config || {})}`
  let store = orgStores.get(key)
  if (!store) {
    store = new MilestoneStore(path.resolve(root), config)
    orgStores.set(key, store)
  }
  return store
}

/** Write the default org file during `ptodo init`. */
export async function initOrg(root, config) {
  const store = orgStoreFor(root, config)
  const org = emptyOrg()
  validateOrg(org)
  await writeAtomic(store.file, `${JSON.stringify(org, null, 2)}\n`)
  return org
}
