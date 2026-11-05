/**
 * Browser half of `@local/dsh-project-todo`.
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
  id: '@local/dsh-project-todo',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const BASE = '/dsh-project-todo'
    const TOKEN = (typeof window !== 'undefined' && window.__DSH_PROJECT_TODO_TOKEN__) || ''
    const HOLDER_KEY = 'dsh-project-todo-holder'

    /** Explain a 404 from the Web server: the route is missing, not the data. */
    function hostHalfHint() {
      const zh = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')
      return zh
        ? 'Host 半边未加载：/dsh-project-todo 路由未注册（HTTP 404）。请重启 DSH，并确认插件行在 profile 的 dsh.profile.bundles 中、ui.enabled 未被关闭。'
        : 'Host half not loaded: the /dsh-project-todo route is not registered (HTTP 404). Restart DSH, then check the plugin row in the profile bundles and that ui.enabled is not disabled.'
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
    const VIEW_KEY = 'dsh-project-todo-view'
    const VIEW_MODES = ['auto', 'flat', 'grouped']

    const DICT = {
      zh: {
        nav: '待办', title: '项目待办', loading: '读取项目待办 …', refresh: '刷新', check: '校验',
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
        exportAll: '含归档', importHint: '支持 .md / .xlsx', needHolder: '先填写会话名（持有者）',
        ok: '完成', failed: '操作失败', empty: '本项目还没有待办，上面新建一条吧。',
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
        timelineClearConfirm: '确认清空操作日志？只清理日志记录，不影响任何待办任务。',
        timelineCleared: '已清空 {n} 条日志',
        /* v3 */
        stage: '阶段', milestone: '里程碑', inbox: '收件箱',
        briefTitle: '开工简报',
        sectionGoal: '目标', sectionProgress: '进度', sectionDecisions: '决策',
        sectionUpstreamDone: '已完成上游', sectionUpstreamPending: '待完成上游',
        sectionChanges: '变更提醒', sectionResources: '资料', sectionOpenLoops: '未关闭事项',
        sectionNextStep: '下一步', sectionPreconditions: '前置条件', sectionBlocking: '受阻',
        sectionDependencies: '依赖', sectionContext: '任务上下文', sectionCauses: '因果',
        sectionCommits: '相关提交', noExtraInfo: '暂无上下文、依赖、前置、资料或因果记录',
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
        nav: 'Todo', title: 'Project todo', loading: 'Loading project todo …', refresh: 'Refresh', check: 'Check',
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
        exportAll: 'with archive', importHint: 'Supports .md / .xlsx', needHolder: 'Enter a session name first',
        ok: 'Done', failed: 'Action failed', empty: 'No todos in this project yet.',
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
        stage: 'Stage', milestone: 'Milestone', inbox: 'Inbox',
        briefTitle: 'Start brief',
        sectionGoal: 'Goal', sectionProgress: 'Progress', sectionDecisions: 'Decisions',
        sectionUpstreamDone: 'Completed upstream', sectionUpstreamPending: 'Pending upstream',
        sectionChanges: 'Changes', sectionResources: 'Resources', sectionOpenLoops: 'Open loops',
        sectionNextStep: 'Next step', sectionPreconditions: 'Preconditions', sectionBlocking: 'Blocked by',
        sectionDependencies: 'Dependencies', sectionContext: 'Context', sectionCauses: 'Causes',
        sectionCommits: 'Related commits', noExtraInfo: 'No context, dependencies, preconditions, resources or causes',
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

    async function call(subpath, init) {
      const headers = Object.assign({}, init && init.headers)
      headers['x-dsh-project-todo-client'] = '1'
      if (TOKEN) headers['x-dsh-project-todo-token'] = TOKEN
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

    /** Client-side view order only; never sent to the backend. */
    function sortTasksFor(tasks, sort) {
      const compare = sort === 'updated' ? compareUpdated : sort === 'created' ? compareCreated : comparePriority
      return [...tasks].sort(compare)
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
      '.dsh-project-todo{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:20px 24px 48px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '.dsh-project-todo *{box-sizing:border-box}',
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
      '@media (max-width:720px){.dpt-search{width:100%}.dpt-filter{max-width:none}.dpt-task-actions{flex-wrap:wrap}}',
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

        function TodoView(props) {
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
          const [sort, setSort] = useState('priority')
          const [collapsed, setCollapsed] = useState(() => new Set())
          const [closedGroups, setClosedGroups] = useState(() => new Set())
          const [closedStages, setClosedStages] = useState(() => new Set())
          const [viewMode, setViewMode] = useState(readStoredView)
          const [people, setPeople] = useState([])
          const [personFilter, setPersonFilter] = useState(null)
          const [peopleOpen, setPeopleOpen] = useState(false)
          const [search, setSearch] = useState('')
          const [tagFilter, setTagFilter] = useState('')
          const [milestoneFilter, setMilestoneFilter] = useState('')
          const [stageFilter, setStageFilter] = useState('')
          const [detailId, setDetailId] = useState('')
          const [detail, setDetail] = useState(null)
          const [form, setForm] = useState(null)
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
            } catch (cause) {
              if (mounted.current) setError(cause.message || String(cause))
            }
          }, [query, sessionId, loadPeople])

          useEffect(() => {
            load()
          }, [load])

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

          const openDetail = async (taskId) => {
            setDetailId(taskId)
            setDetail(null)
            try {
              const data = await call('/task' + query + '&id=' + encodeURIComponent(taskId))
              if (!mounted.current) return
              setDetail(data)
              setForm({
                title: data.task.title,
                priority: data.task.priority,
                urgency: data.task.urgency,
                status: data.task.status,
                doneVersion: data.task.doneVersion || data.task.version || '',
                doneEvidence: data.task.doneEvidence || data.task.evidence || '',
                tags: (data.task.tags || []).join(', '),
                notes: data.task.notes || '',
              })
            } catch (cause) {
              setNotice({ kind: 'err', text: cause.message || String(cause) })
            }
          }

          const closeDetail = () => {
            setDetailId('')
            setDetail(null)
            setForm(null)
          }

          const saveDetail = async () => {
            if (!form || !detail || detail.archived === true) return
            if (form.status !== detail.task.status && (form.status === 'doing' || form.status === 'done') && !holder.trim()) {
              setNotice({ kind: 'err', text: t('needHolder') })
              return
            }
            const isDerived = !!(detail.children && detail.children.length)
            const toDone = form.status === 'done' && detail.task.status !== 'done'
            if (toDone && !isDerived && versionRequired && !String(form.doneVersion || '').trim()) {
              setNotice({ kind: 'err', text: t('versionNeeded') })
              return
            }
            const payload = {
              action: 'update',
              id: detail.task.id,
              by: holder.trim() || 'ui',
              title: form.title,
              priority: form.priority,
              urgency: Number(form.urgency),
              status: form.status,
              tags: form.tags.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
              notes: form.notes,
            }
            if (form.status === 'done') {
              const version = String(form.doneVersion || '').trim()
              const evidence = String(form.doneEvidence || '').trim()
              if (version) payload.version = version
              if (evidence) payload.evidence = evidence
            }
            const result = await run(payload)
            if (result) closeDetail()
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
                headers: Object.assign({ 'x-dsh-project-todo-client': '1' }, TOKEN ? { 'x-dsh-project-todo-token': TOKEN } : {}),
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
              const filename = match ? decodeURIComponent(match[1]) : `todos-${scope}.${format}`
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
                entry = { milestone, stages: new Map() }
                byMilestone.set(milestoneCode, entry)
              }
              let bucket = entry.stages.get(stageCode)
              if (!bucket) {
                bucket = { stage, roots: [] }
                entry.stages.set(stageCode, bucket)
              }
              bucket.roots.push(task)
            }
            return [...byMilestone.values()]
              .sort((left, right) => compareNodes(left.milestone, right.milestone, 'default'))
              .map((entry) => ({
                milestone: entry.milestone,
                stages: [...entry.stages.values()].sort((left, right) => compareNodes(left.stage, right.stage, 'default')),
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

          const buildDetailModal = () => {
            const task = detail.task
            const stage = detail.stage || null
            const milestone = detail.milestone || null
            const context = task.context || {}
            const decisions = context.decisions || []
            const openLoops = context.openLoops || []
            const dependsOn = task.dependsOn || []
            const blocking = detail.blocking || task.blocking || []
            const preconditions = detail.preconditions || task.preconditions || []
            const resources = task.resources || []
            const causedBy = task.causedBy || []
            const commits = detail.relatedCommits || []
            const stageText = stage ? nodeName(stage) : task.stageName || task.stageCode || 'default'
            const milestoneText = milestone ? nodeName(milestone) : task.milestoneName || task.milestoneCode || 'default'
            const hasContext = Boolean(context.goal || context.progress || decisions.length || openLoops.length)
            const hasExtra = Boolean(
              hasContext || dependsOn.length || blocking.length || preconditions.length || resources.length || causedBy.length || commits.length,
            )
            const canAssign = task.status !== 'done' && task.status !== 'cancelled' && !(detail.children && detail.children.length)
            const readOnly = detail.archived === true

            const liveIndex = new Map(activeTasks.map((entry) => [entry.id, entry]))
            const archiveIndex = new Map(archivedTasks.map((entry) => [entry.id, entry]))
            const depStatus = (id) => {
              const live = liveIndex.get(id)
              if (live) return statusLabel(live.status)
              const gone = archiveIndex.get(id)
              return gone ? `${statusLabel(gone.status)} · ${t('archivedShort')}` : t('missingTask')
            }

            // Only timestamps and the completer live here: status, priority,
            // owner, version and evidence already have their own controls above.
            const metaBlock =
              `创建 ${shortTime(task.createdAt)} · 更新 ${shortTime(task.updatedAt)}` +
              (task.claimedAt ? `\n认领 ${shortTime(task.claimedAt)}` : '') +
              (task.statusChangedAt ? ` · 状态更新 ${shortTime(task.statusChangedAt)}` : '') +
              (task.doneBy && task.doneBy !== task.holder ? `\n${t('doneBy')} ${task.doneBy}` : '') +
              (task.doneAt ? `\n${t('doneAt')} ${shortTime(task.doneAt)}` : '') +
              (task.archivedBy ? `\n${t('archivedBy')} ${task.archivedBy}` : '')
            const metaTitle = [
              `${t('owner')} ${task.holder || '—'}`,
              `创建 ${task.createdAt || '—'}`,
              `更新 ${task.updatedAt || '—'}`,
              task.claimedAt ? `认领 ${task.claimedAt}` : '',
              task.statusChangedAt ? `状态更新 ${task.statusChangedAt}` : '',
              task.doneBy ? `${t('doneBy')} ${task.doneBy}` : '',
              task.doneAt ? `${t('doneAt')} ${task.doneAt}` : '',
              task.archivedBy ? `${t('archivedBy')} ${task.archivedBy}` : '',
            ]
              .filter(Boolean)
              .join('\n')

            return h(
              'div',
              { className: 'dpt-modal-layer' },
              h('div', { className: 'dpt-modal-backdrop', onClick: closeDetail }),
              h(
                'div',
                { className: 'dpt-modal dpt-modal--wide', role: 'dialog', 'aria-modal': 'true' },
                h(
                  'div',
                  { className: 'dpt-modal-head' },
                  h('span', { className: 'dpt-modal-title' }, `${task.id} ${task.title}`),
                  h('button', { className: 'dpt-x', title: t('close'), onClick: closeDetail }, '×'),
                ),
                h(
                  'div',
                  { className: 'dpt-modal-body' },
                  h(
                    'div',
                    { className: 'dpt-meta-block' },
                    h('span', { className: 'dpt-tag', title: milestone ? milestone.code : task.milestoneCode || 'default' }, `${t('milestone')} ${milestoneText}`),
                    ' ',
                    h('span', { className: 'dpt-tag', title: stage ? stage.code : task.stageCode || 'default' }, `${t('stage')} ${stageText}`),
                    ' ',
                    task.effectiveStatus ? h('span', { className: 'dpt-badge ' + orgBadgeClass(task.effectiveStatus) }, statusLabel(task.effectiveStatus)) : null,
                  ),
                  hasContext
                    ? detailSection(
                        t('sectionContext'),
                        h(
                          'div',
                          { className: 'dpt-lines' },
                          context.goal
                            ? h('div', { className: 'dpt-line' }, h('span', { className: 'dpt-line-key' }, t('sectionGoal')), h('span', { className: 'dpt-line-body' }, context.goal))
                            : null,
                          context.progress
                            ? h('div', { className: 'dpt-line' }, h('span', { className: 'dpt-line-key' }, t('sectionProgress')), h('span', { className: 'dpt-line-body' }, context.progress))
                            : null,
                          decisions.length
                            ? h('div', { className: 'dpt-line' }, h('span', { className: 'dpt-line-key' }, t('sectionDecisions')), h('span', { className: 'dpt-line-body' }, decisions.map((entry, index) => `${index + 1}. ${entry.text || entry}`).join('\n')))
                            : null,
                          openLoops.length
                            ? h(
                                'div',
                                { className: 'dpt-line' },
                                h('span', { className: 'dpt-line-key' }, t('sectionOpenLoops')),
                                h('span', { className: 'dpt-line-body' }, openLoops.map((entry, index) => `${index + 1}. ${entry.text || entry}${entry.by ? ` · ${entry.by}` : ''}`).join('\n')),
                              )
                            : null,
                        ),
                      )
                    : null,
                  dependsOn.length
                    ? detailSection(
                        t('sectionDependencies'),
                        lineRows(dependsOn, (dep) => `${dep.id} · ${dep.type} · ${depStatus(dep.id)}${dep.note ? ` · ${dep.note}` : ''}`),
                      )
                    : null,
                  blocking.length
                    ? detailSection(
                        t('sectionBlocking'),
                        lineRows(blocking, (entry) => `${entry.id} · ${entry.type}${entry.note ? ` · ${entry.note}` : ''} · ${depStatus(entry.id)}`),
                      )
                    : null,
                  preconditions.length
                    ? detailSection(
                        t('sectionPreconditions'),
                        lineRows(
                          preconditions,
                          (pre) => `${pre.satisfied === true ? '✅' : '⏳'} ${pre.id} · ${preTypeLabel(pre.type)}${pre.required === false ? ` · ${t('optional')}` : ''}${paramsText(pre.params)}${pre.satisfiedBy ? ` · ${pre.satisfiedBy}` : ''}`,
                        ),
                      )
                    : null,
                  resources.length
                    ? detailSection(
                        t('sectionResources'),
                        lineRows(resources, (resource) => `${resource.id} · ${resource.title} · ${resStatusLabel(resource.status)}${resource.supersededBy ? ` → ${resource.supersededBy}` : ''}`),
                      )
                    : null,
                  causedBy.length
                    ? detailSection(t('sectionCauses'), lineRows(causedBy, (edge) => `${edge.type} · ${edge.ref}${edge.note ? ` · ${edge.note}` : ''}`))
                    : null,
                  commits.length
                    ? detailSection(t('sectionCommits'), lineRows(commits, (commit) => `${String(commit.hash || '').slice(0, 8)} ${commit.subject || ''}`.trim()))
                    : null,
                  !hasExtra ? h('div', { className: 'dpt-mark' }, t('noExtraInfo')) : null,
                  h('label', { className: 'dpt-field' }, t('taskTitle'), h('input', { className: 'dpt-input', disabled: readOnly, value: form.title, onChange: (event) => setForm({ ...form, title: event.target.value }) })),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8 } },
                    h(
                      'label',
                      { className: 'dpt-field', style: { flex: 1 } },
                      t('priority'),
                      h('select', { className: 'dpt-select', disabled: readOnly, value: form.priority, onChange: (event) => setForm({ ...form, priority: event.target.value }) }, PRIORITIES.map((value) => h('option', { key: value, value }, value))),
                    ),
                    h(
                      'label',
                      { className: 'dpt-field', style: { flex: 1 } },
                      t('urgency'),
                      h('select', { className: 'dpt-select', disabled: readOnly, value: form.urgency, onChange: (event) => setForm({ ...form, urgency: Number(event.target.value) }) }, URGENCIES.map((value) => h('option', { key: value, value }, urgencyLabel(value)))),
                    ),
                  ),
                  h(
                    'label',
                    { className: 'dpt-field' },
                    t('status'),
                    detail.children && detail.children.length
                      ? h('span', { className: 'dpt-meta-block' }, statusLabel(detail.task.status) + (zh ? '（父任务由子任务汇总）' : ' (derived)'))
                      : h(
                          'select',
                          { className: 'dpt-select', disabled: readOnly, value: form.status, onChange: (event) => setForm({ ...form, status: event.target.value }) },
                          (STATUS_OPTIONS[detail.task.status] || [detail.task.status]).map((value) => h('option', { key: value, value }, statusLabel(value))),
                        ),
                  ),
                  form.status === 'done' && !(detail.children && detail.children.length)
                    ? h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                        h(
                          'label',
                          { className: 'dpt-field' },
                          `${t('doneVersionLabel')}${versionRequired ? ' *' : ''}`,
                          h('input', {
                            className: 'dpt-input',
                            disabled: readOnly,
                            value: form.doneVersion,
                            placeholder: t('versionPlaceholder'),
                            spellCheck: false,
                            onChange: (event) => setForm({ ...form, doneVersion: event.target.value }),
                          }),
                          versionRequired && !String(form.doneVersion || '').trim() && detail.task.status !== 'done'
                            ? h('span', { className: 'dpt-hint dpt-hint--err' }, t('versionNeeded'))
                            : null,
                        ),
                        h(
                          'label',
                          { className: 'dpt-field' },
                          t('evidence'),
                          h('textarea', {
                            disabled: readOnly,
                            value: form.doneEvidence,
                            placeholder: t('evidencePlaceholder'),
                            onChange: (event) => setForm({ ...form, doneEvidence: event.target.value }),
                          }),
                        ),
                      )
                    : null,
                  h('label', { className: 'dpt-field' }, t('tags'), h('input', { className: 'dpt-input', disabled: readOnly, value: form.tags, placeholder: 'KB, 交付', onChange: (event) => setForm({ ...form, tags: event.target.value }) })),
                  h('label', { className: 'dpt-field' }, t('notes'), h('textarea', { disabled: readOnly, value: form.notes, onChange: (event) => setForm({ ...form, notes: event.target.value }) })),
                  h(
                    'div',
                    { className: 'dpt-field' },
                    t('owner'),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
                      h('span', { className: 'dpt-meta-block' }, task.holder || '—'),
                      h(
                        'button',
                        { className: 'dpt-btn', disabled: busy || !canAssign || readOnly, onClick: () => openAssign(task) },
                        t('assign'),
                      ),
                      task.holder && (task.status === 'doing' || task.status === 'blocked')
                        ? h('button', { className: 'dpt-btn', disabled: busy, onClick: () => releaseOwn(task) }, t('release'))
                        : null,
                    ),
                  ),
                  h('div', { className: 'dpt-meta-block', title: metaTitle }, metaBlock),
                  detail.parent ? h('div', { className: 'dpt-subtask', onClick: () => openDetail(detail.parent.id) }, `↑ ${t('parent')} ${detail.parent.id} ${detail.parent.title}`) : null,
                  detail.children && detail.children.length
                    ? h(
                        'div',
                        { className: 'dpt-field' },
                        t('children'),
                        h(
                          'div',
                          { className: 'dpt-subtasks' },
                          detail.children.map((child) =>
                            h('div', { className: 'dpt-subtask', key: child.id, onClick: () => openDetail(child.id) }, `${child.id} [${statusLabel(child.status)}] ${child.title}`),
                          ),
                        ),
                      )
                    : null,
                  detail.history && detail.history.length
                    ? h('div', { className: 'dpt-field' }, t('history'), renderHistoryFlow(task, detail.history))
                    : null,
                ),
                h(
                  'div',
                  { className: 'dpt-modal-foot' },
                  h('span', { className: 'dpt-sub' }, `更新 ${shortTime(detail.task.updatedAt)}${detail.archived ? ` · ${t('archivedShort')}` : ''}`),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6 } },
                    h('button', { className: 'dpt-btn', onClick: closeDetail }, t('cancel')),
                    readOnly
                      ? h('button', { className: 'dpt-btn dpt-btn--primary', onClick: closeDetail }, t('close'))
                      : h('button', { className: 'dpt-btn dpt-btn--primary', disabled: busy, onClick: saveDetail }, t('save')),
                    task.status === 'done' && !readOnly
                      ? h('button', { className: 'dpt-btn', disabled: busy, onClick: () => archiveOne(task) }, t('archive'))
                      : null,
                  ),
                ),
              ),
            )
          }

          const detailModal = detail && form ? buildDetailModal() : null

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
                  h('button', { onClick: () => downloadExport('md', 'all') }, `${t('exportMd')}（${t('exportAll')}）`),
                  h('button', { onClick: () => downloadExport('xlsx', 'all') }, `${t('exportXlsx')}（${t('exportAll')}）`),
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
            { className: 'dsh-project-todo' },
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
              error ? h('div', { className: 'dpt-alert' }, error) : null,
              notice ? h('div', { className: 'dpt-notice dpt-notice--' + notice.kind }, notice.text) : null,
              h(
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
              ),
              detailModal,
              briefModal,
              assignModal,
              doneModal,
              exportOpen ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 44, background: 'transparent' }, onClick: () => setExportOpen(false) }) : null,
              peopleOpen ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 44, background: 'transparent' }, onClick: () => setPeopleOpen(false) }) : null,
            ),
          )
        }

        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register({ name: 'conversation.view', id: 'todo', order: 5, label: () => t('nav') }, TodoView),
        )
      },
    }
  },
})
