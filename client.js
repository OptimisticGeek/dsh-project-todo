/**
 * Browser half of `dsh-project-task`.
 *
 * v3 Web view: six fixed tabs (all/ready/doing/blocked/done/archived) whose
 * counts follow the active tag/milestone/stage/search filters, a compact
 * milestone → stage table (group headers fold, inbox last), and a read-only
 * detail surface: only title/priority/urgency/tags/notes, the legal status
 * dropdown, owner assignment and release are writable. Context, dependencies,
 * preconditions, resources, causes and commits are display-only and each
 * section hides when empty.
 *
 * React.createElement only (no JSX), no dependencies, one inline stylesheet.
 */
window.__ModuleLoader__.load({
  id: 'dsh-project-task',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const BASE = '/api/dsh-project-task'
    const TOKEN = (typeof window !== 'undefined' && window.__DSH_PROJECT_TASK_TOKEN__) || ''
    const HOLDER_KEY = 'dsh-project-task-holder'

    /** Explain a 404 from the carrier: the route is missing, not the data. */
    function hostHalfHint() {
      const zh = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')
      return zh
        ? 'Host 半边未加载：/api/dsh-project-task 路由未注册（HTTP 404）。请重启 DSH，并确认插件行在 profile 的 dsh.profile.bundles 中、ui.enabled 未被关闭。'
        : 'Host half not loaded: the /api/dsh-project-task route is not registered (HTTP 404). Restart DSH, then check the plugin row in the profile bundles and that ui.enabled is not disabled.'
    }
    const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']
    const URGENCIES = [5, 4, 3, 2, 1]
    const URGENCY_ZH = { 5: '非常紧急', 4: '紧急', 3: '普通', 2: '不紧急', 1: '可延后' }
    const URGENCY_EN = { 5: 'Critical', 4: 'Urgent', 3: 'Normal', 2: 'Low', 1: 'Later' }
    const STATUS_ZH = { open: '未开始', doing: '进行中', blocked: '阻塞', done: '已完成', cancelled: '已取消' }
    const STATUS_EN = { open: 'Not started', doing: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' }
    const ACTION_ZH = {
      create: '新建', update: '修改', claim: '认领', claim_batch: '批量认领', release: '释放',
      release_batch: '批量释放', done: '完成', block: '阻塞', unblock: '解除阻塞', reopen: '恢复',
      archive: '归档', unarchive: '取消归档', delete: '删除', purge: '彻底删除', import: '导入',
      auto_archive: '自动归档', start: '开工',
      dep_add: '加依赖', dep_remove: '去依赖', dependency_resolved: '依赖解锁',
      context_decision: '记录决策', context_progress: '更新进度', context_loop: '记录未关闭',
      context_loop_close: '关闭未关闭', res_add: '加资料', res_approve: '批准资料',
      res_supersede: '替换资料', pre_add: '加前置', pre_remove: '去前置', pre_confirm: '确认前置',
      cause_add: '记录因果', cause_remove: '移除因果',
    }
    const ACTION_EN = {
      create: 'created', update: 'updated', claim: 'claimed', claim_batch: 'claimed batch', release: 'released',
      release_batch: 'released batch', done: 'completed', block: 'blocked', unblock: 'unblocked',
      reopen: 'reopened', archive: 'archived', unarchive: 'unarchived', delete: 'deleted', purge: 'purged',
      import: 'imported', auto_archive: 'auto-archived', start: 'started',
      dep_add: 'dependency added', dep_remove: 'dependency removed', dependency_resolved: 'dependency resolved',
      context_decision: 'decision logged', context_progress: 'progress updated', context_loop: 'open loop added',
      context_loop_close: 'open loop closed', res_add: 'resource added', res_approve: 'resource approved',
      res_supersede: 'resource superseded', pre_add: 'precondition added', pre_remove: 'precondition removed',
      pre_confirm: 'precondition confirmed', cause_add: 'cause added', cause_remove: 'cause removed',
    }
    /** Legal transitions offered by the detail dropdown. Nothing deletes a task. */
    const STATUS_OPTIONS = {
      open: ['open', 'doing', 'blocked'],
      doing: ['doing', 'open', 'done', 'blocked'],
      blocked: ['blocked', 'open', 'doing'],
      done: ['done', 'open'],
      cancelled: ['cancelled', 'open'],
    }
    const TABS = ['all', 'ready', 'doing', 'blocked', 'done', 'archived']
    /** How the active list is laid out: auto falls back to flat without real hierarchy. */
    const VIEW_KEY = 'dsh-project-task-view'
    const PAGE_KEY = 'dsh-project-task-page'
    const VIEW_MODES = ['auto', 'flat', 'grouped']

    const DICT = {
      zh: {
        nav: '任务', title: '任务', loading: '读取任务 …', refresh: '刷新', check: '校验',
      skillNav: '技能', skillTitle: '把 project-task-board 技能装给 Agent 工具',
      skillBanner: '首次使用：把 project-task-board 技能链接给已检测到的 Agent 工具，它们就能按 G0–G4 用 ptask 干活。',
      skillInstallDetected: '一键安装到已检测工具', skillLater: '稍后', skillDone: '技能安装完成', skillFailed: '部分目标失败',
      skillLinked: '已链接', skillCopy: '已复制', skillMissing: '未安装', skillDrift: '内容不一致', skillForeign: '已存在其他内容',
      skillDetected: '已检测到', skillNotDetected: '未检测到',
        quickAdd: '快速新建：输入标题，回车即可', add: '添加', holder: '会话名',
        priority: '优先级', urgency: '紧急度', status: '状态', tag: '标签',
        allTags: '全部标签', search: '搜索任务…',
        tabAll: '全部', tabReady: '就绪', tabDoing: '进行中', tabBlocked: '被阻塞',
        tabDone: '已完成', tabArchived: '已归档', tabOpen: '未开始',
        claim: '开始', startAction: '开始', done: '完成', block: '阻塞', unblock: '恢复', release: '释放', reopen: '恢复',
        archive: '归档', unarchive: '取消归档', remove: '删除', detail: '详情', save: '保存', close: '关闭',
        cancel: '取消', children: '子任务', parent: '父任务', history: '最近变更', notes: '备注',
        tags: '标签', taskTitle: '任务标题', claimBatch: '批量认领', releaseMine: '释放我的',
        more: '更多', export: '导出', import: '导入', exportMd: '导出 Markdown', exportXlsx: '导出 Excel',
        exportHtml: '导出 HTML 汇报页',
        exportAll: '含归档', importHint: '支持 .md / .xlsx', needHolder: '先填写会话名（持有者）',
        ok: '完成', failed: '操作失败', empty: '本项目还没有任务，上面新建一条吧。',
        noMatch: '没有符合条件的任务。', searchEmpty: '没有匹配的任务。',
        confirmForce: '该任务由他人持有，仍要强制操作吗？', confirmDelete: '确认删除该任务？',
        unavailable: '不可用', available: '可领', limit: '上限',
        archiveAfter: '自动归档',
        archiveOff: '关闭', days: '天', moreActions: '更多操作',
        donePrefix: '完成', archivedPrefix: '归档', claimedPrefix: '认领', updatedPrefix: '更新',
        holderPrefix: '持有', progressPrefix: '子任务', exportDone: '已开始下载',
        importDone: '导入完成', importSkipped: '跳过',
        version: '版本号', versionLabel: '版本', versionMissing: '未记录版本',
        versionNeeded: '请填写完成版本号', versionFetchFailed: '自动读取版本号失败，请手动填写',
        versionMissingHint: '未检测到 git 版本，请手动填写版本号',
        versionFetching: '正在读取版本号 …', versionPlaceholder: '如 abc1234',
        versionRequiredHint: '版本号为必填项，会写入完成记录',
        doneVersionLabel: '完成版本',
        evidence: '验收证据', evidencePlaceholder: '可选：验证方式、命令或产物路径',
        doneConfirm: '确认完成',
        timelineClear: '清空日志',
        timelineClearConfirm: '确认清空操作日志？只清理日志记录，不影响任何任务。',
        timelineCleared: '已清空 {n} 条日志',
        /* v3 */
        stage: '阶段', group: '分组', milestone: '里程碑', inbox: '收件箱',
        hierarchy: '层级', graphExpand: '展开全部', graphCollapse: '收起',
        briefTitle: '开工简报',
        sectionGoal: '目标', sectionProgress: '进度', sectionDecisions: '决策',
        sectionUpstreamDone: '已完成上游', sectionUpstreamPending: '待完成上游',
        sectionChanges: '变更提醒', sectionResources: '资料', sectionOpenLoops: '未关闭事项',
        sectionNextStep: '下一步', sectionPreconditions: '前置条件', sectionBlocking: '受阻',
        sectionDependencies: '依赖', sectionContext: '任务上下文', sectionCauses: '因果',
        sectionCommits: '相关提交', noExtraInfo: '暂无上下文、依赖、前置、资料或因果记录',
        sectionRelations: '关联图谱', latest: '最新', blocked: '受阻', summary: '汇总', thisTask: '本任务', upstream: '上游', downstream: '下游', system: '系统', noRelations: '暂无父任务、子任务、依赖或前置条件',
        resDraft: '草稿', resApproved: '已批准', resSuperseded: '已替换',
        preTaskDone: '任务完成', preTagDone: '标签任务完成', preResourceApproved: '资料已批准',
        preCommitExists: '提交已存在', preManualConfirm: '人工确认',
        statusActive: '进行中', statusArchived: '已归档', statusPending: '待开始',
        statusSkipped: '已跳过', statusBlockedUpstream: '上游未完成',
        missingTask: '任务不存在', optional: '可选', archivedShort: '已归档',
        blockedReasonDependency: '依赖未完成', blockedReasonPrecondition: '前置条件未满足',
        effectiveStatus: '实际状态',
        /* table / filters */
        sort: '排序', sortPriority: '优先级', sortUpdated: '最近更新', sortCreated: '创建时间',
        allMilestones: '全部里程碑', allStages: '全部阶段', milestoneStage: '里程碑 · 阶段',
        assign: '指派', assignTitle: '指派负责人', assignPlaceholder: '负责人名称', needPerson: '请输入负责人名称',
        assignPick: '从人员列表选择', assignManual: '或手动输入',
        owner: '负责人', actorLabel: '操作人', actions: '操作', updatedTime: '更新时间',
        releaseNote: '释放说明（可选，回车跳过）',
        /* list view switch */
        view: '视图', viewAuto: '自动', viewFlat: '平铺', viewGrouped: '按里程碑',
        viewHint: '自动：存在多个里程碑或非默认阶段时才分组',
        viewAutoGrouped: '自动：当前按里程碑分组',
        viewAutoFlat: '自动：只有默认里程碑/阶段，当前平铺',
        taskUnit: '项',
        pageBoard: '任务看板', pageTree: '全局任务树', treeHint: '里程碑 → 分组 → 任务 → 子任务，快速浏览流转状态',
        treeEmpty: '暂无任务', treeToggleExpand: '展开', treeToggleCollapse: '收起', treeStatus: '状态', treeOwner: '负责人',
        treeFlow: '流转：未开始 {open} · 进行中 {doing} · 受阻 {blocked} · 完成 {done}',
        /* people + archive */
        people: '人员', peopleMine: '与我相关', peopleAll: '全部人员', peoplePick: '已选 {n} 人',
        peopleHint: '按负责人 / 创建人 / 完成人过滤；默认为我', peopleMe: '我', peopleEmpty: '暂无人员',
        archive: '归档', archiveAll: '批量归档', archiveConfirm: '确认归档当前筛选下的 {n} 条已完成任务？',
        archiveNoTarget: '没有可归档的已完成任务', archiveDone: '已归档 {n} 条',
        archiveSkipped: '，跳过 {n} 条',
        doneBy: '完成人', archivedBy: '归档人', doneAt: '完成时间',
        milestoneComplete: '里程碑「{name}」已全部完成，可在「已完成」页归档。',
      },
      en: {
        nav: 'Tasks', title: 'Tasks', loading: 'Loading tasks …', refresh: 'Refresh', check: 'Check',
      skillNav: 'Skills', skillTitle: 'Install the project-task-board skill for your agents',
      skillBanner: 'First run: link the project-task-board skill into the detected agent tools so they can run ptask with the G0–G4 protocol.',
      skillInstallDetected: 'Install into detected tools', skillLater: 'Later', skillDone: 'Skill installed', skillFailed: 'Some targets failed',
      skillLinked: 'linked', skillCopy: 'copied', skillMissing: 'not installed', skillDrift: 'drifted', skillForeign: 'occupied',
      skillDetected: 'detected', skillNotDetected: 'not detected',
        quickAdd: 'Quick add a title and press Enter', add: 'Add', holder: 'Session',
        priority: 'Priority', urgency: 'Urgency', status: 'Status', tag: 'Tag',
        allTags: 'All tags', search: 'Search tasks…',
        tabAll: 'All', tabReady: 'Ready', tabDoing: 'In progress', tabBlocked: 'Blocked',
        tabDone: 'Done', tabArchived: 'Archived', tabOpen: 'Not started',
        claim: 'Start', startAction: 'Start', done: 'Done', block: 'Block', unblock: 'Unblock', release: 'Release', reopen: 'Reopen',
        archive: 'Archive', unarchive: 'Unarchive', remove: 'Delete', detail: 'Details', save: 'Save', close: 'Close',
        cancel: 'Cancel', children: 'Children', parent: 'Parent', history: 'Recent changes', notes: 'Notes',
        tags: 'Tags', taskTitle: 'Task title', claimBatch: 'Claim batch', releaseMine: 'Release mine',
        more: 'More', export: 'Export', import: 'Import', exportMd: 'Export Markdown', exportXlsx: 'Export Excel',
        exportHtml: 'Export HTML report',
        exportAll: 'with archive', importHint: 'Supports .md / .xlsx', needHolder: 'Enter a session name first',
        ok: 'Done', failed: 'Action failed', empty: 'No tasks in this project yet.',
        noMatch: 'No task matches this filter.', searchEmpty: 'No matching task.',
        confirmForce: 'Another session holds this task. Force it?', confirmDelete: 'Delete this task?',
        unavailable: 'unavailable', available: 'available', limit: 'limit',
        archiveAfter: 'Auto archive',
        archiveOff: 'off', days: 'd', moreActions: 'More actions',
        donePrefix: 'Done', archivedPrefix: 'Archived', claimedPrefix: 'Claimed', updatedPrefix: 'Updated',
        holderPrefix: 'Holder', progressPrefix: 'Subtasks', exportDone: 'Download started',
        importDone: 'Imported', importSkipped: 'skipped',
        version: 'Version', versionLabel: 'Version', versionMissing: 'No version recorded',
        versionNeeded: 'Enter the completion version', versionFetchFailed: 'Could not read the version automatically; enter it manually',
        versionMissingHint: 'No git version detected; enter one manually',
        versionFetching: 'Reading version …', versionPlaceholder: 'e.g. abc1234',
        versionRequiredHint: 'Version is required and saved with the completion record',
        doneVersionLabel: 'Completion version',
        evidence: 'Acceptance evidence', evidencePlaceholder: 'Optional: how it was verified',
        doneConfirm: 'Complete',
        timelineClear: 'Clear log',
        timelineClearConfirm: 'Clear the operation log? Only log entries are removed; tasks are unaffected.',
        timelineCleared: 'Cleared {n} log entries',
        /* v3 */
        stage: 'Stage', group: 'Group', milestone: 'Milestone', inbox: 'Inbox',
        hierarchy: 'Hierarchy', graphExpand: 'Expand all', graphCollapse: 'Collapse',
        briefTitle: 'Start brief',
        sectionGoal: 'Goal', sectionProgress: 'Progress', sectionDecisions: 'Decisions',
        sectionUpstreamDone: 'Completed upstream', sectionUpstreamPending: 'Pending upstream',
        sectionChanges: 'Changes', sectionResources: 'Resources', sectionOpenLoops: 'Open loops',
        sectionNextStep: 'Next step', sectionPreconditions: 'Preconditions', sectionBlocking: 'Blocked by',
        sectionDependencies: 'Dependencies', sectionContext: 'Context', sectionCauses: 'Causes',
        sectionCommits: 'Related commits', noExtraInfo: 'No context, dependencies, preconditions, resources or causes',
        sectionRelations: 'Relations', latest: 'Latest', blocked: 'Blocked', summary: 'Summary', thisTask: 'Current task', upstream: 'Upstream', downstream: 'Downstream', system: 'System', noRelations: 'No parent, child, dependency or precondition',
        resDraft: 'draft', resApproved: 'approved', resSuperseded: 'superseded',
        preTaskDone: 'task done', preTagDone: 'tag done', preResourceApproved: 'resource approved',
        preCommitExists: 'commit exists', preManualConfirm: 'manual confirm',
        statusActive: 'Active', statusArchived: 'Archived', statusPending: 'Pending',
        statusSkipped: 'Skipped', statusBlockedUpstream: 'Blocked by upstream',
        missingTask: 'Missing task', optional: 'optional', archivedShort: 'archived',
        blockedReasonDependency: 'Unmet dependency', blockedReasonPrecondition: 'Unmet precondition',
        effectiveStatus: 'effective',
        /* table / filters */
        sort: 'Sort', sortPriority: 'Priority', sortUpdated: 'Recently updated', sortCreated: 'Created',
        allMilestones: 'All milestones', allStages: 'All stages', milestoneStage: 'Milestone · stage',
        assign: 'Assign', assignTitle: 'Assign owner', assignPlaceholder: 'Owner name', needPerson: 'Enter an owner name',
        assignPick: 'Pick a person', assignManual: 'or type a name',
        owner: 'Owner', actorLabel: 'Actor', actions: 'Actions', updatedTime: 'Updated',
        releaseNote: 'Release note (optional, Enter to skip)',
        /* list view switch */
        view: 'View', viewAuto: 'Auto', viewFlat: 'Flat', viewGrouped: 'By milestone',
        viewHint: 'Auto groups only when more than the default milestone/stage exists',
        viewAutoGrouped: 'Auto: grouped by milestone',
        viewAutoFlat: 'Auto: default milestone/stage only, shown flat',
        taskUnit: 'tasks',
        pageBoard: 'Board', pageTree: 'Global task tree', treeHint: 'Milestone → group → task → subtask, at a glance',
        treeEmpty: 'No tasks yet', treeToggleExpand: 'Expand', treeToggleCollapse: 'Collapse', treeStatus: 'Status', treeOwner: 'Owner',
        treeFlow: 'Flow: open {open} · doing {doing} · blocked {blocked} · done {done}',
        /* people + archive */
        people: 'People', peopleMine: 'Mine', peopleAll: 'Everyone', peoplePick: '{n} selected',
        peopleHint: 'Filter by owner / creator / completer; defaults to you', peopleMe: 'me', peopleEmpty: 'No people yet',
        archive: 'Archive', archiveAll: 'Archive batch', archiveConfirm: 'Archive the {n} completed tasks in the current filter?',
        archiveNoTarget: 'No completed task to archive', archiveDone: 'Archived {n}',
        archiveSkipped: '; skipped {n}',
        doneBy: 'Completed by', archivedBy: 'Archived by', doneAt: 'Completed at',
        milestoneComplete: 'Milestone "{name}" is fully complete; archive it from the Done tab.',
      },
    }

    function readStoredHolder() {
      try {
        return window.localStorage.getItem(HOLDER_KEY) || ''
      } catch {
        return ''
      }
    }

    function writeHolder(value) {
      try {
        window.localStorage.setItem(HOLDER_KEY, value)
      } catch {
        /* ignore */
      }
    }

    function readStoredView() {
      try {
        const value = window.localStorage.getItem(VIEW_KEY)
        return VIEW_MODES.includes(value) ? value : 'auto'
      } catch {
        return 'auto'
      }
    }

    function writeStoredView(value) {
      try {
        window.localStorage.setItem(VIEW_KEY, value)
      } catch {
        /* ignore */
      }
    }

    function readStoredPage() {
      try {
        return window.localStorage.getItem(PAGE_KEY) === 'tree' ? 'tree' : 'board'
      } catch {
        return 'board'
      }
    }

    function writeStoredPage(value) {
      try {
        window.localStorage.setItem(PAGE_KEY, value)
      } catch {
        /* ignore */
      }
    }

    async function call(subpath, init) {
      const headers = Object.assign({}, init && init.headers)
      headers['x-dsh-project-task-client'] = '1'
      if (TOKEN) headers['x-dsh-project-task-token'] = TOKEN
      if (init && init.body) headers['content-type'] = 'application/json'
      const response = await window.fetch(BASE + subpath, Object.assign({}, init, { headers }))
      let payload = null
      try {
        payload = await response.json()
      } catch {
        /* non-JSON */
      }
      if (!response.ok) {
        const message = payload && payload.message
        // A 404 with no JSON body is the Web server's fallback: the plugin's
        // route is not registered on this machine. Say so instead of "HTTP 404".
        if (response.status === 404 && !message) throw new Error(hostHalfHint())
        if (response.status === 404) throw new Error(`${message}；插件 Host/Client 版本可能不一致，重启 DSH 或统一版本`)
        throw new Error(message || 'HTTP ' + response.status)
      }
      if (payload && payload.ok === false) throw new Error(payload.message || '操作失败')
      return payload
    }

    /** Order by `order`, then code; `lastCode` is pinned to the end. */
    function compareNodes(left, right, lastCode) {
      const leftLast = Boolean(lastCode) && left.code === lastCode
      const rightLast = Boolean(lastCode) && right.code === lastCode
      if (leftLast !== rightLast) return leftLast ? 1 : -1
      const leftOrder = Number.isFinite(Number(left.order)) ? Number(left.order) : 0
      const rightOrder = Number.isFinite(Number(right.order)) ? Number(right.order) : 0
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return String(left.code || '').localeCompare(String(right.code || ''))
    }

    function sortNodes(nodes, lastCode) {
      return [...nodes].sort((left, right) => compareNodes(left, right, lastCode))
    }

    function priorityRankOf(priority) {
      const index = PRIORITIES.indexOf(priority)
      return index === -1 ? PRIORITIES.length : index
    }

    function compareUpdated(left, right) {
      const byUpdated = String(right.updatedAt || right.statusChangedAt || '').localeCompare(String(left.updatedAt || left.statusChangedAt || ''))
      return byUpdated !== 0 ? byUpdated : String(left.id).localeCompare(String(right.id))
    }

    function compareCreated(left, right) {
      const byCreated = String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
      return byCreated !== 0 ? byCreated : String(left.id).localeCompare(String(right.id))
    }

    function comparePriority(left, right) {
      const rank = priorityRankOf(left.priority) - priorityRankOf(right.priority)
      if (rank !== 0) return rank
      const urgency = (Number(right.urgency) || 0) - (Number(left.urgency) || 0)
      if (urgency !== 0) return urgency
      return compareUpdated(left, right)
    }

    /** Comparator for one toolbar sort key; priority is the default. */
    function comparatorFor(sort) {
      return sort === 'updated' ? compareUpdated : sort === 'created' ? compareCreated : comparePriority
    }

    /** Client-side view order only; never sent to the backend. */
    function sortTasksFor(tasks, sort) {
      return [...tasks].sort(comparatorFor(sort))
    }

    function progressText(progress) {
      if (!progress) return ''
      const done = Number(progress.done)
      const total = Number(progress.total)
      if (!Number.isFinite(total) || total <= 0) return ''
      return `${Number.isFinite(done) ? done : 0}/${total}`
    }

    function paramsText(params) {
      if (!params || typeof params !== 'object') return ''
      const parts = Object.entries(params)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => `${key}=${String(value)}`)
      return parts.length ? ` · ${parts.join(' ')}` : ''
    }

    function shortTime(value) {
      if (!value) return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      const pad = (number) => String(number).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function taskVersion(task) {
      if (!task) return ''
      return String(task.doneVersion || task.version || '').trim()
    }

    function taskEvidence(task) {
      if (!task) return ''
      return String(task.doneEvidence || task.evidence || '').trim()
    }

    const CSS = [
      '.dsh-project-task{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:20px 24px 48px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '.dsh-project-task *{box-sizing:border-box}',
      '.dpt-inner{max-width:1080px;margin:0 auto}',
      '.dpt-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:10px}',
      '.dpt-title{margin:0;font-size:18px;font-weight:650;letter-spacing:-0.01em}',
      '.dpt-sub{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;word-break:break-all}',
      '.dpt-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.dpt-actor-label{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dpt-btn{height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.dpt-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.dpt-btn:disabled{opacity:.45;cursor:default}',
      '.dpt-btn--primary{color:var(--dsw-alias-brand-primary);border-color:currentColor;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)}',
      '.dpt-btn--success{color:var(--dsw-alias-state-success-primary);border-color:currentColor;background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)}',
      '.dpt-btn--danger{color:var(--dsw-alias-state-error-primary);border-color:currentColor}',
      '.dpt-btn--ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}',
      '.dpt-input,.dpt-select{height:27px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}',
      '.dpt-quick{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);margin-bottom:8px}',
      '.dpt-quick .dpt-input{flex:1;min-width:180px;height:28px;border-color:transparent;background:transparent;font-size:13px}',
      '.dpt-quick .dpt-select{height:28px}',
      '.dpt-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
      '.dpt-tabs{display:flex;gap:2px;flex-wrap:wrap}',
      '.dpt-tab{height:26px;padding:0 9px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
      '.dpt-tab:hover{background:var(--dsw-alias-bg-layer-1)}',
      '.dpt-tab--on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-weight:600}',
      '.dpt-tab-count{color:var(--dsw-alias-label-secondary);margin-left:5px;font-size:11px;font-variant-numeric:tabular-nums}',
      '.dpt-spacer{flex:1}',
      '.dpt-filter{height:27px;max-width:180px}',
      '.dpt-search{width:170px;height:27px}',
      '.dpt-table-wrap{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow-x:auto}',
      '.dpt-table{width:100%;min-width:940px;border-collapse:collapse;font-size:12.5px}',
      '.dpt-table th{padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.dpt-table td{text-align:left}',
      '.dpt-cell{padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle;white-space:nowrap;height:38px}',
      '.dpt-table--grouped th:nth-child(6),.dpt-table--grouped td:nth-child(6){display:none}',
      '.dpt-view{display:flex;align-items:center;gap:5px}',
      '.dpt-view-label{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dpt-people{position:relative;display:inline-block}',
      '.dpt-people-panel{position:absolute;top:30px;left:0;z-index:46;min-width:210px;max-height:300px;overflow:auto;padding:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px var(--dsw-alias-border-l2)}',
      '.dpt-people-actions{display:flex;gap:4px;padding:2px 2px 6px;margin-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dpt-people-row{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:5px;cursor:pointer;font-size:12px;white-space:nowrap}',
      '.dpt-people-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dpt-bulkbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dpt-group{cursor:pointer}',
      '.dpt-group td{padding:7px 10px;background:var(--dsw-alias-bg-layer-2);border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dpt-group:hover td{background:var(--dsw-alias-bg-layer-1)}',
      '.dpt-group--milestone td{padding-left:12px;border-left:3px solid var(--dsw-alias-brand-primary)}',
      '.dpt-group-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dpt-group-caret{width:14px;height:14px;flex:none;padding:0;border:0;background:transparent;font:inherit;font-size:11px;line-height:14px;text-align:left;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:3px}',
      '.dpt-group-caret:hover{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}',
      '.dpt-group-name{font-size:12.5px;font-weight:650;color:var(--dsw-alias-label-primary)}',
      '.dpt-group--milestone .dpt-group-name{font-size:13px;letter-spacing:-0.01em}',
      '.dpt-group-count{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dpt-group-progress{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dpt-node-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;line-height:14px;padding:0 4px;border:1px solid var(--dsw-alias-border-l1);border-radius:3px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dpt-progress{display:inline-block;width:60px;height:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:3px;overflow:hidden;background:var(--dsw-alias-bg-base)}',
      '.dpt-progress-fill{display:block;height:100%;background:var(--dsw-alias-brand-primary);opacity:.6}',
      '.dpt-stage-row{cursor:pointer}',
      '.dpt-stage-row td{padding:4px 10px 4px 30px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, transparent);border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-stage-row:hover td{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 85%, transparent)}',
      '.dpt-stage-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.dpt-stage-name{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dpt-table--grouped .dpt-task--grouped .dpt-cell--status{position:relative;padding-left:44px}',
      '.dpt-table--grouped .dpt-task--grouped .dpt-cell--status::before{content:"";position:absolute;left:27px;top:0;bottom:0;width:1px;background:var(--dsw-alias-border-l1)}',
      '.dpt-table--grouped .dpt-task--grouped .dpt-cell--status::after{content:"";position:absolute;left:27px;top:19px;width:8px;height:1px;background:var(--dsw-alias-border-l1)}',
      '.dpt-table--grouped .dpt-task--child .dpt-cell--status{padding-left:58px}',
      '.dpt-table--grouped .dpt-task--child .dpt-cell--status::after{left:41px;width:8px}',
      '.dpt-table--grouped .dpt-task--child .dpt-cell--status::before{left:41px}',
      '.dpt-task{cursor:pointer}',
      '.dpt-task:hover td{background:var(--dsw-alias-bg-layer-2)}',
      '.dpt-task--done .dpt-task-title-text{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}',
      '.dpt-task--cancelled td{opacity:.6}',
      '.dpt-cell--title{min-width:240px;max-width:400px}',
      '.dpt-cell--org{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-cell--owner{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-cell--time{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dpt-cell--actions{width:1%;white-space:nowrap}',
      '.dpt-title-cell{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dpt-task-title-text{display:inline-block;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}',
      '.dpt-task-actions{display:flex;gap:4px;align-items:center}',
      '.dpt-task-actions .dpt-btn{height:22px;padding:0 7px;font-size:11.5px;border-radius:5px}',
      '.dpt-caret{width:16px;height:16px;flex:none;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px;line-height:1}',
      '.dpt-caret:hover{background:var(--dsw-alias-bg-overlay)}',
      '.dpt-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:var(--dsw-alias-label-secondary)}',
      '.dpt-dot--open{background:transparent;border:1.5px solid var(--dsw-alias-label-secondary)}',
      '.dpt-dot--doing{background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)}',
      '.dpt-dot--blocked{background:var(--dsw-alias-state-warn-primary)}',
      '.dpt-dot--done{background:var(--dsw-alias-state-success-primary)}',
      '.dpt-dot--cancelled{background:var(--dsw-alias-state-idle-primary)}',
      '.dpt-status-text{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dpt-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;line-height:16px;padding:0 5px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;letter-spacing:0}',
      '.dpt-version{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-version--missing{font-family:inherit;opacity:.75}',
      '.dpt-mark{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dpt-mark--warn{color:var(--dsw-alias-state-warn-primary)}',
      '.dpt-badge{font-size:10.5px;line-height:15px;padding:0 5px;border-radius:4px;border:1px solid currentColor;white-space:nowrap}',
      '.dpt-badge--P0{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);font-weight:700}',
      '.dpt-badge--P1{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 13%, transparent);font-weight:600}',
      '.dpt-badge--P2{color:var(--dsw-alias-brand-primary)}',
      '.dpt-badge--P3{color:var(--dsw-alias-label-secondary)}',
      '.dpt-badge--P4,.dpt-badge--P5{color:var(--dsw-alias-state-idle-primary)}',
      '.dpt-badge--urgency{border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:transparent}',
      '.dpt-badge--doing,.dpt-badge--blocked,.dpt-badge--done,.dpt-badge--cancelled{font-weight:500}',
      '.dpt-badge--doing{color:var(--dsw-alias-brand-primary);border-color:currentColor}',
      '.dpt-badge--blocked{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}',
      '.dpt-badge--done{color:var(--dsw-alias-state-success-primary);border-color:currentColor}',
      '.dpt-badge--cancelled{color:var(--dsw-alias-state-idle-primary);border-color:currentColor}',
      '.dpt-badge--open{color:var(--dsw-alias-label-secondary);border-color:currentColor}',
      '.dpt-badge--active{color:var(--dsw-alias-brand-primary);border-color:currentColor}',
      '.dpt-badge--archived{color:var(--dsw-alias-label-secondary);border-color:currentColor}',
      '.dpt-badge--pending{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l1)}',
      '.dpt-badge--skipped{color:var(--dsw-alias-state-idle-primary);border-color:currentColor}',
      '.dpt-tag{font-size:10.5px;line-height:15px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1)}',
      '.dpt-alert,.dpt-notice{margin:0 0 10px;padding:7px 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);font-size:12px;white-space:pre-wrap}',
      '.dpt-alert{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}',
      '.dpt-notice--ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dpt-notice--err{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dpt-skill-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dpt-skill-row:last-child{border-bottom:0}',
      '.dpt-skill-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dpt-skill-name{font-size:12.5px;font-weight:600}',
      '.dpt-skill-path{font-size:10.5px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.dpt-skill-note{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-skill-state{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-empty{padding:32px 0;text-align:center;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l1);border-radius:8px}',
      '.dpt-menu{position:relative;display:inline-block}',
      '.dpt-menu-panel{position:absolute;top:30px;right:0;z-index:45;min-width:180px;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px var(--dsw-alias-border-l2)}',
      '.dpt-menu-panel button{display:block;width:100%;padding:6px 9px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;white-space:nowrap}',
      '.dpt-menu-panel button:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dpt-modal-layer{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px}',
      '.dpt-modal-backdrop{position:absolute;inset:0;background:var(--dsw-alias-bg-overlay);opacity:.66}',
      '.dpt-modal{position:relative;display:flex;flex-direction:column;width:min(560px,94vw);max-height:86vh;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 24px 64px var(--dsw-alias-border-l2);overflow:hidden}',
      '.dpt-modal--small{width:min(440px,94vw)}',
      '.dpt-modal--wide{width:min(720px,94vw)}',
      '.dpt-modal-head{display:flex;align-items:center;gap:8px;padding:13px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dpt-modal-title{font-size:15px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpt-modal-body{padding:14px 16px;overflow:auto;display:flex;flex-direction:column;gap:11px}',
      '.dpt-modal-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 16px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dpt-x{width:26px;height:26px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:15px;line-height:1}',
      '.dpt-x:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dpt-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-field .dpt-input,.dpt-field .dpt-select{width:100%}',
      '.dpt-field textarea{min-height:72px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;resize:vertical;outline:none}',
      '.dpt-hint{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.dpt-hint--err{color:var(--dsw-alias-state-error-primary)}',
      '.dpt-meta-block{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;line-height:1.65;font-variant-numeric:tabular-nums}',
      '.dpt-subtasks{display:flex;flex-direction:column;gap:4px;font-size:12px}',
      '.dpt-subtask{display:flex;gap:6px;align-items:center;cursor:pointer}',
      '.dpt-subtask:hover{text-decoration:underline}',
      '.dpt-history{font-size:11.5px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:3px}',
      '.dpt-flow{display:flex;flex-direction:column;padding:2px 0 0}',
      '.dpt-flow-step{display:flex;gap:8px;min-height:26px}',
      '.dpt-flow-rail{position:relative;flex:none;width:12px;display:flex;justify-content:center}',
      '.dpt-flow-step:not(:last-child) .dpt-flow-rail::after{content:"";position:absolute;top:12px;bottom:-2px;width:1px;background:var(--dsw-alias-border-l1)}',
      '.dpt-flow-dot{position:relative;z-index:1;width:8px;height:8px;margin-top:5px;border-radius:50%;background:var(--dsw-alias-label-secondary)}',
      '.dpt-flow-dot--open{background:transparent;border:1.5px solid var(--dsw-alias-label-secondary)}',
      '.dpt-flow-dot--doing{background:var(--dsw-alias-brand-primary)}',
      '.dpt-flow-dot--blocked{background:var(--dsw-alias-state-warn-primary)}',
      '.dpt-flow-dot--done{background:var(--dsw-alias-state-success-primary)}',
      '.dpt-flow-dot--archived{background:var(--dsw-alias-label-secondary)}',
      '.dpt-flow-dot--idle{background:var(--dsw-alias-border-l2)}',
      '.dpt-flow-body{flex:1;min-width:0;padding:0 0 5px}',
      '.dpt-flow-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.dpt-flow-action{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dpt-flow-actor{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-flow-time{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dpt-flow-transition{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-flow-chip{padding:0 4px;line-height:15px;font-size:10.5px;border:1px solid var(--dsw-alias-border-l1);border-radius:3px;background:transparent;color:var(--dsw-alias-label-secondary)}',
      '.dpt-flow-chip--to{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dpt-flow-arrow{color:var(--dsw-alias-label-secondary);font-size:10.5px}',
      '.dpt-brief{display:flex;flex-direction:column;gap:10px}',
      '.dpt-section{display:flex;flex-direction:column;gap:3px}',
      '.dpt-section-title{font-size:11px;font-weight:650;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}',
      '.dpt-section-body{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}',
      '.dpt-detail-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:9px;display:flex;flex-direction:column;gap:5px}',
      '.dpt-lines{display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:1.55}',
      '.dpt-line{display:flex;gap:6px;align-items:baseline}',
      '.dpt-line-index{flex:none;min-width:14px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dpt-line-key{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-line-body{word-break:break-word;white-space:pre-wrap}',
      '.dpt-modal--detail{width:min(1140px,94vw);max-height:90vh;border-radius:14px}',
      '.dpt-modal--detail .dpt-modal-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;grid-template-areas:"id title tags close" "meta meta meta meta";column-gap:10px;row-gap:9px;align-items:center;padding:12px 16px 12px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dpt-dt-id{grid-area:id;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;line-height:18px;padding:0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-title{grid-area:title;min-width:0;margin:0;font-size:16px;font-weight:650;letter-spacing:-0.012em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dpt-modal--detail .dpt-head-meta{grid-area:tags;flex:none;display:flex;align-items:center;gap:6px}',
      '.dpt-modal--detail .dpt-x{grid-area:close;flex:none}',
      '.dpt-dt-priority{display:inline-flex;align-items:center;height:20px;padding:0 7px;border:1px solid color-mix(in srgb, var(--tone, var(--dsw-alias-label-secondary)) 32%, var(--dsw-alias-border-l1));border-radius:6px;background:color-mix(in srgb, var(--tone, var(--dsw-alias-label-secondary)) 9%, transparent);color:var(--tone, var(--dsw-alias-label-secondary));font-size:10.5px;font-weight:650;white-space:nowrap}',
      '.dpt-dt-priority--urgency{--tone:var(--dsw-alias-state-warn-primary)}',
      '.dpt-head-facts{grid-area:meta;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:7px}',
      '.dpt-dt-chip{display:inline-flex;align-items:center;gap:6px;height:27px;max-width:100%;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 75%, transparent);font-size:11.5px;color:var(--dsw-alias-label-primary)}',
      '.dpt-dt-chip .dpt-dt-ico{width:12px;height:12px;flex:none;color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-chip-label{flex:none;color:var(--dsw-alias-label-secondary);font-size:10px}',
      '.dpt-dt-chip b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.dpt-dt-chip--status{border-color:color-mix(in srgb, var(--tone) 30%, var(--dsw-alias-border-l1));background:color-mix(in srgb, var(--tone) 6%, transparent)}',
      '.dpt-dt-chip--status b,.dpt-dt-chip--warn b{color:var(--tone)}',
      '.dpt-dt-ico{width:13px;height:13px;flex:none}',
      '.dpt-dt-progress{margin-left:auto;display:inline-flex;align-items:center;gap:7px;font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dpt-dt-ring{width:30px;height:30px;flex:none;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--tone) calc(var(--pct) * 1%), var(--dsw-alias-bg-layer-2) 0);box-shadow:0 0 0 2px color-mix(in srgb, var(--tone) 8%, transparent)}',
      '.dpt-dt-ring i{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-1);font-style:normal;font-size:9px;font-weight:700;color:var(--tone);font-variant-numeric:tabular-nums}',
      '.dpt-modal--detail .dpt-modal-body{padding:0;display:block;overflow:auto;background:var(--dsw-alias-bg-base)}',
      '.dpt-dt-main{padding:16px 18px 24px}',
      '.dpt-dt-info-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}',
      '.dpt-dt-info{min-width:0;padding:13px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.dpt-dt-info--goal{--info-tone:var(--dsw-alias-brand-primary)}',
      '.dpt-dt-info--progress{--info-tone:var(--dsw-alias-state-warn-primary)}',
      '.dpt-dt-info--evidence{--info-tone:var(--dsw-alias-state-success-primary)}',
      '.dpt-dt-info--note{--info-tone:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-info-head{display:flex;align-items:center;gap:6px;min-height:18px;margin-bottom:8px;font-size:11.5px;font-weight:650;color:var(--dsw-alias-label-primary)}',
      '.dpt-dt-info-head .dpt-dt-ico{color:var(--info-tone)}',
      '.dpt-dt-info-body{font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-word}',
      '.dpt-dt-info--note .dpt-dt-info-body{color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-card{padding:14px 15px;border:1px solid var(--dsw-alias-border-l1);border-radius:13px;background:var(--dsw-alias-bg-layer-1)}',
      '.dpt-dt-card + .dpt-dt-card{margin-top:14px}',
      '.dpt-dt-card-head{display:flex;align-items:center;gap:8px;min-height:18px;margin-bottom:12px}',
      '.dpt-dt-card-head::after{content:"";flex:1;height:1px;min-width:12px;background:color-mix(in srgb, var(--dsw-alias-border-l1) 78%, transparent)}',
      '.dpt-dt-card-head .dpt-dt-ico{color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-card-title{font-size:12px;font-weight:650;letter-spacing:.01em}',
      '.dpt-dt-count{min-width:16px;height:15px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:9.5px;line-height:15px;text-align:center;order:3}',
      '.dpt-dt-count--warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent)}',
      '.dpt-dt-card-body{font-size:12px;line-height:1.6}',
      '.dpt-dt-empty{padding:22px 10px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:11.5px}',
      '.dpt-dt-decisions{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}',
      '.dpt-dt-decision{display:grid;grid-template-columns:18px minmax(0,1fr);gap:7px}',
      '.dpt-dt-decision-num{padding-top:2px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-loop{display:flex;gap:8px;align-items:flex-start;padding:7px 9px;border:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 17%, var(--dsw-alias-border-l1));border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 4%, transparent)}',
      '.dpt-dt-loop + .dpt-dt-loop{margin-top:6px}',
      '.dpt-dt-loop-dot{width:6px;height:6px;flex:none;margin-top:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)}',
      '.dpt-dt-byline{margin-top:2px;font-size:9.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-row{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px}',
      '.dpt-dt-row .dpt-dt-ico{color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-row-main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpt-dt-row-code{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;padding:1px 4px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-subhead{margin:10px 0 2px;font-size:10.5px;font-weight:650;color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-graph-wrap{overflow-x:auto;overflow-y:hidden;border-radius:10px}',
      '.dpt-dt-graph-canvas{position:relative;margin:0 auto;background:radial-gradient(var(--dsw-alias-border-l1) .7px, transparent .7px) 0 0 / 16px 16px}',
      '.dpt-dt-graph-svg{position:absolute;inset:0;z-index:1;overflow:visible}',
      '.dpt-dt-glane{position:absolute;z-index:0;border:.5px solid color-mix(in srgb, var(--tone) 22%, var(--dsw-alias-border-l1));border-radius:10px;background:color-mix(in srgb, var(--tone) 5%, var(--dsw-alias-bg-layer-1))}',
      '.dpt-dt-glane-cap{position:absolute;z-index:2;display:flex;align-items:baseline;gap:6px;font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-glane-cap b{color:var(--tone);font-size:10.5px}',
      '.dpt-dt-glane-cap span{color:var(--dsw-alias-label-primary);font-weight:600;font-size:11px}',
      '.dpt-dt-glane-cap i{font-style:normal;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9px;opacity:.7}',
      '.dpt-dt-glane-fold{margin-left:2px;padding:1px 7px;border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, var(--dsw-alias-border-l1));border-radius:5px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);font-size:9.5px;cursor:pointer;line-height:1.5}',
      '.dpt-dt-glane-fold:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-layer-1))}',
      '.dpt-dt-gnode--fold{cursor:pointer;border-style:dashed;border-color:color-mix(in srgb, var(--tone) 34%, var(--dsw-alias-border-l1))}',
      '.dpt-dt-gnode--org{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, var(--dsw-alias-border-l1));background:linear-gradient(160deg,color-mix(in srgb, var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1) 72%)}',
      '.dpt-dt-gnode{position:absolute;z-index:3;transform:translate(-50%,-50%);padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 4px 14px rgba(16,24,40,.07);transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}',
      '.dpt-dt-gnode--link{cursor:pointer}',
      '.dpt-dt-gnode--link:hover{border-color:var(--dsw-alias-brand-primary);box-shadow:0 6px 18px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);transform:translate(-50%,-50%) translateY(-1px)}',
      '.dpt-dt-gnode--current{border-color:color-mix(in srgb, var(--tone) 48%, var(--dsw-alias-border-l1));background:linear-gradient(160deg, color-mix(in srgb, var(--tone) 10%, var(--dsw-alias-bg-layer-1)), var(--dsw-alias-bg-layer-1) 70%);box-shadow:0 0 0 5px color-mix(in srgb, var(--tone) 8%, transparent),0 8px 24px color-mix(in srgb, var(--tone) 14%, transparent);cursor:default}',
      '.dpt-dt-gnode-top{display:flex;align-items:center;gap:6px;margin-bottom:3px}',
      '.dpt-dt-gnode-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-gnode-dot{width:6px;height:6px;margin-left:auto;border-radius:50%;background:var(--tone)}',
      '.dpt-dt-gnode-title{font-size:11.5px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dpt-dt-gnode-meta{margin-top:4px;font-size:9.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-dt-gnode-tag{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--tone)}',
      '.dpt-dt-gnode--current .dpt-dt-gnode-title{font-size:13px}',
      '.dpt-dt-gnode-status{margin-top:5px;display:inline-flex;align-items:center;height:19px;padding:0 7px;border:1px solid color-mix(in srgb, var(--tone) 36%, var(--dsw-alias-border-l1));border-radius:999px;background:color-mix(in srgb, var(--tone) 9%, transparent);color:var(--tone);font-size:10px;font-weight:650}',
      '.dpt-dt-edge-label{padding:2px 5px;border:1px solid color-mix(in srgb, var(--tone) 30%, var(--dsw-alias-border-l1));border-radius:5px;background:var(--dsw-alias-bg-layer-1);fill:var(--tone);font-size:9px;font-weight:650}',
      '.dpt-dt-sequence{display:block;padding:2px 0 0}',
      '.dpt-dt-seq-canvas{position:relative;display:flex;gap:10px;overflow-x:auto;padding:2px 2px 10px;scrollbar-width:thin}',
      '.dpt-dt-seq-step{position:relative;z-index:1;display:block;flex:0 0 156px;min-width:156px;max-width:156px}',
      '.dpt-dt-seq-time{height:16px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dpt-dt-seq-rail{position:relative;height:28px;display:flex;align-items:center}',
      '.dpt-dt-seq-step:not(:last-child) .dpt-dt-seq-rail::after{content:"";position:absolute;z-index:0;left:50%;top:50%;width:calc(100% + 10px);height:1px;background:linear-gradient(90deg,color-mix(in srgb, var(--tone) 42%, var(--dsw-alias-border-l1)),var(--dsw-alias-border-l1))}',
      '.dpt-dt-seq-dot{position:relative;z-index:1;width:18px;height:18px;display:grid;place-items:center;border-radius:50%;color:var(--tone);border:1.5px solid var(--tone);background:color-mix(in srgb, var(--tone) 12%, var(--dsw-alias-bg-layer-1));box-shadow:0 0 0 4px var(--dsw-alias-bg-layer-1),0 0 0 5px color-mix(in srgb, var(--tone) 18%, transparent)}',
      '.dpt-dt-seq-dot .dpt-dt-ico{width:11px;height:11px}',
      '.dpt-dt-seq-card{padding:8px 9px;border:1px solid color-mix(in srgb, var(--tone) 20%, var(--dsw-alias-border-l1));border-radius:9px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 2px 8px rgba(16,24,40,.04)}',
      '.dpt-dt-seq-step:last-child .dpt-dt-seq-card{border-color:color-mix(in srgb, var(--tone) 42%, var(--dsw-alias-border-l1));background:linear-gradient(160deg,color-mix(in srgb, var(--tone) 9%, var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1) 72%);box-shadow:0 6px 16px color-mix(in srgb, var(--tone) 10%, transparent)}',
      '.dpt-dt-seq-state{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:650;color:var(--tone);white-space:nowrap}',
      '.dpt-dt-seq-state .dpt-dt-ico{width:13px;height:13px;flex:none}',
      '.dpt-dt-seq-state em{margin-left:auto;padding:0 4px;border-radius:4px;font-style:normal;font-size:8.5px;line-height:14px;font-weight:700;color:var(--tone);background:color-mix(in srgb, var(--tone) 12%, transparent);flex:none}',
      '.dpt-dt-seq-meta{margin-top:4px;display:flex;align-items:center;gap:6px;font-size:9.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dpt-dt-seq-meta span + span{padding-left:6px;border-left:1px solid var(--dsw-alias-border-l1)}',
      '.dpt-dt-seq-meta .dpt-dt-seq-user{max-width:74px;overflow:hidden;text-overflow:ellipsis;font-size:9px;opacity:.82}',
      '.dpt-pages{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dpt-page-btn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:5px 11px;border-radius:6px;font-size:12px;cursor:pointer}',
      '.dpt-page-btn--on{background:var(--dsw-alias-brand-primary);color:var(--on-brand,#fff);font-weight:650}',
      '.dpt-tree{margin-top:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.dpt-tree-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}',
      '.dpt-tree-title{font-size:14px;font-weight:650}',
      '.dpt-tree-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dpt-tree-body{padding:10px 14px 18px}',
      '.dpt-tree-row{display:flex;align-items:center;gap:8px;min-height:30px;padding:3px 8px;border-radius:7px;font-size:12px}',
      '.dpt-tree-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dpt-tree-toggle{width:19px;height:19px;flex:none;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;padding:0}',
      '.dpt-tree-toggle--empty{visibility:hidden}',
      '.dpt-tree-icon{width:15px;flex:none;text-align:center;display:inline-flex;color:var(--tone)}',
      '.dpt-tree-icon svg{width:14px;height:14px}',
      '.dpt-tree-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpt-tree-kind{flex:none;padding:1px 6px;border-radius:5px;border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, var(--dsw-alias-border-l1));background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);color:var(--dsw-alias-brand-primary);font-size:9.5px;font-weight:650}',
      '.dpt-tree-row--milestone .dpt-tree-name{font-weight:700}',
      '.dpt-tree-meta{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:10.5px;white-space:nowrap}',
      '.dpt-tree-flow{display:inline-flex;align-items:center;gap:5px}',
      '.dpt-tree-flow-item{padding:1px 6px;border-radius:999px;border:1px solid color-mix(in srgb,var(--tone) 32%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--tone) 8%,transparent);color:var(--tone);font-size:9.5px;font-weight:650}',
      '.dpt-tree-status{padding:1px 7px;border-radius:999px;border:1px solid color-mix(in srgb,var(--tone) 36%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--tone) 9%,transparent);color:var(--tone);font-weight:650}',
      '.dpt-tree-count{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px}',
      '.dpt-tree-children{margin-left:18px;border-left:1px dashed var(--dsw-alias-border-l1);padding-left:8px}',
      '.dpt-tree-task{cursor:pointer}',
      '.dpt-tree-bar{height:4px;width:56px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}',
      '.dpt-tree-bar i{display:block;height:100%;background:var(--tone)}',
      '.dpt-tree-empty{padding:24px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '@media (max-width:1040px){.dpt-dt-info-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@media (max-width:720px){.dpt-search{width:100%}.dpt-filter{max-width:none}.dpt-task-actions{flex-wrap:wrap}.dpt-modal--detail .dpt-modal-head{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"id title close" "tags tags tags" "meta meta meta";padding:11px 12px;row-gap:8px}.dpt-dt-title{white-space:normal;font-size:15px}.dpt-dt-info-grid{grid-template-columns:1fr;gap:10px}.dpt-dt-main{padding:14px}.dpt-dt-progress{margin-left:0}}',
    ].join('\n')

    function StyleTag() {
      return h('style', null, CSS)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const snapshot = ctx.locale && ctx.locale.getLocale ? ctx.locale.getLocale() : null
        const active = (snapshot && snapshot.active) || (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? 'zh' : 'en')
        const zh = /^zh/i.test(active)
        const dict = zh ? DICT.zh : DICT.en
        const t = (key) => (dict[key] !== undefined ? dict[key] : DICT.en[key] !== undefined ? DICT.en[key] : key)
        const statusLabel = (status) => (zh ? STATUS_ZH : STATUS_EN)[status] || status || '—'
        const urgencyLabel = (value) => (zh ? URGENCY_ZH : URGENCY_EN)[value] || String(value)
        const actionLabel = (action) => (zh ? ACTION_ZH : ACTION_EN)[action] || action
        const orgStatusLabel = (value) => {
          if (!value) return '—'
          if (value === 'blocked_by_upstream') return t('statusBlockedUpstream')
          if (value === 'active') return t('statusActive')
          if (value === 'archived') return t('statusArchived')
          if (value === 'pending') return t('statusPending')
          if (value === 'skipped') return t('statusSkipped')
          if (value === 'done') return statusLabel('done')
          return String(value)
        }
        const orgBadgeClass = (value) => {
          if (value === 'blocked_by_upstream') return 'dpt-badge--blocked'
          if (value === 'done') return 'dpt-badge--done'
          if (value === 'archived') return 'dpt-badge--archived'
          if (value === 'pending') return 'dpt-badge--pending'
          if (value === 'skipped') return 'dpt-badge--skipped'
          return 'dpt-badge--active'
        }
        const nodeName = (node) => (node && node.name) || (node && node.code === 'default' ? t('inbox') : (node && node.code) || '—')
        const preTypeLabel = (type) =>
          ({
            task_done: t('preTaskDone'),
            tag_done: t('preTagDone'),
            resource_approved: t('preResourceApproved'),
            commit_exists: t('preCommitExists'),
            manual_confirm: t('preManualConfirm'),
          })[type] || type || '—'
        const resStatusLabel = (status) =>
          ({ draft: t('resDraft'), approved: t('resApproved'), superseded: t('resSuperseded') })[status] || status || '—'

        function TaskView(props) {
          const sessionId = props && props.sessionId
          const [board, setBoard] = useState(null)
          const [archived, setArchived] = useState([])
          const [milestones, setMilestones] = useState([])
          const [stages, setStages] = useState([])
          const [tags, setTags] = useState([])
          const [actor, setActor] = useState(null)
          const [root, setRoot] = useState('')
          const [config, setConfig] = useState({ defaultTab: 'auto', archiveAfterDays: 3, claimLimit: 3, versionRequired: true, tagStrict: false, historyPath: '' })
          const [error, setError] = useState('')
          const [notice, setNotice] = useState(null)
          const [busy, setBusy] = useState(false)
          const [holder, setHolderState] = useState(readStoredHolder)
          const [tab, setTab] = useState('all')
          // Most boards are worked as a "what changed lately" queue; the sort
          // select still offers 优先级 / 创建时间. compareUpdated is newest-first.
          const [sort, setSort] = useState('updated')
          const [collapsed, setCollapsed] = useState(() => new Set())
          const [closedGroups, setClosedGroups] = useState(() => new Set())
          const [closedStages, setClosedStages] = useState(() => new Set())
          const [viewMode, setViewMode] = useState(readStoredView)
          const [page, setPage] = useState(readStoredPage)
          const [treeCollapsed, setTreeCollapsed] = useState(() => new Set())
          const [graphFolded, setGraphFolded] = useState(() => new Set())
          const [people, setPeople] = useState([])
          const [personFilter, setPersonFilter] = useState(null)
          const [peopleOpen, setPeopleOpen] = useState(false)
          const [search, setSearch] = useState('')
          const [tagFilter, setTagFilter] = useState('')
          const [milestoneFilter, setMilestoneFilter] = useState('')
          const [stageFilter, setStageFilter] = useState('')
          const [detailId, setDetailId] = useState('')
          const [detail, setDetail] = useState(null)
          const [brief, setBrief] = useState(null)
          const [assign, setAssign] = useState(null)
          const [doneTarget, setDoneTarget] = useState(null)
          const [doneVersion, setDoneVersion] = useState('')
          const [doneEvidence, setDoneEvidence] = useState('')
          const [doneHint, setDoneHint] = useState(null)
          const [quickTitle, setQuickTitle] = useState('')
          const [quickPriority, setQuickPriority] = useState('P2')
          const [quickUrgency, setQuickUrgency] = useState(3)
          const [quickStage, setQuickStage] = useState('default')
          const [exportOpen, setExportOpen] = useState(false)
          const [skills, setSkills] = useState(null)
          const [skillsOpen, setSkillsOpen] = useState(false)
          const [skillBusy, setSkillBusy] = useState(false)
          const [skillMsg, setSkillMsg] = useState('')
          const [skillDismissed, setSkillDismissed] = useState(() => {
            try {
              return window.localStorage.getItem('dsh-project-task-skills-dismissed') === '1'
            } catch {
              return false
            }
          })
          const mounted = useRef(true)
          const tabInitialized = useRef(false)
          const holderReady = useRef(false)
          const versionRequest = useRef(0)
          const versionRequired = config.versionRequired !== false

          useEffect(() => () => {
            mounted.current = false
          }, [])

          const query = '?sessionId=' + encodeURIComponent(sessionId || '')

          const loadPeople = useCallback(async () => {
            if (!sessionId) return
            try {
              const data = await call('/people' + query)
              if (!mounted.current) return
              setPeople(Array.isArray(data && data.people) ? data.people : [])
            } catch {
              /* the people list is best-effort; filters still work from tasks */
            }
          }, [query, sessionId])

          const loadSkills = useCallback(async () => {
            if (!sessionId) return
            try {
              const data = await call('/skills' + query)
              if (mounted.current && data && data.ok) setSkills(data)
            } catch {
              /* the first-run banner is optional; the page still works */
            }
          }, [query, sessionId])

          const load = useCallback(async () => {
            if (!sessionId) return
            try {
              const data = await call('/state' + query)
              if (!mounted.current) return
              setBoard(data.board)
              setArchived(data.archived || [])
              setMilestones(data.milestones || [])
              setStages(data.stages || [])
              setTags(data.tags || [])
              setActor(data.actor || null)
              setRoot(data.root || '')
              setConfig(Object.assign({ defaultTab: 'auto', archiveAfterDays: 3, claimLimit: 3, versionRequired: true, tagStrict: false, historyPath: '' }, data.config || {}))
              if (!holderReady.current) {
                holderReady.current = true
                if (!readStoredHolder()) {
                  const next = (data.actor && (data.actor.person || data.actor.actor)) || ''
                  // Initialise from the resolved person (git user.name), not the tool session.
                  if (next) setHolderState(next)
                }
              }
              setError('')
              loadPeople()
              loadSkills()
            } catch (cause) {
              if (mounted.current) setError(cause.message || String(cause))
            }
          }, [query, sessionId, loadPeople, loadSkills])

          useEffect(() => {
            load()
          }, [load])

          const detectedSkillTargets = (skills && Array.isArray(skills.targets) ? skills.targets : [])
            .filter((row) => row.detected)
            .map((row) => row.name)

          const skillStateLabel = (state) =>
            ({ linked: t('skillLinked'), copy: t('skillCopy'), missing: t('skillMissing'), drift: t('skillDrift'), foreign: t('skillForeign') })[state] || state

          const postSkills = useCallback(
            async (names, action) => {
              if (!sessionId || !names.length) return null
              setSkillBusy(true)
              setSkillMsg('')
              try {
                const data = await call('/skills', {
                  method: 'POST',
                  body: JSON.stringify({ sessionId, action, targets: names }),
                })
                if (!data || data.ok === false) throw new Error((data && data.message) || '技能操作失败')
                const failed =
                  action === 'install'
                    ? (data.results || []).filter((item) => item.state !== 'linked' && item.state !== 'copy')
                    : []
                setSkillMsg(
                  failed.length
                    ? `${t('skillFailed')}：${failed.map((item) => `${item.name} ${item.state || ''}`).join('、')}`
                    : t('skillDone'),
                )
                await loadSkills()
                return data
              } catch (cause) {
                setSkillMsg(cause.message || String(cause))
                return null
              } finally {
                setSkillBusy(false)
              }
            },
            [loadSkills, sessionId, t],
          )

          const dismissSkillBanner = () => {
            setSkillDismissed(true)
            try {
              window.localStorage.setItem('dsh-project-task-skills-dismissed', '1')
            } catch {
              /* ignore */
            }
          }

          useEffect(() => {
            if (!detailId) return undefined
            const onKey = (event) => {
              if (event.key === 'Escape') closeDetail()
            }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [detailId])

          useEffect(() => {
            if (!doneTarget) return undefined
            const onKey = (event) => {
              if (event.key === 'Escape') closeDone()
            }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [doneTarget])

          useEffect(() => {
            if (!brief) return undefined
            const onKey = (event) => {
              if (event.key === 'Escape') setBrief(null)
            }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [brief])

          useEffect(() => {
            if (!assign) return undefined
            const onKey = (event) => {
              if (event.key === 'Escape') setAssign(null)
            }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [assign])

          const run = async (payload, successText) => {
            if (!sessionId) return null
            setBusy(true)
            setExportOpen(false)
            try {
              const body = Object.assign({ sessionId }, payload)
              if (!body.by) body.by = holder.trim() || 'ui'
              if (!body.person && holder.trim()) body.person = holder.trim()
              const data = await call('/action', { method: 'POST', body: JSON.stringify(body) })
              setNotice({ kind: 'ok', text: successText || data.message || t('ok') })
              await load()
              return data
            } catch (cause) {
              setNotice({ kind: 'err', text: cause.message || String(cause) })
              return null
            } finally {
              setBusy(false)
            }
          }

          const setHolder = (value) => {
            setHolderState(value)
            writeHolder(value)
          }

          const needHolder = () => {
            if (holder.trim()) return true
            setNotice({ kind: 'err', text: t('needHolder') })
            return false
          }

          const activeTasks = (board && board.tasks) || []
          const archivedTasks = archived || []
          const localeCode = zh ? 'zh-CN' : 'en'
          const mePerson = (actor && (actor.person || actor.actor)) || holder.trim()
          const personKey = (value) => String(value == null ? '' : value).trim().toLowerCase()
          const selectedPeople = personFilter === null ? (mePerson ? [mePerson] : []) : personFilter
          const selectedPeopleKeys = new Set(selectedPeople.map(personKey))
          const peopleFilterActive = selectedPeople.length > 0
          const taskPeople = (task) => [task.holder, task.createdBy, task.doneBy].filter(Boolean)
          const matchesPerson = (task) => !peopleFilterActive || taskPeople(task).some((name) => selectedPeopleKeys.has(personKey(name)))
          const matchesTag = (task) => !tagFilter || (task.tags || []).includes(tagFilter)
          const matchesSearch = (task) => {
            const keyword = search.trim().toLowerCase()
            if (!keyword) return true
            return [task.id, task.title, task.notes, task.holder, task.stageName, task.milestoneName, task.stageCode, ...(task.tags || [])]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(keyword))
          }
          const childrenOf = (task) => sortTasksFor(activeTasks.filter((candidate) => candidate.parentId === task.id), sort)
          const isContainerOf = (task) => activeTasks.some((candidate) => candidate.parentId === task.id)
          const effectiveOf = (task) => task.effectiveStatus || task.status
          const isReadyOf = (task) => {
            if (typeof task.isReady === 'boolean') return task.isReady
            return task.status === 'open' && !task.holder && !isContainerOf(task) && effectiveOf(task) === 'open'
          }

          const tagCodes = []
          const tagSeen = new Set()
          for (const entry of tags || []) {
            const code = typeof entry === 'string' ? entry : entry && entry.code
            if (!code || tagSeen.has(code)) continue
            tagSeen.add(code)
            tagCodes.push(code)
          }
          for (const task of [...activeTasks, ...archivedTasks]) {
            for (const code of task.tags || []) {
              if (!tagSeen.has(code)) {
                tagSeen.add(code)
                tagCodes.push(code)
              }
            }
          }
          tagCodes.sort((left, right) => left.localeCompare(right, localeCode))
          const tagNameByCode = new Map()
          for (const entry of tags || []) {
            if (!entry || typeof entry === 'string') continue
            if (entry.code) tagNameByCode.set(entry.code, entry.name || entry.code)
          }
          for (const code of tagCodes) if (!tagNameByCode.has(code)) tagNameByCode.set(code, code)
          const tagLabel = (code) => tagNameByCode.get(code) || code

          const personOptions = []
          const personSeen = new Set()
          const pushPerson = (name) => {
            const value = String(name || '').trim()
            const key = personKey(value)
            if (!key || personSeen.has(key)) return
            personSeen.add(key)
            personOptions.push(value)
          }
          if (mePerson) pushPerson(mePerson)
          for (const entry of people || []) pushPerson(entry && (entry.name || entry))
          for (const task of [...activeTasks, ...archivedTasks]) for (const name of taskPeople(task)) pushPerson(name)
          for (const name of selectedPeople) pushPerson(name)
          const peopleLabel =
            personFilter === null
              ? t('peopleMine')
              : selectedPeople.length === 0
                ? t('peopleAll')
                : selectedPeople.length <= 2
                  ? selectedPeople.join('、')
                  : t('peoplePick').replace('{n}', String(selectedPeople.length))
          const togglePerson = (name) => {
            const key = personKey(name)
            const current = selectedPeople.find((value) => personKey(value) === key)
            const next = current
              ? selectedPeople.filter((value) => personKey(value) !== key)
              : [...selectedPeople, name]
            setPersonFilter(next)
          }

          const stageList = sortNodes((stages || []).filter((entry) => entry && entry.code), 'default')
          for (const task of [...activeTasks, ...archivedTasks]) {
            const code = task.stageCode || 'default'
            if (!stageList.some((entry) => entry.code === code)) {
              stageList.push({ code, name: task.stageName || code, milestoneCode: task.milestoneCode || 'default', order: 900 })
            }
          }
          if (!stageList.some((entry) => entry.code === 'default')) {
            stageList.push({ code: 'default', name: t('inbox'), milestoneCode: 'default', order: Number.MAX_SAFE_INTEGER })
          }
          const sortedStages = sortNodes(stageList, 'default')
          const sortedMilestones = sortNodes((milestones || []).filter((entry) => entry && entry.code), 'default')
          const stageByCode = new Map(sortedStages.map((entry) => [entry.code, entry]))
          const milestoneByCode = new Map(sortedMilestones.map((entry) => [entry.code, entry]))

          const stageNodeOf = (task) => stageByCode.get(task.stageCode || 'default') || null
          const milestoneCodeOf = (task) => {
            const stage = stageNodeOf(task)
            return task.milestoneCode || (stage && stage.milestoneCode) || 'default'
          }
          const milestoneNodeOf = (task) => milestoneByCode.get(milestoneCodeOf(task)) || null
          const matchesMilestoneFilter = (task) => !milestoneFilter || milestoneCodeOf(task) === milestoneFilter
          const matchesStageFilter = (task) => !stageFilter || (task.stageCode || 'default') === stageFilter
          const matchesFilters = (task) => matchesTag(task) && matchesPerson(task) && matchesSearch(task) && matchesMilestoneFilter(task) && matchesStageFilter(task)

          const filteredActive = activeTasks.filter((task) => matchesFilters(task))
          const filteredArchived = archivedTasks.filter((task) => matchesFilters(task))
          const hasFilters = Boolean(search.trim() || tagFilter || milestoneFilter || stageFilter)
          const stageOptions = sortNodes(sortedStages.filter((entry) => !milestoneFilter || entry.milestoneCode === milestoneFilter), 'default')

          const matchesTabFor = (task, tabKey) => {
            if (tabKey === 'ready') return isReadyOf(task)
            if (tabKey === 'doing') return task.status === 'doing'
            if (tabKey === 'blocked') return effectiveOf(task) === 'blocked'
            return true
          }
          const visibleInTab = (task, tabKey) => matchesFilters(task) && matchesTabFor(task, tabKey)
          const rowVisible = (task, tabKey) => visibleInTab(task, tabKey) || childrenOf(task).some((child) => rowVisible(child, tabKey))

          const tabCounts = {
            all: filteredActive.length,
            ready: filteredActive.filter((task) => isReadyOf(task)).length,
            doing: filteredActive.filter((task) => task.status === 'doing').length,
            blocked: filteredActive.filter((task) => effectiveOf(task) === 'blocked').length,
            done: filteredActive.filter((task) => task.status === 'done').length,
            archived: filteredArchived.length,
          }

          useEffect(() => {
            if (!board || tabInitialized.current) return
            tabInitialized.current = true
            const preferred = config.defaultTab || 'auto'
            if (preferred !== 'auto' && TABS.includes(preferred)) {
              setTab(preferred)
              return
            }
            const doing = activeTasks.filter((task) => task.status === 'doing').length
            const ready = activeTasks.filter((task) => isReadyOf(task)).length
            if (doing > 0) setTab('doing')
            else if (ready > 0) setTab('ready')
            else setTab('all')
          }, [board, config, activeTasks])

          const changeMilestoneFilter = (value) => {
            setMilestoneFilter(value)
            if (value && stageFilter) {
              const stage = stageByCode.get(stageFilter)
              if (!stage || stage.milestoneCode !== value) setStageFilter('')
            }
          }

          const toggleGroup = (code) => {
            setClosedGroups((previous) => {
              const next = new Set(previous)
              if (next.has(code)) next.delete(code)
              else next.add(code)
              return next
            })
          }

          const toggleStage = (code) => {
            setClosedStages((previous) => {
              const next = new Set(previous)
              if (next.has(code)) next.delete(code)
              else next.add(code)
              return next
            })
          }

          const changeView = (value) => {
            const next = VIEW_MODES.includes(value) ? value : 'auto'
            setViewMode(next)
            writeStoredView(next)
          }

          const changePage = (value) => {
            const next = value === 'tree' ? 'tree' : 'board'
            setPage(next)
            writeStoredPage(next)
          }

          const toggleTreeNode = (key) => {
            setTreeCollapsed((previous) => {
              const next = new Set(previous)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }

          const toggleGraphLane = (key) => {
            setGraphFolded((previous) => {
              const next = new Set(previous)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }

          const openDetail = async (taskId) => {
            setDetailId(taskId)
            setDetail(null)
            try {
              const data = await call('/task' + query + '&id=' + encodeURIComponent(taskId))
              if (!mounted.current) return
              setDetail(data)
            } catch (cause) {
              setNotice({ kind: 'err', text: cause.message || String(cause) })
            }
          }

          const closeDetail = () => {
            setDetailId('')
            setDetail(null)
          }

          const startTask = async (task) => {
            if (!needHolder()) return null
            const result = await run({ action: 'start', id: task.id, by: holder.trim() })
            if (result && result.brief) setBrief({ task: result.task || task, brief: result.brief })
            return result
          }

          const openDone = async (task) => {
            if (!needHolder()) return
            let force = false
            if (task.holder && task.holder !== holder.trim()) {
              if (!window.confirm(t('confirmForce'))) return
              force = true
            }
            const requestId = versionRequest.current + 1
            versionRequest.current = requestId
            setDoneTarget({ task, force })
            setDoneVersion('')
            setDoneEvidence('')
            setDoneHint({ kind: 'info', text: t('versionFetching') })
            try {
              const data = await call('/version' + query)
              if (!mounted.current || versionRequest.current !== requestId) return
              if (data && data.version) {
                setDoneVersion(String(data.version))
                setDoneHint({ kind: 'info', text: data.message || `${t('versionLabel')} ${data.version}` })
              } else {
                setDoneHint({ kind: 'err', text: (data && data.message) || t('versionMissingHint') })
              }
            } catch {
              if (!mounted.current || versionRequest.current !== requestId) return
              setDoneHint({ kind: 'err', text: t('versionFetchFailed') })
            }
          }

          const closeDone = () => {
            versionRequest.current += 1
            setDoneTarget(null)
            setDoneVersion('')
            setDoneEvidence('')
            setDoneHint(null)
          }

          const confirmDone = async () => {
            if (!doneTarget) return
            const version = doneVersion.trim()
            if (versionRequired && !version) {
              setDoneHint({ kind: 'err', text: t('versionNeeded') })
              return
            }
            const payload = { action: 'done', id: doneTarget.task.id, by: holder.trim(), force: doneTarget.force === true }
            if (version) payload.version = version
            const evidence = doneEvidence.trim()
            if (evidence) payload.evidence = evidence
            const result = await run(payload)
            if (result) {
              closeDone()
              if (result.milestone && result.milestone.complete && result.milestone.archivable !== false) {
                setNotice({ kind: 'ok', text: t('milestoneComplete').replace('{name}', result.milestone.name || result.milestone.code) })
              }
            }
          }

          const unblock = (task) => run({ action: 'unblock', id: task.id, by: holder.trim() })

          const openAssign = (task) => setAssign({ task, value: task.holder || '' })
          const closeAssign = () => setAssign(null)
          const confirmAssign = async () => {
            if (!assign) return null
            const value = assign.value.trim()
            if (!value) {
              setNotice({ kind: 'err', text: t('needPerson') })
              return null
            }
            const result = await run({ action: 'claim', id: assign.task.id, by: value, holder: value, person: holder.trim() || undefined, force: true })
            if (result) {
              const taskId = assign.task.id
              setAssign(null)
              if (detailId && detailId === taskId) openDetail(taskId)
            }
            return result
          }

          const releaseOwn = async (task) => {
            if (!needHolder()) return null
            let note = ''
            try {
              if (typeof window.prompt === 'function') note = window.prompt(t('releaseNote'), '') || ''
            } catch {
              note = ''
            }
            const by = holder.trim()
            const result = await run({ action: 'release', id: task.id, by, force: Boolean(task.holder && task.holder !== by), note: note || undefined })
            if (result && detailId === task.id) openDetail(task.id)
            return result
          }

          const quickAdd = async () => {
            const title = quickTitle.trim()
            if (!title) return
            const result = await run({
              action: 'create',
              title,
              priority: quickPriority,
              urgency: quickUrgency,
              stageCode: quickStage || 'default',
              tags: tagFilter ? [tagFilter] : [],
              holder: holder.trim() || undefined,
              by: holder.trim() || 'ui',
            })
            if (result) {
              setQuickTitle('')
              if (result.message) setNotice({ kind: 'ok', text: result.message })
            }
          }

          const archiveOne = async (task) => {
            if (!task) return null
            const result = await run({ action: 'archive', id: task.id })
            if (result && detailId === task.id) closeDetail()
            return result
          }

          const archiveDoneBatch = async () => {
            const ids = doneTasks.map((task) => task.id)
            if (!ids.length) {
              setNotice({ kind: 'err', text: t('archiveNoTarget') })
              return null
            }
            if (typeof window.confirm === 'function' && !window.confirm(t('archiveConfirm').replace('{n}', String(ids.length)))) return null
            const result = await run({ action: 'archive_batch', ids })
            if (result) {
              const skipped = (result.skipped || []).length
              setNotice({
                kind: 'ok',
                text:
                  t('archiveDone').replace('{n}', String((result.moved || []).length)) +
                  (skipped ? t('archiveSkipped').replace('{n}', String(skipped)) : ''),
              })
            }
            return result
          }

          const downloadExport = async (format, scope) => {
            try {
              const response = await window.fetch(`${BASE}/export?sessionId=${encodeURIComponent(sessionId || '')}&format=${format}&scope=${scope}`, {
                headers: Object.assign({ 'x-dsh-project-task-client': '1' }, TOKEN ? { 'x-dsh-project-task-token': TOKEN } : {}),
              })
              const contentType = response.headers.get('content-type') || ''
              if (!response.ok || contentType.includes('application/json')) {
                // The host answers failures with a JSON body; surface the real
                // message instead of downloading it under an .xlsx extension.
                let message = `HTTP ${response.status}`
                try {
                  const payload = await response.json()
                  if (payload && payload.message) message = payload.message
                } catch {
                  /* keep the HTTP status text */
                }
                throw new Error(message)
              }
              const blob = await response.blob()
              const disposition = response.headers.get('content-disposition') || ''
              const match = /filename="([^"]+)"/.exec(disposition)
              const filename = match ? decodeURIComponent(match[1]) : `tasks-${scope}.${format}`
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = filename
              document.body.appendChild(anchor)
              anchor.click()
              anchor.remove()
              URL.revokeObjectURL(url)
              setNotice({ kind: 'ok', text: t('exportDone') })
            } catch (cause) {
              setNotice({ kind: 'err', text: cause.message || String(cause) })
            } finally {
              setExportOpen(false)
            }
          }

          const visibleRoots = sortTasksFor(activeTasks.filter((task) => !task.parentId && rowVisible(task, tab)), sort)
          const doneTasks = sortTasksFor(filteredActive.filter((task) => task.status === 'done'), sort)
          const archivedList = sortTasksFor(filteredArchived, sort)

          // Time-based sorts must also order the hierarchy: roots are already
          // sorted, but grouping re-bucketed them in organization order, so on a
          // board with many small stages the list looked untouched. Each level now
          // leads with the bucket holding the best task under the active key; the
          // default inbox stays pinned last (SPEC §7 收件箱置底).
          const compareSortKey = comparatorFor(sort)
          const compareBuckets = (left, right, nodeOf) => {
            const leftNode = nodeOf(left)
            const rightNode = nodeOf(right)
            const leftInbox = leftNode.code === 'default'
            const rightInbox = rightNode.code === 'default'
            if (leftInbox !== rightInbox) return leftInbox ? 1 : -1
            if (sort !== 'priority') {
              const byBest = compareSortKey(left.best, right.best)
              if (byBest !== 0) return byBest
            }
            return compareNodes(leftNode, rightNode, 'default')
          }

          const buildGroups = (roots) => {
            const byMilestone = new Map()
            for (const task of roots) {
              const stageCode = task.stageCode || 'default'
              const stage = stageByCode.get(stageCode) || {
                code: stageCode,
                name: task.stageName || stageCode,
                milestoneCode: task.milestoneCode || 'default',
                status: 'active',
                effectiveStatus: 'active',
                order: 900,
              }
              const milestoneCode = task.milestoneCode || stage.milestoneCode || 'default'
              const milestone = milestoneByCode.get(milestoneCode) || {
                code: milestoneCode,
                name: task.milestoneName || milestoneCode,
                status: 'active',
                effectiveStatus: 'active',
                order: 999,
              }
              let entry = byMilestone.get(milestoneCode)
              if (!entry) {
                // `best` is the first task of the bucket in the already-sorted roots.
                entry = { milestone, stages: new Map(), best: task }
                byMilestone.set(milestoneCode, entry)
              }
              let bucket = entry.stages.get(stageCode)
              if (!bucket) {
                bucket = { stage, roots: [], best: task }
                entry.stages.set(stageCode, bucket)
              }
              bucket.roots.push(task)
            }
            return [...byMilestone.values()]
              .sort((left, right) => compareBuckets(left, right, (entry) => entry.milestone))
              .map((entry) => ({
                milestone: entry.milestone,
                stages: [...entry.stages.values()].sort((left, right) => compareBuckets(left, right, (bucket) => bucket.stage)),
              }))
          }

          // Group counts/progress follow the active filters (people included); the
          // count badge shows what the current tab displays, progress uses the
          // filtered active+archived set so it stays stable across tabs.
          const tabShows = (task) => {
            if (tab === 'done') return task.status === 'done'
            if (tab === 'archived') return false
            return tab === 'all' ? true : matchesTabFor(task, tab)
          }
          const statsOf = (predicate) => {
            const scoped = [...filteredActive, ...filteredArchived].filter(predicate)
            return {
              done: scoped.filter((task) => task.status === 'done').length,
              total: scoped.length,
              shown: filteredActive.filter((task) => predicate(task) && tabShows(task)).length,
            }
          }
          const groups = buildGroups(visibleRoots).map((group) => {
            const milestoneCode = group.milestone.code
            return {
              milestone: group.milestone,
              stats: statsOf((task) => milestoneCodeOf(task) === milestoneCode),
              stages: group.stages.map((entry) => ({
                stage: entry.stage,
                roots: entry.roots,
                stats: statsOf((task) => milestoneCodeOf(task) === milestoneCode && (task.stageCode || 'default') === entry.stage.code),
              })),
            }
          })
          const tableColumns = 9

          // A single default milestone/stage carries no hierarchy, so auto stays flat;
          // an explicit choice always wins.
          const orgMilestoneCodes = new Set(activeTasks.map((task) => milestoneCodeOf(task)))
          const orgStageCodes = new Set(activeTasks.map((task) => task.stageCode || 'default'))
          const hasOrgHierarchy =
            [...orgMilestoneCodes].some((code) => code !== 'default') ||
            [...orgStageCodes].some((code) => code !== 'default')
          const grouped = viewMode === 'auto' ? hasOrgHierarchy : viewMode === 'grouped'
          const viewHint = viewMode === 'auto' ? (grouped ? t('viewAutoGrouped') : t('viewAutoFlat')) : t('viewHint')

          const tableHead = (groupedTable) =>
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', { key: 'status' }, t('status')),
                h('th', { key: 'id' }, 'ID'),
                h('th', { key: 'title' }, t('taskTitle')),
                h('th', { key: 'priority' }, t('priority')),
                h('th', { key: 'urgency' }, t('urgency')),
                h('th', { key: 'org' }, t('milestoneStage')),
                h('th', { key: 'owner' }, t('owner')),
                h('th', { key: 'updated' }, t('updatedTime')),
                h('th', { key: 'actions' }, t('actions')),
              ),
            )

          const taskRow = (task, depth, mode) => {
            const inGroup = mode === 'grouped'
            const listOnly = mode === 'done' || mode === 'archived'
            const children = listOnly ? [] : childrenOf(task)
            const isContainer = children.length > 0
            if (!listOnly && !rowVisible(task, tab)) return []
            const isCollapsed = collapsed.has(task.id)
            const effective = effectiveOf(task)
            const deps = (task.dependsOn || []).length
            const unmetPres = (task.preconditions || []).filter((pre) => pre.required !== false && pre.satisfied !== true).length
            const stage = stageNodeOf(task)
            const milestone = milestoneNodeOf(task)
            const orgText = `${milestone ? nodeName(milestone) : '—'} · ${stage ? nodeName(stage) : '—'}`
            const orgTitle = `${milestone ? milestone.code : '—'} · ${stage ? stage.code : '—'}`
            const canAct = !listOnly
            const canAssign = canAct && task.status !== 'done' && task.status !== 'cancelled' && !isContainer

            const primary =
              !canAct || isContainer
                ? null
                : task.status === 'doing'
                  ? h('button', { className: 'dpt-btn dpt-btn--success', disabled: busy, onClick: (event) => { event.stopPropagation(); openDone(task) } }, t('done'))
                  : task.status === 'blocked'
                    ? h('button', { className: 'dpt-btn', disabled: busy, onClick: (event) => { event.stopPropagation(); unblock(task) } }, t('unblock'))
                    : task.status === 'open' && isReadyOf(task)
                      ? h('button', { className: 'dpt-btn dpt-btn--primary', disabled: busy, onClick: (event) => { event.stopPropagation(); startTask(task) } }, t('startAction'))
                      : null

            const actions = []
            if (primary) actions.push(primary)
            if (canAssign) {
              actions.push(
                h('button', { className: 'dpt-btn dpt-btn--ghost', disabled: busy, onClick: (event) => { event.stopPropagation(); openAssign(task) } }, t('assign')),
              )
            }
            if (mode === 'done' && task.status === 'done') {
              actions.push(
                h('button', { className: 'dpt-btn dpt-btn--ghost', disabled: busy, onClick: (event) => { event.stopPropagation(); archiveOne(task) } }, t('archive')),
              )
            }
            actions.push(h('button', { className: 'dpt-btn dpt-btn--ghost', onClick: (event) => { event.stopPropagation(); openDetail(task.id) } }, t('detail')))

            const row = h(
              'tr',
              {
                className:
                  `dpt-task dpt-task--${task.status} dpt-task--${String(task.priority || 'P2').toLowerCase()}` +
                  (inGroup ? ' dpt-task--grouped' : '') +
                  (depth > 0 ? ' dpt-task--child' : ''),
                key: task.id,
                onClick: () => openDetail(task.id),
              },
              h(
                'td',
                { className: 'dpt-cell dpt-cell--status' },
                h('span', { className: 'dpt-dot dpt-dot--' + effective, title: statusLabel(effective) }),
                h('span', { className: 'dpt-status-text' }, statusLabel(effective)),
              ),
              h('td', { className: 'dpt-cell dpt-cell--id' }, h('span', { className: 'dpt-code' }, task.id)),
              h(
                'td',
                { className: 'dpt-cell dpt-cell--title' },
                h(
                  'div',
                  { className: 'dpt-title-cell', style: { paddingLeft: (inGroup ? 44 : 0) + depth * 16 } },
                  isContainer
                    ? h(
                        'button',
                        {
                          className: 'dpt-caret',
                          onClick: (event) => {
                            event.stopPropagation()
                            setCollapsed((previous) => {
                              const next = new Set(previous)
                              if (next.has(task.id)) next.delete(task.id)
                              else next.add(task.id)
                              return next
                            })
                          },
                        },
                        isCollapsed ? '▸' : '▾',
                      )
                    : null,
                  h('span', { className: 'dpt-task-title-text', title: task.title }, task.title),
                  deps ? h('span', { className: 'dpt-mark', title: t('blockedReasonDependency') }, `⛓ ${deps}`) : null,
                  unmetPres ? h('span', { className: 'dpt-mark dpt-mark--warn', title: t('blockedReasonPrecondition') }, `⏳ ${unmetPres}`) : null,
                  task.status === 'done' && taskVersion(task)
                    ? h('span', { className: 'dpt-version' }, `${t('versionLabel')} ${taskVersion(task)}`)
                    : null,
                  (task.tags || []).map((tag) => h('span', { className: 'dpt-tag', key: tag, title: tag }, tagLabel(tag))),
                ),
              ),
              h('td', { className: 'dpt-cell' }, h('span', { className: 'dpt-badge dpt-badge--' + task.priority }, task.priority)),
              h('td', { className: 'dpt-cell' }, h('span', { className: 'dpt-badge dpt-badge--urgency' }, urgencyLabel(task.urgency))),
              h('td', { className: 'dpt-cell dpt-cell--org', title: orgTitle }, orgText),
              h(
                'td',
                {
                  className: 'dpt-cell dpt-cell--owner',
                  title: `${t('owner')} ${task.holder || '—'}${task.doneBy ? ` · ${t('doneBy')} ${task.doneBy}` : ''}`,
                },
                mode === 'done' && task.doneBy ? task.doneBy : task.holder || task.doneBy || '—',
              ),
              h('td', { className: 'dpt-cell dpt-cell--time', title: task.updatedAt || '' }, shortTime(task.updatedAt || task.statusChangedAt)),
              h('td', { className: 'dpt-cell dpt-cell--actions' }, h('div', { className: 'dpt-task-actions' }, actions)),
            )
            const output = [row]
            if (isContainer && !isCollapsed) {
              output.push(...children.flatMap((child) => taskRow(child, depth + 1, mode)))
            }
            return output
          }

          const renderGroupsTable = () => {
            const rows = []
            for (const group of groups) {
              const closed = closedGroups.has(group.milestone.code)
              const groupStats = group.stats || { done: 0, total: 0, shown: 0 }
              const count = groupStats.shown
              const total = groupStats.total
              const done = groupStats.done
              const pct = Number.isFinite(total) && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
              const progressLabel = total > 0 ? `${done}/${total}` : ''
              rows.push(
                h(
                  'tr',
                  { className: 'dpt-group dpt-group--milestone', key: 'G::' + group.milestone.code, onClick: () => toggleGroup(group.milestone.code) },
                  h(
                    'td',
                    { colSpan: tableColumns },
                    h(
                      'div',
                      { className: 'dpt-group-head' },
                      h(
                        'button',
                        {
                          className: 'dpt-group-caret',
                          'aria-expanded': !closed,
                          onClick: (event) => {
                            event.stopPropagation()
                            toggleGroup(group.milestone.code)
                          },
                        },
                        closed ? '▸' : '▾',
                      ),
                      h('span', { className: 'dpt-group-name', title: group.milestone.code }, nodeName(group.milestone)),
                      group.milestone.code ? h('span', { className: 'dpt-node-code' }, group.milestone.code) : null,
                      group.milestone.effectiveStatus
                        ? h('span', { className: 'dpt-badge ' + orgBadgeClass(group.milestone.effectiveStatus) }, orgStatusLabel(group.milestone.effectiveStatus))
                        : null,
                      h('span', { className: 'dpt-group-count' }, `${count} ${t('taskUnit')}`),
                      total > 0
                        ? h('span', { className: 'dpt-progress', title: progressLabel }, h('span', { className: 'dpt-progress-fill', style: { width: `${pct}%` } }))
                        : null,
                      progressLabel ? h('span', { className: 'dpt-group-progress' }, progressLabel) : null,
                    ),
                  ),
                ),
              )
              if (closed) continue
              for (const entry of group.stages) {
                const stageState = entry.stage.effectiveStatus || entry.stage.status
                const blocked = entry.stage.effectiveStatus === 'blocked_by_upstream'
                const stageClosed = closedStages.has(entry.stage.code)
                const stageStats = entry.stats || { done: 0, total: 0, shown: 0 }
                const stageProgressLabel = stageStats.total > 0 ? `${stageStats.done}/${stageStats.total}` : ''
                rows.push(
                  h(
                    'tr',
                    { className: 'dpt-stage-row', key: 'S::' + entry.stage.code, onClick: () => toggleStage(entry.stage.code) },
                    h(
                      'td',
                      { colSpan: tableColumns },
                      h(
                        'div',
                        { className: 'dpt-stage-head' },
                        h(
                          'button',
                          {
                            className: 'dpt-group-caret',
                            'aria-expanded': !stageClosed,
                            onClick: (event) => {
                              event.stopPropagation()
                              toggleStage(entry.stage.code)
                            },
                          },
                          stageClosed ? '▸' : '▾',
                        ),
                        h('span', { className: 'dpt-stage-name', title: entry.stage.code }, nodeName(entry.stage)),
                        entry.stage.code ? h('span', { className: 'dpt-node-code' }, entry.stage.code) : null,
                        blocked
                          ? h('span', { className: 'dpt-mark dpt-mark--warn', title: t('statusBlockedUpstream') }, '⚠')
                          : stageState && stageState !== 'active'
                            ? h('span', { className: 'dpt-badge ' + orgBadgeClass(stageState) }, orgStatusLabel(stageState))
                            : null,
                        h('span', { className: 'dpt-group-count' }, `${stageStats.shown} ${t('taskUnit')}`),
                        stageProgressLabel ? h('span', { className: 'dpt-group-progress' }, stageProgressLabel) : null,
                      ),
                    ),
                  ),
                )
                if (stageClosed) continue
                rows.push(...entry.roots.flatMap((task) => taskRow(task, 0, 'grouped')))
              }
            }
            return h('div', { className: 'dpt-table-wrap' }, h('table', { className: 'dpt-table dpt-table--grouped' }, tableHead(true), h('tbody', null, rows)))
          }

          const renderFlatTable = (tasks, mode) =>
            h(
              'div',
              { className: 'dpt-table-wrap' },
              h('table', { className: 'dpt-table dpt-table--flat' }, tableHead(false), h('tbody', null, tasks.flatMap((task) => taskRow(task, 0, mode)))),
            )

          const lineRows = (items, render) =>
            items && items.length
              ? h(
                  'div',
                  { className: 'dpt-lines' },
                  items.map((item, index) =>
                    h(
                      'div',
                      { className: 'dpt-line', key: index },
                      h('span', { className: 'dpt-line-index' }, `${index + 1}.`),
                      h('span', { className: 'dpt-line-body' }, render(item)),
                    ),
                  ),
                )
              : h('span', { className: 'dpt-mark' }, '—')

          const detailSection = (title, content) => h('div', { className: 'dpt-detail-section' }, h('div', { className: 'dpt-section-title' }, title), content)

          const flowTone = (action) => {
            if (action === 'done') return 'done'
            if (action === 'block') return 'blocked'
            if (action === 'create') return 'open'
            if (action === 'archive' || action === 'auto_archive') return 'archived'
            if (action === 'claim' || action === 'start' || action === 'reopen' || action === 'unblock' || action === 'claim_batch') return 'doing'
            return 'idle'
          }

          /** History as a vertical flow: each hop carries the task's status change inline. */
          const renderHistoryFlow = (task, entries) => {
            const nodes = [...entries].reverse().map((entry, index) => {
              const transition = (entry.transitions || []).find((item) => item.id === task.id) || null
              const from = transition && transition.from ? statusLabel(transition.from) : ''
              const to = transition && transition.to ? statusLabel(transition.to) : ''
              return h(
                'div',
                { className: 'dpt-flow-step', key: 'H' + index },
                h('div', { className: 'dpt-flow-rail' }, h('span', { className: 'dpt-flow-dot dpt-flow-dot--' + flowTone(entry.action) })),
                h(
                  'div',
                  { className: 'dpt-flow-body' },
                  h(
                    'div',
                    { className: 'dpt-flow-head' },
                    h('span', { className: 'dpt-flow-action' }, actionLabel(entry.action)),
                    h('span', { className: 'dpt-flow-actor' }, entry.by || '—'),
                    from || to
                      ? h(
                          'span',
                          { className: 'dpt-flow-transition' },
                          from ? h('span', { className: 'dpt-flow-chip' }, from) : null,
                          from && to ? h('span', { className: 'dpt-flow-arrow' }, '→') : null,
                          to ? h('span', { className: 'dpt-flow-chip dpt-flow-chip--to' }, to) : null,
                        )
                      : null,
                    h('span', { className: 'dpt-flow-time' }, shortTime(entry.at)),
                  ),
                ),
              )
            })
            return h('div', { className: 'dpt-flow' }, nodes)
          }

        const DT_TONE = {
          ok: 'var(--dsw-alias-state-success-primary)',
          partial: 'var(--dsw-alias-state-warn-primary)',
          block: 'var(--dsw-alias-state-error-primary)',
          neutral: 'var(--dsw-alias-label-secondary)',
          doing: 'var(--dsw-alias-brand-primary)',
        }
        const dtStatusTone = (status) => ({
          done: DT_TONE.ok,
          doing: DT_TONE.doing,
          blocked: DT_TONE.partial,
          open: DT_TONE.neutral,
          cancelled: DT_TONE.neutral,
          archived: DT_TONE.neutral,
        })[status] || DT_TONE.neutral
        const dtStatusIcon = (status) => ({
          done: 'check', doing: 'activity', blocked: 'warning', open: 'circle', cancelled: 'x', archived: 'archive',
        })[status] || 'circle'
        const dtIconPaths = {
          target: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 12h.01'],
          activity: ['M3 12h4l2-6 4 12 2-6h6'],
          check: ['m5 12 4 4L19 6'],
          checkcircle: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'm8 12 3 3 5-6'],
          warning: ['M10.3 4.1 2.2 18.2a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z', 'M12 9v4', 'M12 17h.01'],
          file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6', 'M8 13h8', 'M8 17h6'],
          link: ['M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2', 'M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2'],
          history: ['M3 12a9 9 0 1 0 2.6-6.4L3 8', 'M3 3v5h5', 'M12 7.5V12l3 2'],
          user: ['M20 21a8 8 0 1 0-16 0', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
          flag: ['M5 21V4', 'M5 4h11l-2 4 2 4H5'],
          cube: ['M12 2 3 7v10l9 5 9-5V7Z', 'M3 7l9 5 9-5', 'M12 12v10'],
          calendar: ['M4 6h16v15H4Z', 'M8 3v6', 'M16 3v6', 'M4 11h16'],
          archive: ['M4 4h16v5H4Z', 'M6 9v11h12V9', 'M10 13h4'],
          layers: ['m12 2 9 5-9 5-9-5Z', 'm3 12 9 5 9-5', 'm3 17 9 5 9-5'],
          git: ['M6 3v12a3 3 0 0 0 3 3h9', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
          circle: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
          x: ['M6 6l12 12', 'M18 6 6 18'],
        }
        const dtIcon = (name) => {
          const paths = dtIconPaths[name] || dtIconPaths.circle
          return h('svg', {
            className: 'dpt-dt-ico', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
            strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
          }, paths.map((d, index) => h('path', { key: index, d })))
        }
        const dtChip = (label, value, tone, title, iconName, extraClass) => h(
          'span',
          { className: 'dpt-dt-chip' + (extraClass ? ' ' + extraClass : ''), style: { '--tone': tone || DT_TONE.neutral }, title: title || undefined },
          iconName ? dtIcon(iconName) : null,
          label ? h('span', { className: 'dpt-dt-chip-label' }, label) : null,
          value === undefined || value === null ? null : h('b', null, String(value)),
        )
        const dtInfoCard = (kind, label, iconName, text) => h(
          'section',
          { className: 'dpt-dt-info dpt-dt-info--' + kind },
          h('div', { className: 'dpt-dt-info-head' }, dtIcon(iconName), h('span', null, label)),
          h('div', { className: 'dpt-dt-info-body' }, text || '—'),
        )
        const dtSectionCard = (key, label, iconName, count, content, warn) => h(
          'section',
          { className: 'dpt-dt-card', 'data-section': key },
          h(
            'div',
            { className: 'dpt-dt-card-head' },
            dtIcon(iconName),
            h('span', { className: 'dpt-dt-card-title' }, label),
            count ? h('span', { className: 'dpt-dt-count' + (warn ? ' dpt-dt-count--warn' : '') }, String(count)) : null,
          ),
          h('div', { className: 'dpt-dt-card-body' }, content),
        )
        const dtStatusSequence = (task, entries) => {
          // 最近变更按时间倒序：只展示最近 5 条，最新状态排在最前。
          const list = [...(entries || [])].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 5)
          if (!list.length) return h('div', { className: 'dpt-dt-empty' }, t('noExtraInfo'))
          const steps = list.map((entry, index) => {
            const transition = (entry.transitions || []).find((item) => item.id === task.id) || null
            const archive = entry.action === 'archive' || entry.action === 'auto_archive'
            const to = transition && transition.to ? transition.to : (archive ? 'archived' : '')
            const status = to || (index === 0 ? task.status : '')
            const tone = dtStatusTone(status)
            const iconName = dtStatusIcon(status)
            const latest = index === 0
            return h(
              'div',
              { className: 'dpt-flow-step dpt-dt-seq-step' + (latest ? ' dpt-dt-seq-step--last' : ''), style: { '--tone': tone }, key: 'S' + index },
              h('div', { className: 'dpt-dt-seq-time' }, shortTime(entry.at)),
              h('div', { className: 'dpt-dt-seq-rail' }, h('span', { className: 'dpt-dt-seq-dot' }, dtIcon(iconName))),
              h(
                'div',
                { className: 'dpt-dt-seq-card' },
                h('div', { className: 'dpt-dt-seq-state' }, dtIcon(iconName), h('span', null, status ? statusLabel(status) : actionLabel(entry.action)), latest ? h('em', null, t('latest')) : null),
                h('div', { className: 'dpt-dt-seq-meta' }, h('span', null, actionLabel(entry.action)), h('span', { className: 'dpt-dt-seq-user', title: entry.by || '' }, entry.by || '—')),
              ),
            )
          })
          return h('div', { className: 'dpt-flow dpt-dt-sequence' }, h('div', { className: 'dpt-dt-seq-canvas' }, steps))
        }
        const dtRelationGraph = (task, detail) => {
          const deps = task.dependsOn || []
          const blocking = detail.blocking || task.blocking || []
          const children = detail.children || []
          const pre = detail.preconditions || task.preconditions || []
          const boardIndex = new Map(((detail.board && detail.board.tasks) || (board && board.tasks) || []).map((entry) => [entry.id, entry]))
          const archiveIndex = new Map(archivedTasks.map((entry) => [entry.id, entry]))
          const statusOf = (id) => {
            const found = boardIndex.get(id) || archiveIndex.get(id)
            return found ? statusLabel(found.status) + (archiveIndex.has(id) ? ' · ' + t('archivedShort') : '') : t('missingTask')
          }
          const taskNode = (entry) => ({
            kind: 'task', id: entry.id, title: entry.title, status: entry.status,
            meta: statusOf(entry.id), tone: dtStatusTone(entry.status),
          })
          const orgNode = (node, icon) => ({
            kind: 'org', id: node.code, icon, title: nodeName(node),
            status: node.status || '',
            meta: orgStatusLabel(node.status) + (node.code && node.code !== 'default' ? ' · ' + node.code : ''),
            tone: DT_TONE.doing,
          })
          const milestone = detail.milestone || null
          const group = detail.stage || null
          const lanes = []
          if (milestone) lanes.push({ key: 'milestone', role: t('milestone'), title: nodeName(milestone), tone: DT_TONE.doing, hierarchy: true, items: [orgNode(milestone, 'flag')] })
          if (group) lanes.push({ key: 'group', role: t('group'), title: nodeName(group), tone: DT_TONE.doing, hierarchy: true, items: [orgNode(group, 'cube')] })
          if (detail.parent) lanes.push({ key: 'parent', role: zh ? '父级' : 'Parent', title: t('parent'), tone: DT_TONE.neutral, structural: true, items: [taskNode(detail.parent)] })
          if (deps.length) lanes.push({
            key: 'deps', role: t('upstream'), title: t('sectionDependencies'), tone: deps.every((dep) => statusOf(dep.id).indexOf(statusLabel('done')) === 0) ? DT_TONE.ok : DT_TONE.partial,
            items: deps.map((dep) => ({ kind: 'task', id: dep.id, title: (boardIndex.get(dep.id) || archiveIndex.get(dep.id) || {}).title || dep.id, status: (boardIndex.get(dep.id) || archiveIndex.get(dep.id) || {}).status, meta: statusOf(dep.id) + (dep.note ? ' · ' + dep.note : ''), tone: dtStatusTone((boardIndex.get(dep.id) || archiveIndex.get(dep.id) || {}).status) })),
          })
          if (pre.length) {
            const ok = pre.filter((item) => item.satisfied === true).length
            lanes.push({
              key: 'pre', role: t('system'), title: t('sectionPreconditions'), tone: ok === pre.length ? DT_TONE.ok : ok ? DT_TONE.partial : DT_TONE.block,
              items: [{ kind: 'pre', title: t('sectionPreconditions'), meta: ok + '/' + pre.length, tone: ok === pre.length ? DT_TONE.ok : ok ? DT_TONE.partial : DT_TONE.block }],
            })
          }
          lanes.push({ key: 'current', role: zh ? '当前' : 'Current', title: t('thisTask'), tone: dtStatusTone(task.status), current: true, items: [{ kind: 'current' }] })
          if (blocking.length) lanes.push({
            key: 'blocks', role: t('downstream'), title: t('sectionBlocking'), tone: DT_TONE.block,
            items: blocking.map((entry) => ({ kind: 'task', id: entry.id, title: (boardIndex.get(entry.id) || archiveIndex.get(entry.id) || {}).title || entry.id, status: (boardIndex.get(entry.id) || archiveIndex.get(entry.id) || {}).status, meta: statusOf(entry.id) + (entry.note ? ' · ' + entry.note : ''), tone: dtStatusTone((boardIndex.get(entry.id) || archiveIndex.get(entry.id) || {}).status) })),
          })
          if (children.length) lanes.push({ key: 'children', role: zh ? '子级' : 'Child', title: t('children'), tone: DT_TONE.neutral, structural: true, items: children.map(taskNode) })
          if (lanes.length <= 1) return h('div', { className: 'dpt-dt-empty' }, t('noRelations'))
          const W = 1080, LANE_X = 16, LANE_W = W - LANE_X * 2, TOP = 34, GAP = 12, CENTER_X = W / 2
          const NODE_W = 158, STEP = 180, MAX_PER_ROW = 5, ROW_PAD = 12, FOLD_AT = 3
          // 泳道高度和节点位置随内容计算：默认全部展开、超出换行；节点较多时可手动折叠为摘要。
          lanes.forEach((lane) => {
            lane.total = lane.items.length
            lane.foldable = lane.total > FOLD_AT && !lane.current && !lane.hierarchy
            lane.folded = lane.foldable && graphFolded.has('graph:' + lane.key)
            if (lane.folded) lane.items = [{ kind: 'fold', count: lane.total, title: lane.title, tone: lane.tone }]
            lane.rows = Math.max(1, Math.ceil(lane.items.length / MAX_PER_ROW))
            lane.itemH = lane.current ? 96 : 66
            lane.rowH = lane.itemH + 16
            lane.h = ROW_PAD * 2 + lane.rows * lane.rowH
          })
          let cursorY = TOP
          const byKey = {}
          lanes.forEach((lane) => {
            lane.top = cursorY
            lane.bottom = cursorY + lane.h
            lane.cy = lane.top + lane.h / 2
            cursorY = lane.bottom + GAP
            byKey[lane.key] = lane
            lane.items.forEach((item, index) => {
              const row = Math.floor(index / MAX_PER_ROW)
              const rowCount = Math.min(MAX_PER_ROW, lane.items.length - row * MAX_PER_ROW)
              const column = index - row * MAX_PER_ROW
              item.w = lane.current ? 196 : lane.key === 'pre' ? 184 : NODE_W
              item.h = lane.itemH
              item.x = CENTER_X - (rowCount - 1) * STEP / 2 + column * STEP
              item.cy = lane.top + ROW_PAD + item.h / 2 + row * lane.rowH
            })
          })
          const H = cursorY - GAP + 12
          const cur = byKey.current
          const curNode = cur && cur.items[0]
          const edges = []
          const connect = (key, fromTop, label) => {
            const lane = byKey[key]
            if (!lane || !cur) return
            lane.items.forEach((item) => {
              const x1 = item.x
              const y1 = fromTop ? lane.bottom : cur.top
              const x2 = CENTER_X + (item.x - CENTER_X) * 0.7
              const y2 = fromTop ? cur.top : lane.bottom
              edges.push({ d: 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + ((y1 + y2) / 2) + ',' + x2 + ' ' + ((y1 + y2) / 2) + ',' + x2 + ' ' + y2, tone: item.tone, label, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2, arrow: true })
            })
          }
          connect('deps', true, t('sectionDependencies'))
          connect('blocks', false, t('sectionBlocking'))
          if (byKey.pre && cur) {
            const item = byKey.pre.items[0]
            const x1 = item.x + item.w / 2
            const x2 = curNode ? curNode.x - curNode.w / 2 : CENTER_X - 98
            edges.push({ d: 'M' + x1 + ' ' + item.cy + ' C' + (x1 + 50) + ' ' + item.cy + ',' + (x2 - 50) + ' ' + cur.cy + ',' + x2 + ' ' + cur.cy, tone: item.tone, label: '', lx: 0, ly: 0, arrow: true })
          }
          const structural = (key, fromCurrent) => {
            const lane = byKey[key]
            if (!lane || !cur) return
            lane.items.forEach((item) => {
              const busX = W - 24
              const curRight = curNode ? curNode.x + curNode.w / 2 : CENTER_X + 98
              const x1 = fromCurrent ? curRight : item.x + item.w / 2
              const y1 = fromCurrent ? cur.cy : item.cy
              const x2 = fromCurrent ? item.x + item.w / 2 : curRight
              const y2 = fromCurrent ? item.cy : cur.cy
              edges.push({ d: 'M' + x1 + ' ' + y1 + ' H' + busX + ' V' + y2 + ' H' + x2, tone: DT_TONE.neutral, label: '', lx: busX - 8, ly: (y1 + y2) / 2, arrow: false })
            })
          }
          structural('parent', false)
          structural('children', true)
          // 层级链：里程碑 → 分组 → 本任务 → 子任务，走左侧独立通道，不与父/子任务的右侧通道重叠。
          const hierarchyKeys = ['milestone', 'group', 'current', 'children']
          const hierarchyLanes = hierarchyKeys.map((key) => byKey[key]).filter(Boolean)
          for (let index = 0; index < hierarchyLanes.length - 1; index += 1) {
            const from = hierarchyLanes[index]
            const to = hierarchyLanes[index + 1]
            const a = from.items[0]
            const b = to.items[0]
            if (!a || !b) continue
            const railX = 8
            const y1 = a.cy
            const y2 = b.cy
            const fromEdge = a.x - a.w / 2
            const toEdge = b.x - b.w / 2
            edges.push({
              d: 'M' + fromEdge + ' ' + y1 + ' H' + railX + ' V' + y2 + ' H' + toEdge,
              tone: DT_TONE.doing, label: '', lx: railX, ly: (y1 + y2) / 2, arrow: true, dashed: true,
            })
          }
          const laneNodes = lanes.map((lane) => [
            h('div', { className: 'dpt-dt-glane', style: { left: LANE_X + 'px', top: lane.top + 'px', width: LANE_W + 'px', height: lane.h + 'px', '--tone': lane.tone }, key: 'lane-' + lane.key }),
            h('div', { className: 'dpt-dt-glane-cap', style: { left: LANE_X + 10 + 'px', top: lane.top + 13 + 'px', '--tone': lane.tone }, key: 'cap-' + lane.key },
              h('b', null, lane.role), h('span', null, lane.title), h('i', null, String(lane.total)),
              lane.foldable
                ? h('button', {
                    className: 'dpt-dt-glane-fold',
                    title: lane.folded ? t('graphExpand') : t('graphCollapse'),
                    onClick: (event) => { event.stopPropagation(); toggleGraphLane('graph:' + lane.key) },
                  }, lane.folded ? t('graphExpand') : t('graphCollapse'))
                : null,
            ),
          ])
          const nodeNodes = lanes.flatMap((lane) => lane.items.map((item) => {
            const clickable = item.id && (boardIndex.has(item.id) || archiveIndex.has(item.id))
            const className = 'dpt-dt-gnode' + (item.kind === 'current' ? ' dpt-dt-gnode--current' : clickable ? ' dpt-dt-gnode--link' : '')
            const style = { left: item.x + 'px', top: item.cy + 'px', width: item.w + 'px', minHeight: item.h + 'px', '--tone': item.tone }
            if (item.kind === 'pre') {
              return h('div', { className, style, key: 'node-pre' },
                h('div', { className: 'dpt-dt-gnode-top' }, h('span', null, t('sectionPreconditions')), h('span', { className: 'dpt-dt-gnode-dot' })),
                h('div', { className: 'dpt-dt-gnode-meta' }, item.meta + ' · ' + (okText(pre) || '')),
              )
            }
            if (item.kind === 'fold') {
              return h('div', {
                className: className + ' dpt-dt-gnode--fold', style, key: 'node-fold-' + lane.key,
                title: t('graphExpand'), onClick: () => toggleGraphLane('graph:' + lane.key),
              },
                h('div', { className: 'dpt-dt-gnode-tag' }, dtIcon('layers'), t('summary')),
                h('div', { className: 'dpt-dt-gnode-title' }, item.title),
                h('div', { className: 'dpt-dt-gnode-meta' }, String(item.count) + ' ' + (zh ? '项 · 点击展开' : 'items · expand')),
              )
            }
            if (item.kind === 'org') {
              return h('div', { className: className + ' dpt-dt-gnode--org', style, key: 'node-org-' + lane.key },
                h('div', { className: 'dpt-dt-gnode-tag' }, dtIcon(item.icon), lane.role),
                h('div', { className: 'dpt-dt-gnode-title' }, item.title),
                h('div', { className: 'dpt-dt-gnode-status' }, item.meta),
              )
            }
            if (item.kind === 'current') {
              return h('div', { className, style, key: 'node-current' },
                h('div', { className: 'dpt-dt-gnode-tag' }, dtIcon('target'), zh ? '当前任务' : 'Current'),
                h('div', { className: 'dpt-dt-gnode-id' }, task.id),
                h('div', { className: 'dpt-dt-gnode-title' }, task.title),
                h('div', { className: 'dpt-dt-gnode-status' }, statusLabel(task.status)),
              )
            }
            return h('div', { className, style, title: item.title, onClick: clickable ? () => openDetail(item.id) : undefined, key: 'node-' + (item.id || item.title) },
              h('div', { className: 'dpt-dt-gnode-top' }, h('span', { className: 'dpt-dt-gnode-id' }, item.id || ''), h('span', { className: 'dpt-dt-gnode-dot' })),
              h('div', { className: 'dpt-dt-gnode-title' }, item.title || item.id || '—'),
              h('div', { className: 'dpt-dt-gnode-meta' }, item.meta || ''),
            )
          }))
          const svg = h('svg', { className: 'dpt-dt-graph-svg', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H },
            h('defs', null, h('marker', { id: 'dpt-dt-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, h('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'context-stroke' }))),
            edges.map((edge, index) => h('path', { key: 'edge-' + index, d: edge.d, fill: 'none', stroke: edge.tone, strokeWidth: 1.5, strokeOpacity: .85, strokeDasharray: edge.dashed ? '4 3' : undefined, markerEnd: edge.arrow ? 'url(#dpt-dt-arrow)' : undefined })),
            edges.filter((edge) => edge.label).map((edge, index) => h('text', { key: 'label-' + index, className: 'dpt-dt-edge-label', x: edge.lx, y: edge.ly, textAnchor: 'middle', dominantBaseline: 'middle', style: { '--tone': edge.tone } }, edge.label)),
          )
          return h('div', { className: 'dpt-dt-graph-wrap' }, h('div', { className: 'dpt-dt-graph-canvas', style: { width: W + 'px', height: H + 'px' } }, laneNodes, svg, nodeNodes))
        }
        const okText = (pre) => {
          const ok = (pre || []).filter((item) => item.satisfied === true).length
          return ok + '/' + (pre || []).length
        }

        const buildDetailModal = () => {
          const task = detail.task
          const ctx = task.context || {}
          const decisions = ctx.decisions || []
          const openLoops = ctx.openLoops || []
          const resources = task.resources || []
          const commits = detail.relatedCommits || []
          const children = detail.children || []
          const archived = detail.archived === true || task.archived === true
          const statusTone = dtStatusTone(task.status)
          const stageText = detail.stage ? nodeName(detail.stage) : task.stageName || task.stageCode || 'default'
          const milestoneText = detail.milestone ? nodeName(detail.milestone) : task.milestoneName || task.milestoneCode || 'default'
          const flags = []
          if (archived) flags.push(dtChip(t('statusArchived'), t('archivedShort'), DT_TONE.neutral, '', 'archive', 'dpt-dt-chip--warn'))
          if (children.length) flags.push(dtChip(t('summary'), children.length + ' ' + t('children'), DT_TONE.neutral, '', 'layers'))
          if (task.effectiveStatus && task.effectiveStatus !== task.status) flags.push(dtChip(t('effectiveStatus'), statusLabel(task.effectiveStatus), dtStatusTone(task.effectiveStatus), '', 'warning', 'dpt-dt-chip--warn'))
          if ((task.blockers || []).length) flags.push(dtChip(t('blocked'), task.blockers.length, DT_TONE.block, '', 'warning', 'dpt-dt-chip--warn'))
          if (task.status === 'done') flags.push(dtChip(t('evidence'), t('done'), DT_TONE.ok, '', 'check'))
          const facts = [
            dtChip(t('status'), statusLabel(task.status), statusTone, '', dtStatusIcon(task.status), 'dpt-dt-chip--status'),
            ...flags,
            dtChip(t('owner'), task.holder || '—', DT_TONE.neutral, '', 'user'),
            dtChip(t('milestone'), milestoneText, DT_TONE.neutral, detail.milestone ? detail.milestone.code : task.milestoneCode || 'default', 'flag'),
            dtChip(t('stage'), stageText, DT_TONE.neutral, detail.stage ? detail.stage.code : task.stageCode || 'default', 'cube'),
            dtChip(t('updatedTime'), shortTime(task.updatedAt), DT_TONE.neutral, '', 'calendar'),
          ]
          if (task.status === 'done' && task.doneVersion) facts.push(dtChip(t('doneVersionLabel'), task.doneVersion + (task.doneAt ? ' · ' + shortTime(task.doneAt) : ''), DT_TONE.ok, '', 'check'))
          if (task.archivedAt) facts.push(dtChip(t('archivedAt'), shortTime(task.archivedAt), DT_TONE.neutral, '', 'archive'))
          if (children.length) {
            const doneChildren = children.filter((child) => child.status === 'done').length
            const pct = Math.round(doneChildren * 100 / children.length)
            facts.push(h('div', { className: 'dpt-dt-progress', key: 'progress' },
              h('div', { className: 'dpt-dt-ring', style: { '--pct': pct, '--tone': statusTone } }, h('i', null, pct + '%')),
              h('span', null, doneChildren + '/' + children.length + ' ' + t('children')),
            ))
          }
          const infos = []
          if (ctx.goal) infos.push(dtInfoCard('goal', t('sectionGoal'), 'target', ctx.goal))
          if (ctx.progress) infos.push(dtInfoCard('progress', t('sectionProgress'), 'activity', ctx.progress))
          if (task.status === 'done' && task.doneEvidence) infos.push(dtInfoCard('evidence', t('evidence'), 'check', task.doneEvidence))
          if (task.notes) infos.push(dtInfoCard('note', t('notes'), 'file', task.notes))
          const cards = []
          cards.push(dtSectionCard('relations', t('sectionRelations'), 'link', '', dtRelationGraph(task, detail)))
          if (decisions.length) cards.push(dtSectionCard('decisions', t('sectionDecisions'), 'checkcircle', decisions.length,
            h('ol', { className: 'dpt-dt-decisions' }, decisions.map((entry, index) => h('li', { className: 'dpt-dt-decision', key: 'D' + index },
              h('span', { className: 'dpt-dt-decision-num' }, String(index + 1).padStart(2, '0')),
              h('div', null, h('div', null, entry.text || entry), h('div', { className: 'dpt-dt-byline' }, (entry.by || '—') + (entry.at ? ' · ' + shortTime(entry.at) : ''))),
            )))))
          if (openLoops.length) cards.push(dtSectionCard('loops', t('sectionOpenLoops'), 'warning', openLoops.length, openLoops.map((entry, index) =>
            h('div', { className: 'dpt-dt-loop', key: 'L' + index }, h('span', { className: 'dpt-dt-loop-dot' }), h('div', null, h('div', null, entry.text || entry), h('div', { className: 'dpt-dt-byline' }, (entry.by || '—') + (entry.at ? ' · ' + shortTime(entry.at) : '')))),
          ), true))
          if (resources.length || commits.length) {
            const rows = [
              resources.map((resource) => h('div', { className: 'dpt-dt-row', key: resource.id }, dtIcon('file'), h('span', { className: 'dpt-dt-row-code' }, resource.id), h('span', { className: 'dpt-dt-row-main' }, resource.title), h('span', { className: 'dpt-badge dpt-badge--' + resource.status }, resStatusLabel(resource.status)))),
              commits.length ? h('div', { className: 'dpt-dt-subhead' }, t('sectionCommits')) : null,
              commits.map((commit, index) => h('div', { className: 'dpt-dt-row', key: 'C' + index }, dtIcon('git'), h('span', { className: 'dpt-dt-row-code' }, String(commit.hash || '').slice(0, 8)), h('span', { className: 'dpt-dt-row-main' }, commit.subject || ''))),
            ]
            cards.push(dtSectionCard('assets', t('sectionResources') + ' / ' + t('sectionCommits'), 'file', resources.length + commits.length, rows))
          }
          if (detail.history && detail.history.length) cards.push(dtSectionCard('history', t('history'), 'history', detail.history.length, dtStatusSequence(task, detail.history)))
          return h(
            'div',
            { className: 'dpt-modal-layer' },
            h('div', { className: 'dpt-modal-backdrop', onClick: closeDetail }),
            h(
              'div',
              { className: 'dpt-modal dpt-modal--wide dpt-modal--detail', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dpt-dt-title' },
              h(
                'div',
                { className: 'dpt-modal-head' },
                h('span', { className: 'dpt-dt-id', title: t('detail') }, task.id),
                h('h1', { className: 'dpt-dt-title', id: 'dpt-dt-title', title: task.title }, task.title),
                h('div', { className: 'dpt-head-meta' },
                  h('span', { className: 'dpt-dt-priority', style: { '--tone': task.priority === 'P0' ? DT_TONE.block : task.priority === 'P1' ? DT_TONE.partial : DT_TONE.neutral } }, task.priority || '—'),
                  h('span', { className: 'dpt-dt-priority dpt-dt-priority--urgency' }, urgencyLabel(task.urgency)),
                ),
                h('div', { className: 'dpt-head-facts', style: { '--tone': statusTone } }, facts),
                h('button', { className: 'dpt-x', title: t('close'), onClick: closeDetail }, dtIcon('x')),
              ),
              h('div', { className: 'dpt-modal-body' },
                h('div', { className: 'dpt-dt-main' },
                  infos.length ? h('div', { className: 'dpt-dt-info-grid' }, infos) : null,
                  cards,
                ),
              ),
              h('div', { className: 'dpt-modal-foot' },
                h('span', { className: 'dpt-sub' }, t('updatedTime') + ' ' + shortTime(task.updatedAt) + (archived ? ' · ' + t('archivedShort') : '')),
                h('button', { className: 'dpt-btn', onClick: closeDetail }, t('close')),
              ),
            ),
          )
        }

        const detailModal = detail ? buildDetailModal() : null

          const buildBriefModal = () => {
            const data = brief.brief || {}
            const task = data.task || brief.task || {}
            const section = (title, content) => h('div', { className: 'dpt-section' }, h('div', { className: 'dpt-section-title' }, title), content)
            const textNode = (value) => h('div', { className: 'dpt-section-body' }, value || '—')
            const upstreamDone = data.upstreamDone || []
            const upstreamPending = data.upstreamPending || []
            const changes = data.changes || []
            const openLoops = data.openLoops || []
            const resourceLines = []
            for (const [bucket, labelKey] of [['draft', 'resDraft'], ['approved', 'resApproved'], ['superseded', 'resSuperseded']]) {
              for (const resource of (data.resources && data.resources[bucket]) || []) {
                resourceLines.push(`${t(labelKey)} · ${resource.id} · ${resource.title}`)
              }
            }
            return h(
              'div',
              { className: 'dpt-modal-layer' },
              h('div', { className: 'dpt-modal-backdrop', onClick: () => setBrief(null) }),
              h(
                'div',
                { className: 'dpt-modal dpt-modal--wide', role: 'dialog', 'aria-modal': 'true' },
                h(
                  'div',
                  { className: 'dpt-modal-head' },
                  h('span', { className: 'dpt-modal-title' }, `${t('briefTitle')} · ${task.id || ''}`),
                  h('button', { className: 'dpt-x', title: t('close'), onClick: () => setBrief(null) }, '×'),
                ),
                h(
                  'div',
                  { className: 'dpt-modal-body' },
                  h(
                    'div',
                    { className: 'dpt-sub' },
                    `${task.title || ''}${data.stage ? ` · ${t('stage')} ${nodeName(data.stage)}` : ''}${data.milestone ? ` · ${t('milestone')} ${nodeName(data.milestone)}` : ''}`,
                  ),
                  h(
                    'div',
                    { className: 'dpt-brief' },
                    section(t('sectionGoal'), textNode(data.goal)),
                    section(t('sectionProgress'), textNode(data.progress)),
                    section(t('sectionDecisions'), lineRows(data.decisions || [], (entry) => `${entry.text || entry}${entry.by ? ` · ${entry.by}` : ''}`)),
                    section(
                      t('sectionUpstreamDone'),
                      lineRows(upstreamDone, (entry) => `${entry.id} · ${entry.title}${entry.version ? ` · v${entry.version}` : ''}${entry.evidence ? ` · ${entry.evidence}` : ''}${entry.handoff ? ` · ${entry.handoff}` : ''}`),
                    ),
                    section(
                      t('sectionUpstreamPending'),
                      lineRows(upstreamPending, (entry) => `${entry.id} · ${entry.title} · ${statusLabel(entry.status)} · ${entry.type || ''}`.trim()),
                    ),
                    section(t('sectionChanges'), lineRows(changes, (change) => String(change))),
                    section(t('sectionResources'), lineRows(resourceLines, (line) => line)),
                    section(t('sectionOpenLoops'), lineRows(openLoops, (entry) => `${entry.text || entry}${entry.by ? ` · ${entry.by}` : ''}`)),
                    section(
                      t('sectionPreconditions'),
                      lineRows(data.preconditions || [], (pre) => `${pre.satisfied === true ? '✅' : '⏳'} ${pre.id} · ${preTypeLabel(pre.type)}${pre.required === false ? ` · ${t('optional')}` : ''}`),
                    ),
                    section(t('sectionBlocking'), lineRows(data.blocking || [], (entry) => `${entry.id} · ${entry.type}${entry.note ? ` · ${entry.note}` : ''}`)),
                    section(t('sectionNextStep'), textNode(data.nextStep)),
                  ),
                ),
                h(
                  'div',
                  { className: 'dpt-modal-foot' },
                  h(
                    'span',
                    { className: 'dpt-sub' },
                    `${statusLabel(task.status)}${task.effectiveStatus && task.effectiveStatus !== task.status ? ` · ${statusLabel(task.effectiveStatus)}` : ''}`,
                  ),
                  h('button', { className: 'dpt-btn', onClick: () => setBrief(null) }, t('close')),
                ),
              ),
            )
          }

          const briefModal = brief ? buildBriefModal() : null

          const assignModal = assign
            ? h(
                'div',
                { className: 'dpt-modal-layer' },
                h('div', { className: 'dpt-modal-backdrop', onClick: closeAssign }),
                h(
                  'div',
                  { className: 'dpt-modal dpt-modal--small', role: 'dialog', 'aria-modal': 'true' },
                  h(
                    'div',
                    { className: 'dpt-modal-head' },
                    h('span', { className: 'dpt-modal-title' }, `${t('assignTitle')} · ${assign.task.id}`),
                    h('button', { className: 'dpt-x', title: t('close'), onClick: closeAssign }, '×'),
                  ),
                  h(
                    'div',
                    { className: 'dpt-modal-body' },
                    h('div', { className: 'dpt-sub' }, assign.task.title),
                    h(
                      'label',
                      { className: 'dpt-field' },
                      t('assignPick'),
                      h(
                        'select',
                        {
                          className: 'dpt-select',
                          value: personOptions.find((name) => personKey(name) === personKey(assign.value)) || '',
                          onChange: (event) => {
                            if (event.target.value) setAssign({ ...assign, value: event.target.value })
                          },
                        },
                        h('option', { value: '' }, t('assignManual')),
                        personOptions.map((name) => h('option', { key: name, value: name }, name)),
                      ),
                    ),
                    h(
                      'label',
                      { className: 'dpt-field' },
                      t('owner'),
                      h('input', {
                        className: 'dpt-input',
                        value: assign.value,
                        placeholder: t('assignPlaceholder'),
                        autoFocus: true,
                        spellCheck: false,
                        onChange: (event) => setAssign({ ...assign, value: event.target.value }),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter' && !busy) confirmAssign()
                        },
                      }),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'dpt-modal-foot' },
                    h('span', { className: 'dpt-sub' }, `${t('owner')} ${assign.task.holder || '—'}`),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 6 } },
                      h('button', { className: 'dpt-btn', onClick: closeAssign }, t('cancel')),
                      h('button', { className: 'dpt-btn dpt-btn--primary', disabled: busy || !assign.value.trim(), onClick: confirmAssign }, t('assign')),
                    ),
                  ),
                ),
              )
            : null

          const doneModal = doneTarget
            ? h(
                'div',
                { className: 'dpt-modal-layer' },
                h('div', { className: 'dpt-modal-backdrop', onClick: closeDone }),
                h(
                  'div',
                  { className: 'dpt-modal dpt-modal--small', role: 'dialog', 'aria-modal': 'true' },
                  h(
                    'div',
                    { className: 'dpt-modal-head' },
                    h('span', { className: 'dpt-modal-title' }, `${t('donePrefix')} ${doneTarget.task.id}`),
                    h('button', { className: 'dpt-x', title: t('close'), onClick: closeDone }, '×'),
                  ),
                  h(
                    'div',
                    { className: 'dpt-modal-body' },
                    h('div', { className: 'dpt-sub' }, doneTarget.task.title),
                    h(
                      'label',
                      { className: 'dpt-field' },
                      `${t('version')}${versionRequired ? ' *' : ''}`,
                      h('input', {
                        className: 'dpt-input',
                        value: doneVersion,
                        placeholder: t('versionPlaceholder'),
                        autoFocus: true,
                        spellCheck: false,
                        onChange: (event) => setDoneVersion(event.target.value),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter' && !busy && (!versionRequired || doneVersion.trim())) confirmDone()
                        },
                      }),
                      doneHint ? h('span', { className: 'dpt-hint' + (doneHint.kind === 'err' ? ' dpt-hint--err' : '') }, doneHint.text) : null,
                    ),
                    h(
                      'label',
                      { className: 'dpt-field' },
                      t('evidence'),
                      h('textarea', {
                        value: doneEvidence,
                        placeholder: t('evidencePlaceholder'),
                        onChange: (event) => setDoneEvidence(event.target.value),
                      }),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'dpt-modal-foot' },
                    h('span', { className: 'dpt-sub' }, versionRequired ? t('versionRequiredHint') : ''),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 6 } },
                      h('button', { className: 'dpt-btn', onClick: closeDone }, t('cancel')),
                      h('button', { className: 'dpt-btn dpt-btn--success', disabled: busy || (versionRequired && !doneVersion.trim()), onClick: confirmDone }, t('doneConfirm')),
                    ),
                  ),
                ),
              )
            : null

          const exportMenu = h(
            'div',
            { className: 'dpt-menu' },
            h('button', { className: 'dpt-btn', onClick: () => setExportOpen(!exportOpen) }, t('export')),
            exportOpen
              ? h(
                  'div',
                  { className: 'dpt-menu-panel' },
                  h('button', { onClick: () => downloadExport('md', 'active') }, t('exportMd')),
                  h('button', { onClick: () => downloadExport('xlsx', 'active') }, t('exportXlsx')),
                  // HTML is a self-contained offline report (see templates/report.html).
                  h('button', { onClick: () => downloadExport('html', 'active') }, t('exportHtml')),
                  h('button', { onClick: () => downloadExport('md', 'all') }, `${t('exportMd')}（${t('exportAll')}）`),
                  h('button', { onClick: () => downloadExport('xlsx', 'all') }, `${t('exportXlsx')}（${t('exportAll')}）`),
                  h('button', { onClick: () => downloadExport('html', 'all') }, `${t('exportHtml')}（${t('exportAll')}）`),
                )
              : null,
          )

          const filtersActive = hasFilters || personFilter !== null
          const emptyFiltered = filtersActive ? t('searchEmpty') : t('noMatch')
          const doneBulk =
            tab === 'done' && doneTasks.length
              ? h(
                  'div',
                  { className: 'dpt-bulkbar' },
                  h('span', { className: 'dpt-sub' }, `${t('tabDone')} ${doneTasks.length} ${t('taskUnit')}`),
                  h('button', { className: 'dpt-btn', disabled: busy, onClick: archiveDoneBatch }, `${t('archiveAll')}（${doneTasks.length}）`),
                )
              : null
          const tabContent =
            tab === 'archived'
              ? archivedList.length
                ? renderFlatTable(archivedList, 'archived')
                : h('p', { className: 'dpt-empty' }, emptyFiltered)
              : tab === 'done'
                ? h(
                    'div',
                    null,
                    doneBulk,
                    doneTasks.length ? renderFlatTable(doneTasks, 'done') : h('p', { className: 'dpt-empty' }, emptyFiltered),
                  )
                : visibleRoots.length
                  ? grouped
                    ? renderGroupsTable()
                    : renderFlatTable(visibleRoots, 'flat')
                  : h('p', { className: 'dpt-empty' }, activeTasks.length ? emptyFiltered : hasFilters ? t('searchEmpty') : t('empty'))

          const buildGlobalTree = () => {
            const allTasks = [...activeTasks, ...archivedTasks]
            if (!allTasks.length) return h('div', { className: 'dpt-tree' }, h('div', { className: 'dpt-tree-empty' }, t('treeEmpty')))
            const usedMilestones = new Set(allTasks.map(milestoneCodeOf))
            const milestoneRows = sortedMilestones.filter((entry) => usedMilestones.has(entry.code))
            for (const code of usedMilestones) {
              if (!milestoneRows.some((entry) => entry.code === code)) milestoneRows.push({ code, name: code })
            }
            const progress = (tasks) => {
              const done = tasks.filter((task) => task.status === 'done').length
              return { done, pct: tasks.length ? Math.round((done * 100) / tasks.length) : 0 }
            }
            // 流转状态分布：聚合里程碑 / 分组 / 全局的任务状态，便于快速定位。
            const flowOf = (tasks) => ({
              open: tasks.filter((task) => task.status === 'open').length,
              doing: tasks.filter((task) => task.status === 'doing').length,
              blocked: tasks.filter((task) => task.status === 'blocked').length,
              done: tasks.filter((task) => task.status === 'done').length,
            })
            const flowText = (tasks) => {
              const flow = flowOf(tasks)
              return t('treeFlow').replace('{open}', flow.open).replace('{doing}', flow.doing).replace('{blocked}', flow.blocked).replace('{done}', flow.done)
            }
            const flowRow = (tasks) => h(
              'span',
              { className: 'dpt-tree-flow', title: flowText(tasks) },
              ['open', 'doing', 'blocked', 'done'].map((status) => {
                const value = flowOf(tasks)[status]
                if (!value) return null
                return h('span', { className: 'dpt-tree-flow-item', style: { '--tone': dtStatusTone(status) }, key: status }, statusLabel(status) + ' ' + value)
              }),
            )
            const toggleButton = (key, collapsed) =>
              h(
                'button',
                {
                  className: 'dpt-tree-toggle',
                  title: collapsed ? t('treeToggleExpand') : t('treeToggleCollapse'),
                  onClick: (event) => { event.stopPropagation(); toggleTreeNode(key) },
                },
                collapsed ? '▸' : '▾',
              )
            const renderTask = (task, seen) => {
              if (seen.has(task.id)) return null
              const nextSeen = new Set(seen)
              nextSeen.add(task.id)
              const scope = allTasks.filter((entry) => milestoneCodeOf(entry) === milestoneCodeOf(task))
              const children = scope.filter((entry) => entry.parentId === task.id)
              const key = 'task:' + task.id
              const collapsed = treeCollapsed.has(key)
              const share = progress(children)
              return h(
                'div',
                { key: task.id },
                h(
                  'div',
                  {
                    className: 'dpt-tree-row dpt-tree-task',
                    style: { '--tone': dtStatusTone(task.status) },
                    title: task.title || task.id,
                    onClick: () => openDetail(task.id),
                  },
                  children.length
                    ? toggleButton(key, collapsed)
                    : h('span', { className: 'dpt-tree-toggle dpt-tree-toggle--empty' }),
                  h('span', { className: 'dpt-tree-icon' }, dtIcon(dtStatusIcon(task.status))),
                  h('span', { className: 'dpt-tree-name' }, task.id + '  ' + (task.title || task.id)),
                  h(
                    'span',
                    { className: 'dpt-tree-meta' },
                    children.length ? h('span', null, share.done + '/' + children.length + ' ' + t('children')) : null,
                    task.holder ? h('span', null, task.holder) : null,
                    h('span', { className: 'dpt-tree-status' }, statusLabel(task.status)),
                  ),
                ),
                !collapsed && children.length
                  ? h('div', { className: 'dpt-tree-children' }, children.map((entry) => renderTask(entry, nextSeen)))
                  : null,
              )
            }
            const renderStage = (stage, milestoneCode) => {
              const tasks = allTasks.filter((task) => milestoneCodeOf(task) === milestoneCode && (task.stageCode || 'default') === stage.code)
              if (!tasks.length) return null
              const roots = tasks.filter((task) => !task.parentId || !tasks.some((entry) => entry.id === task.parentId))
              const key = 'stage:' + stage.code
              const collapsed = treeCollapsed.has(key)
              const share = progress(tasks)
              return h(
                'div',
                { key: stage.code },
                h(
                  'div',
                  { className: 'dpt-tree-row dpt-tree-row--group', style: { '--tone': DT_TONE.doing }, title: nodeName(stage) },
                  toggleButton(key, collapsed),
                  h('span', { className: 'dpt-tree-icon' }, dtIcon('layers')),
                  h('span', { className: 'dpt-tree-kind' }, t('group')),
                  h('span', { className: 'dpt-tree-name' }, nodeName(stage)),
                  h(
                    'span',
                    { className: 'dpt-tree-meta' },
                    flowRow(tasks),
                    h('span', { className: 'dpt-tree-bar' }, h('i', { style: { width: share.pct + '%' } })),
                    h('span', { className: 'dpt-tree-count' }, share.done + '/' + tasks.length),
                  ),
                ),
                !collapsed ? h('div', { className: 'dpt-tree-children' }, roots.map((task) => renderTask(task, new Set()))) : null,
              )
            }
            const renderMilestone = (milestone) => {
              const tasks = allTasks.filter((task) => milestoneCodeOf(task) === milestone.code)
              const stages = sortedStages.filter((stage) => (stage.milestoneCode || 'default') === milestone.code)
              const key = 'milestone:' + milestone.code
              const collapsed = treeCollapsed.has(key)
              const share = progress(tasks)
              return h(
                'div',
                { key: milestone.code },
                h(
                  'div',
                  { className: 'dpt-tree-row dpt-tree-row--milestone', style: { '--tone': DT_TONE.doing }, title: nodeName(milestone) },
                  toggleButton(key, collapsed),
                  h('span', { className: 'dpt-tree-icon' }, dtIcon('flag')),
                  h('span', { className: 'dpt-tree-kind' }, t('milestone')),
                  h('span', { className: 'dpt-tree-name' }, nodeName(milestone)),
                  h(
                    'span',
                    { className: 'dpt-tree-meta' },
                    flowRow(tasks),
                    h('span', { className: 'dpt-tree-bar' }, h('i', { style: { width: share.pct + '%' } })),
                    h('span', { className: 'dpt-tree-count' }, share.done + '/' + tasks.length),
                  ),
                ),
                !collapsed
                  ? h('div', { className: 'dpt-tree-children' }, stages.map((stage) => renderStage(stage, milestone.code)))
                  : null,
              )
            }
            const overall = progress(allTasks)
            return h(
              'div',
              { className: 'dpt-tree' },
              h(
                'div',
                { className: 'dpt-tree-head' },
                h('span', { className: 'dpt-tree-title' }, t('pageTree')),
                h('span', { className: 'dpt-tree-hint' }, t('treeHint')),
                h('span', { className: 'dpt-spacer' }),
                flowRow(allTasks),
                h('span', { className: 'dpt-tree-count' }, overall.done + '/' + allTasks.length),
                h('span', { className: 'dpt-tree-bar' }, h('i', { style: { width: overall.pct + '%' } })),
              ),
              h('div', { className: 'dpt-tree-body' }, milestoneRows.map(renderMilestone)),
            )
          }

          const tabs = [
            ['all', t('tabAll'), tabCounts.all],
            ['ready', t('tabReady'), tabCounts.ready],
            ['doing', t('tabDoing'), tabCounts.doing],
            ['blocked', t('tabBlocked'), tabCounts.blocked],
            ['done', t('tabDone'), tabCounts.done],
            ['archived', t('tabArchived'), tabCounts.archived],
          ]

          return h(
            'div',
            { className: 'dsh-project-task' },
            h(StyleTag),
            h(
              'div',
              { className: 'dpt-inner' },
              h(
                'header',
                { className: 'dpt-head' },
                h(
                  'div',
                  null,
                  h('h1', { className: 'dpt-title' }, t('title')),
                  h(
                    'p',
                    { className: 'dpt-sub' },
                    root || t('loading'),
                    board ? ` · revision ${board.revision}` : '',
                    config.archiveAfterDays > 0 ? ` · ${t('archiveAfter')} ${config.archiveAfterDays} ${t('days')}` : ` · ${t('archiveAfter')} ${t('archiveOff')}`,
                  ),
                ),
                h(
                  'div',
                  { className: 'dpt-actions' },
                  h(
                    'div',
                    { className: 'dpt-pages' },
                    h(
                      'button',
                      { className: 'dpt-page-btn' + (page === 'board' ? ' dpt-page-btn--on' : ''), onClick: () => changePage('board') },
                      t('pageBoard'),
                    ),
                    h(
                      'button',
                      { className: 'dpt-page-btn' + (page === 'tree' ? ' dpt-page-btn--on' : ''), onClick: () => changePage('tree') },
                      t('pageTree'),
                    ),
                  ),
                  h('span', { className: 'dpt-actor-label' }, t('actorLabel')),
                  h('input', {
                    className: 'dpt-input',
                    style: { width: 140 },
                    value: holder,
                    onChange: (event) => setHolder(event.target.value),
                    placeholder: (actor && (actor.person || actor.actor)) || t('holder'),
                    title: `${t('actorLabel')}${actor && actor.person ? ` · ${actor.person}` : ''}${actor && actor.source ? ` · ${actor.source}` : ''}`,
                    spellCheck: false,
                  }),
                  exportMenu,
                  h('button', { className: 'dpt-btn', disabled: busy, onClick: load }, t('refresh')),
                  h('button', { className: 'dpt-btn', onClick: () => setSkillsOpen(true), title: t('skillTitle') }, t('skillNav')),
                  h(
                    'button',
                    {
                      className: 'dpt-btn',
                      disabled: busy,
                      onClick: async () => {
                        const result = await run({ action: 'check', by: holder.trim() || 'ui' })
                        if (result) setNotice({ kind: 'ok', text: result.message })
                      },
                    },
                    t('check'),
                  ),
                ),
              ),
              skills && skills.firstRun && !skillDismissed && !skillsOpen
                ? h(
                    'div',
                    { className: 'dpt-notice' },
                    h('span', null, t('skillBanner')),
                    ' ',
                    h(
                      'button',
                      { className: 'dpt-btn dpt-btn--primary', disabled: skillBusy, onClick: () => postSkills(detectedSkillTargets, 'install') },
                      t('skillInstallDetected'),
                    ),
                    ' ',
                    h('button', { className: 'dpt-btn', onClick: dismissSkillBanner }, t('skillLater')),
                  )
                : null,
              error ? h('div', { className: 'dpt-alert' }, error) : null,
              notice ? h('div', { className: 'dpt-notice dpt-notice--' + notice.kind }, notice.text) : null,
              page === 'board'
                ? h(
                'div',
                null,
                h(
                  'div',
                  { className: 'dpt-quick' },
                  h('input', {
                    className: 'dpt-input',
                    value: quickTitle,
                    placeholder: t('quickAdd'),
                    onChange: (event) => setQuickTitle(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') quickAdd()
                    },
                  }),
                  h('select', { className: 'dpt-select', value: quickPriority, onChange: (event) => setQuickPriority(event.target.value), title: t('priority') }, PRIORITIES.map((value) => h('option', { key: value, value }, value))),
                  h(
                    'select',
                    { className: 'dpt-select', value: quickUrgency, onChange: (event) => setQuickUrgency(Number(event.target.value)), title: t('urgency') },
                    URGENCIES.map((value) => h('option', { key: value, value }, urgencyLabel(value))),
                  ),
                  h(
                    'select',
                    { className: 'dpt-select', value: quickStage, onChange: (event) => setQuickStage(event.target.value), title: t('stage') },
                    sortedStages.map((entry) => h('option', { key: entry.code, value: entry.code, title: entry.code }, nodeName(entry))),
                  ),
                  h('button', { className: 'dpt-btn dpt-btn--primary', disabled: busy, onClick: quickAdd }, t('add')),
                ),
                h(
                  'div',
                  { className: 'dpt-bar' },
                  h(
                    'div',
                    { className: 'dpt-tabs' },
                    tabs.map((entry) => h('button', { key: entry[0], className: 'dpt-tab' + (tab === entry[0] ? ' dpt-tab--on' : ''), onClick: () => setTab(entry[0]) }, entry[1], h('span', { className: 'dpt-tab-count' }, String(entry[2])))),
                  ),
                  h(
                    'span',
                    { className: 'dpt-view' },
                    h('span', { className: 'dpt-view-label' }, t('view')),
                    h(
                      'select',
                      { className: 'dpt-select dpt-filter', value: viewMode, onChange: (event) => changeView(event.target.value), title: viewHint },
                      h('option', { value: 'auto' }, t('viewAuto')),
                      h('option', { value: 'flat' }, t('viewFlat')),
                      h('option', { value: 'grouped' }, t('viewGrouped')),
                    ),
                  ),
                  h(
                    'span',
                    { className: 'dpt-people' },
                    h('span', { className: 'dpt-view-label' }, t('people')),
                    h(
                      'button',
                      {
                        className: 'dpt-btn' + (personFilter === null ? ' dpt-btn--primary' : ''),
                        title: t('peopleHint'),
                        'aria-expanded': peopleOpen,
                        onClick: () => setPeopleOpen(!peopleOpen),
                      },
                      peopleLabel,
                    ),
                    peopleOpen
                      ? h(
                          'div',
                          { className: 'dpt-people-panel' },
                          h(
                            'div',
                            { className: 'dpt-people-actions' },
                            h(
                              'button',
                              {
                                className: 'dpt-btn',
                                onClick: () => {
                                  setPersonFilter(null)
                                  setPeopleOpen(false)
                                },
                              },
                              t('peopleMine'),
                            ),
                            h(
                              'button',
                              {
                                className: 'dpt-btn',
                                onClick: () => {
                                  setPersonFilter([])
                                  setPeopleOpen(false)
                                },
                              },
                              t('peopleAll'),
                            ),
                          ),
                          personOptions.length
                            ? personOptions.map((name) =>
                                h(
                                  'label',
                                  { className: 'dpt-people-row', key: name },
                                  h('input', { type: 'checkbox', checked: selectedPeopleKeys.has(personKey(name)), onChange: () => togglePerson(name) }),
                                  h('span', null, personKey(name) === personKey(mePerson) ? `${name}（${t('peopleMe')}）` : name),
                                ),
                              )
                            : h('div', { className: 'dpt-people-row' }, t('peopleEmpty')),
                        )
                      : null,
                  ),
                  h('span', { className: 'dpt-spacer' }),
                  h(
                    'select',
                    { className: 'dpt-select dpt-filter', value: milestoneFilter, onChange: (event) => changeMilestoneFilter(event.target.value), title: t('milestone') },
                    h('option', { value: '' }, t('allMilestones')),
                    sortedMilestones.map((entry) => h('option', { key: entry.code, value: entry.code, title: entry.code }, nodeName(entry))),
                  ),
                  h(
                    'select',
                    { className: 'dpt-select dpt-filter', value: stageFilter, onChange: (event) => setStageFilter(event.target.value), title: t('stage') },
                    h('option', { value: '' }, t('allStages')),
                    stageOptions.map((entry) => h('option', { key: entry.code, value: entry.code, title: entry.code }, nodeName(entry))),
                  ),
                  h(
                    'select',
                    { className: 'dpt-select dpt-filter', value: tagFilter, onChange: (event) => setTagFilter(event.target.value), title: t('tag') },
                    h('option', { value: '' }, t('allTags')),
                    tagCodes.map((code) => h('option', { key: code, value: code, title: code }, tagLabel(code))),
                  ),
                  h(
                    'select',
                    { className: 'dpt-select dpt-filter', value: sort, onChange: (event) => setSort(event.target.value), title: t('sort') },
                    h('option', { value: 'priority' }, t('sortPriority')),
                    h('option', { value: 'updated' }, t('sortUpdated')),
                    h('option', { value: 'created' }, t('sortCreated')),
                  ),
                  h('input', { className: 'dpt-input dpt-search', value: search, placeholder: t('search'), onChange: (event) => setSearch(event.target.value) }),
                ),
                tabContent,
              )
                : buildGlobalTree(),
              detailModal,
              briefModal,
              assignModal,
              doneModal,
              skillsOpen && skills
                ? h(
                    'div',
                    { className: 'dpt-modal-layer' },
                    h('div', { className: 'dpt-modal-backdrop', onClick: () => setSkillsOpen(false) }),
                    h(
                      'div',
                      { className: 'dpt-modal', role: 'dialog', 'aria-modal': 'true' },
                      h(
                        'div',
                        { className: 'dpt-modal-head' },
                        h('span', { className: 'dpt-modal-title' }, t('skillTitle')),
                        h('button', { className: 'dpt-x', title: t('close'), onClick: () => setSkillsOpen(false) }, '×'),
                      ),
                      h(
                        'div',
                        { className: 'dpt-modal-body' },
                        skillMsg ? h('div', { className: 'dpt-notice' }, skillMsg) : null,
                        ...skills.targets.map((row) =>
                          h(
                            'div',
                            { className: 'dpt-skill-row', key: row.name },
                            h(
                              'div',
                              { className: 'dpt-skill-main' },
                              h('div', { className: 'dpt-skill-name' }, `${row.label}${row.detected ? '' : `（${t('skillNotDetected')}）`}`),
                              h('div', { className: 'dpt-skill-path' }, row.path),
                              row.note ? h('div', { className: 'dpt-skill-note' }, row.note) : null,
                            ),
                            h('span', { className: 'dpt-skill-state' }, skillStateLabel(row.state)),
                          ),
                        ),
                      ),
                      h(
                        'div',
                        { className: 'dpt-modal-foot' },
                        h('button', { className: 'dpt-btn', onClick: () => setSkillsOpen(false) }, t('close')),
                        h(
                          'button',
                          {
                            className: 'dpt-btn dpt-btn--primary',
                            disabled: skillBusy || !detectedSkillTargets.length,
                            onClick: () => postSkills(detectedSkillTargets, 'install'),
                          },
                          t('skillInstallDetected'),
                        ),
                      ),
                    ),
                  )
                : null,
              exportOpen ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 44, background: 'transparent' }, onClick: () => setExportOpen(false) }) : null,
              peopleOpen ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 44, background: 'transparent' }, onClick: () => setPeopleOpen(false) }) : null,
            ),
          )
        }

        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register({ name: 'conversation.view', id: 'task', order: 5, label: () => t('nav') }, TaskView),
        )
      },
    }
  },
})
