# SPEC：项目待办插件（project todo board）

> 状态：**v4.0**（2026-11-04）。本文件取代 v0.4 / v2.x / v3.0 的全部旧描述；实现、UI、CLI 帮助与 README 以本文件为准。
>
> v4.0 相对 v3.0 的变化：
> 1. **三层组织**：里程碑（`M-0001`/`default`）→ 阶段（`S-0001`/`default`）→ 任务（`T-0001`，嵌套 ≤ 5）；新增 `milestones.json`。
> 2. **任务依赖**：`hard|soft`，带成环检测；新增「就绪」概念与 `task ready/start`。
> 3. **开工简报**：`task start` 一次返回阶段、目标、上游版本/证据、资料、未关闭事项、前置与下一步。
> 4. **任务上下文**：`context.goal/decisions/openLoops/progress`，超限自动折叠。
> 5. **前置条件、资料、因果**：`pre/res/cause` 命令；资料替换会提示复核。
> 6. **Actor 与 Git**：五级 actor 解析；`git link` / commit 钩子 / 自动完成证据。
> 7. **数据版本**：看板 v3、归档 v2、里程碑 v1、标签 v1；v2→v3 带备份迁移。
> 8. **退出码扩展**：8 `DEPENDENCY_CYCLE`、9 `TAG_NOT_FOUND`、10 `NOT_READY`。

## 1. 定位与边界

- **项目级**：数据属于项目，不是全局任务池。项目 = 会话工作目录解析出的项目根；同一项目的多个会话共享同一份待办。
- **agent 的工作目标**：待办是 agent 的默认目标来源；`ptodo` 是唯一命令入口，技能与提示词保证读得懂、改得对。
- **三层组织**：里程碑管交付节奏，阶段管批次/模块，任务管可执行叶子；任务通过 `stageCode` 归属阶段。
- **不是**：DSH 内置 `todo_write` 的替代（那是会话内计划清单）；也不是 Jira 式协作系统（无评论/附件/多人指派）。

## 2. 交付形态

- 包：`@local/dsh-project-todo`（目录 `dsh-plugins/dsh-project-todo`），bin 为全局命令 `ptodo`。
- Host 半边：项目解析、JSON store、org/tag store、Markdown 快照、CLI、HTTP（供 Web UI）。
- Client 半边：`conversation.view` 标签页「待办」；**不注册** `sidebar.panellist` / `main`。
- **不再注册任何 model-facing `ptodo_*` 工具**；CLI 与页面共用 `service.act()` 与 `getState/getTask/getTimeline`。

## 3. 项目解析

输入是会话或 CLI 的 cwd，输出项目根：

1. 从起点向上最多 9 层，**先整条链找 `docs/ptodo/todos.json`**，命中即该目录；
2. 都没有，再整条链找 `.git`，命中即该目录；
3. 都没有 → 用 cwd 本身，首次写入时创建数据目录。

CLI 可用 `--root DIR` 覆盖；`PTODO_ROOT` 次之。UI 侧由 Host 用 `workingDirectory.get(session)` 解析，浏览器不传路径；解析失败 → `NO_PROJECT`。

## 4. 数据模型

### 4.1 `docs/ptodo/todos.json`（v3）

```jsonc
{
  "version": 3,
  "project": "fuyao-ai",
  "nextId": 44,
  "revision": 43,
  "updatedAt": "2026-11-04T15:00:00.000Z",
  "tasks": [ /* 见下表 */ ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `T-0001` 起单调分配、不复用；只由内核分配 |
| `legacyId` | string\|null | 外部旧编号（导入保留） |
| `parentId` | string\|null | 父任务；深度 ≤ 5，禁止环 |
| `title` | string | 非空，≤ 200 字 |
| `status` | enum | `open/doing/blocked/done/cancelled` |
| `priority` | enum | `P0..P5`（P0 最高，默认 P2） |
| `urgency` | int | `1..5`（5 最急，默认 3） |
| `holder` | string\|null | 当前持有者；父任务恒 null |
| `stageCode` | string | `default` 或 `S-\d{4,}` |
| `tags` | string[] | 标签**编码**（注册表在 `tags.json`）；旧 `group` 读取时并入 |
| `notes` / `size` | string / string\|null | 自由备注 / 规模 |
| `context` | object | `{goal, progress, decisions[], openLoops[]}` |
| `dependsOn` | array | `[{id, type: hard\|soft, note}]` |
| `preconditions` | array | `[{id: pc-0001, type, params, required, satisfied, satisfiedBy, confirmedAt}]` |
| `resources` | array | `[{id: res-0001, type, title, url, note, status, supersededBy, approvedBy, approvedAt, ...}]` |
| `causedBy` / `causes` | array | `[{type: task\|feedback\|decision\|resource\|external, ref, note, by, at}]` |
| `createdBy/claimedBy/doneBy/releasedBy` | string\|null | person（git user.name）快照 |
| `createdAt/updatedAt/statusChangedAt` | ISO string | 状态变化只动 `statusChangedAt` |
| `claimedAt` | ISO\|null | 认领时间 |
| `doneAt/doneVersion/doneEvidence` | — | 完成时间 / 版本 / 证据 |
| `archivedAt/archivedBy/archiveExempt` | — | 归档与自动归档豁免 |
| `revision` | int | 单任务修订号（每次写入 ++） |

`context` 结构：

```jsonc
{
  "goal": "为什么做/验收目标",
  "progress": "当前做到哪",
  "decisions": [{ "text": "...", "by": "codex:zhangsan", "at": "..." }],
  "openLoops": [{ "text": "...", "by": "...", "at": "..." }]
}
```

### 4.2 `docs/ptodo/milestones.json`（v1）

```jsonc
{
  "version": 1, "revision": 0, "updatedAt": "...",
  "nextMilestoneId": 2, "nextStageId": 3,
  "milestones": [{
    "code": "M-0001", "name": "默认", "description": "",
    "status": "active", "order": 0,
    "dependsOnMilestone": [{ "code": "M-0002", "note": "" }],
    "createdAt": "...", "updatedAt": "...", "revision": 0
  }],
  "stages": [{
    "code": "S-0001", "milestoneCode": "M-0001", "name": "未分类",
    "description": "", "status": "active", "order": 0,
    "dependsOnStage": [{ "code": "S-0002", "note": "" }],
    "dependsOnMilestone": [{ "code": "M-0001", "note": "" }],
    "createdAt": "...", "updatedAt": "...", "revision": 0
  }]
}
```

- `default` 里程碑「默认」、`default` 阶段「未分类」始终存在且不可删除；默认阶段固定挂默认里程碑、状态恒 `active`。
- 文件缺失时**读取即合成**（不写盘）；`ptodo init` 写入；`ptodo migrate` 也会创建。

### 4.3 `docs/ptodo/tags.json`（v1）

```jsonc
{
  "version": 1, "revision": 3, "updatedAt": "...",
  "tags": [{
    "code": "KB", "name": "知识库", "description": "",
    "aliases": ["knowledge"], "status": "active|draft|deprecated",
    "deprecatedBy": null, "createdAt": "...", "updatedAt": "..."
  }]
}
```

- 标签编码 `^[A-Za-z][A-Za-z0-9._-]{0,31}$`；任务只存编码。
- 未知标签默认自动登记为 `draft`；`tag.strict=true` 时抛 `TAG_NOT_FOUND`。
- `usageCount` 由活跃+归档任务派生，不落库。

### 4.4 `docs/ptodo/archive.json`（v2）

```jsonc
{ "version": 2, "project": "...", "revision": 5, "updatedAt": "...", "tasks": [ /* 同任务结构 + archivedAt/archivedBy */ ] }
```

### 4.5 `docs/ptodo/todos.history.jsonl`

每行一条 JSON，只追加；看板/组织/标签共用：

```jsonc
{ "at": "...", "revision": 44, "action": "done", "by": "codex:zhangsan",
  "taskIds": ["T-0007"], "transitions": [{ "id": "T-0007", "from": "doing", "to": "done" }],
  "before": [ /* 快照 */ ], "after": [ /* 快照 */ ] }
```

组织/标签条目用 `entity: "org"|"tag"` + `changes[]`；依赖解锁额外写 `dependency_resolved`。

### 4.6 校验

- 看板：版本必须为 3；`nextId` 正整数、`revision` 非负；任务 ID 唯一且匹配 `^T-\d{4,}$`；`priority`/`urgency`/`status` 枚内；`parentId` 存在、深度 ≤ 5、无环；`doing` 叶子必须有 holder；`stageCode` 必须存在于 org。
- 归档：版本 2；任务读取后强制 `status=done` 并补 `archivedAt`。
- 组织：版本 1；编码唯一；阶段必须指向存在的里程碑；默认节点存在；里程碑/阶段的同类依赖不得自指、目标必须存在、成环 → `DEPENDENCY_CYCLE`。
- 标签：版本 1；编码唯一；`deprecatedBy` 合法。
- 损坏 JSON / 版本不符 → `PARSE_ERROR`，拒绝写入并保留原文件。

## 5. 三层组织与派生

```
Milestone ──< Stage ──< Task（stageCode）
```

- 组织依赖：阶段可依赖阶段/里程碑，里程碑可依赖里程碑；目标未 `done` → 该节点 `effectiveStatus=blocked_by_upstream`。
- **组织依赖永不阻塞任务就绪**；任务就绪只看任务硬依赖与前置条件。
- 派生字段（只读，每次读取重算、永不落库）：

| 作用域 | 字段 |
|---|---|
| 任务 | `effectiveStatus`、`isReady`、`blocking`、`preconditions[].satisfied`、`staleResources`、`stageName`、`milestoneCode`、`milestoneName`、`parentProgress` |
| 阶段 | `effectiveStatus`、`progress{done,total}` |
| 里程碑 | `effectiveStatus`、`progress{done,total}` |
| 全局 | `counts.ready`、`counts.blockedEffective`、`counts.archived`、标签 `usageCount` |

`effectiveStatus`：`done/cancelled` 原样；否则有未完成硬依赖或未满足必填前置 → `blocked`；否则原状态。

## 6. 状态机、依赖、就绪、简报与交接

### 6.1 状态机

```
create → open
open | blocked --start/claim--> doing      （claim 遇他人持有 → CONFLICT；start 遇他人 doing → NOT_READY）
doing --release--> open                     （写「中断于 …」+ openLoop + handoff）
doing --done--> done                        （仅持有者；force 才可越权）
open | doing --block--> blocked             （--reason 必填）
blocked --unblock--> doing | open
done | cancelled --reopen--> open
任意非 done --取消--> cancelled
```

- 父任务 = 容器：不可 claim/release/done/block；状态由子任务自底向上派生，holder 恒 null。
- 子任务：全 cancelled → cancelled；非 cancelled 全 done → done；任一 doing → doing；否则 open。

### 6.2 依赖与就绪

| 类型 | 影响 |
|---|---|
| `hard` | 未完成 → `effectiveStatus=blocked`，不可 ready/start |
| `soft` | 仅提示，不影响就绪 |

`isReady = 叶子 && status=open && 无 holder && 阶段/里程碑未 archived && effectiveStatus=open`。
`task ready` 只返回 `isReady` 的叶子；`task start` 先判 `isReady`，不就绪 → `NOT_READY`（10）。
依赖只能加在叶子任务上；给父任务加依赖 → `INVALID`。加依赖时全图 DFS；成环 → `DEPENDENCY_CYCLE`（8），回滚该边。归档中的 `done` 任务仍可满足依赖。

### 6.3 前置条件

类型：`task_done/tag_done/resource_approved/commit_exists/manual_confirm`；多个 AND；
`required=false` 恒满足。只有 `manual_confirm` 存 `satisfied`，其余读取时实时判定。

### 6.4 开工简报

`start` 返回：任务/阶段/里程碑、goal/progress、最近 3 条决策、已完成上游（版本/证据/交接）、未完成上游、变更提示（资料被替换、上游更新）、资料分组、未关闭事项、前置条件、被依赖、`nextStep`。
同持有人重复 `start` 幂等；简报已含 `get` 所需信息，**不需要再 `get`**。

### 6.5 释放与交接

`release` 把 `doing|blocked → open`，`progress` 写「中断于 <时间>：<原进度>」，`--note` 追加到 `openLoops`，返回 handoff，下一位 `start` 可见。

### 6.6 上下文折叠

`decisions` 上限 50、`openLoops` 上限 20（可配）；超限时最旧条目折叠为一条 `system` 摘要，原文仍在历史日志。

## 7. 排序、并发、存储与快照

- Agent 排序：`priority`（P0 先）→ `urgency`（5 先）→ `createdAt`（早先）→ id。
- 面板排序：已认领按 `claimedAt`，未认领在后按 `createdAt`。
- 每次变更：进程内队列 + `.lock`（`O_CREAT|O_EXCL`，含 pid/时间）→ 重读 → 校验 → 变更 → `revision+1` → 原子写（temp+fsync+rename）→ 追加日志 → 重写快照。
- 锁等待 2 秒，超 10 秒视为陈旧；获取失败 → `CONFLICT`。
- 读取容忍文件缺失（空看板）；自动归档在读取时 sweep：`archive.afterDays`（默认 3，0 关闭）后把完成的**叶子**移入 `archive.json`，写 `auto_archive` 日志并重写快照。
- Markdown 快照：每次成功变更后写 `.dsh/TODO.md` / `.dsh/ARCHIVE.md`，格式与 v1 相同（单表、父子缩进、完成/归档信息），只写不读；失败仅 warning。

## 8. 命令契约

### 8.1 Agent 六个动作

| 命令 | 行为 |
|---|---|
| `ptodo task ready [--limit N] [--stage S] [--milestone M]` | 只列就绪叶子 |
| `ptodo task start <id>` | 认领 + 开工简报；不就绪 `NOT_READY` |
| `ptodo task done <id> [--evidence] [--version] [--force]` | 完成；自动证据/版本；解锁下游 |
| `ptodo task release <id> [--note] [--force]` | 释放 + 交接 |
| `ptodo task block <id> --reason` | 阻塞并把原因写入 openLoops |
| `ptodo task create --title ... [--stage] [--priority P0..P5] [--urgency 1..5] [--tags a,b] [--parent] [--blocked-by] [--notes]` | 新建；编码自动分配 |

### 8.2 管理命令

```
task      list|get|update|status|dep add|remove|list|unblock|reopen
milestone create|list|get|update|delete|dep add|remove|list
stage     create|list|get|update|reorder|delete|dep add|remove|list
tag       add|update|deprecate|list|todos
context   get|decision|progress|loop
res       add|approve|supersede|list
pre       add|remove|list|confirm
cause     add|remove|list|chain
git       link | hook install|uninstall
timeline  [--scope project|tag|task] [--type task|dependency|org|tag|context|resource|precondition|cause|import] [--task id]
whoami | doctor | init [--template simple|standard] | migrate | skill install|status|remove
```

页面/脚本动作：`ptodo admin reopen|unblock|archive|archive-batch|unarchive|delete|claim-batch|release-batch|check|timeline|timeline-clear|import|import-file|export|people`（不进技能主流程提示词）。

### 8.3 兼容别名（隐藏，不教给 agent）

`status/list/get/next/continue/create/claim/release/block/done/update/admin`，以及 `unclaim`（= release）。
`next`/`continue` 是 v1 的批量认领入口（默认 1/3 条），保留给旧脚本；v2 技能只教 `task ready/start`。

### 8.4 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 通用错误 |
| 2 | 用法错误 |
| 3 | NOT_FOUND |
| 4 | CONFLICT |
| 5 | INVALID |
| 6 | PARSE_ERROR / IO_ERROR |
| 7 | NO_PROJECT |
| 8 | DEPENDENCY_CYCLE |
| 9 | TAG_NOT_FOUND |
| 10 | NOT_READY |

`--json` 时 stdout 恰好一个 JSON；错误 JSON 到 stderr：`{ok:false, code, message}`。

## 9. Actor

解析优先级：`--by` > `PTODO_ACTOR` > git `user.name` > `DSH_SESSION_ID` > `cli-<用户名>`。

- 每次解析同时给出 `person`：优先 git `user.name`（本地仓 → 全局），没有 git 时取 `--by/PTODO_ACTOR` 去掉一个 `<工具>:` 前缀，再回落到 actor。
- **人字段存 `person`**：`holder`、`createdBy/claimedBy/doneBy/releasedBy`、`archivedBy`、`context.*.by` 的“人”语义；历史日志的 `by` 仍记 actor（保留工具区分）。
- 新建任务默认负责人：CLI 传 `holder=person`，UI 传当前操作人（默认 person）；service 不自动加 holder。
- agent 建议格式 `<agent>:<name>`（`codex:zhangsan`）；`whoami` 显示 `actor/person/source/gitName/hasPrefix`。
- git 名从 `.git/config`（worktree 用 `commondir`）或 `~/.gitconfig` 读取，不 spawn 子进程。
- `actor.requirePrefix` 只提示，不阻断。

## 10. 配置（`docs/ptodo/config.json`，可缺省）

```yaml
store:      { path: docs/ptodo/todos.json }
milestones: { path: docs/ptodo/milestones.json }
tags:       { path: docs/ptodo/tags.json }
archive:    { afterDays: 3, path: docs/ptodo/archive.json }
history:    { enabled: true, path: docs/ptodo/todos.history.jsonl }
markdown:   { enabled: true, path: .dsh/TODO.md, archivePath: .dsh/ARCHIVE.md, doneLimit: 20 }
version:    { auto: true, require: true, gitDir: "" }
ui:         { enabled: true, defaultTab: auto }   # auto|all|ready|doing|blocked|done|archived
tag:        { strict: false }
dependency: { suggestOnCreate: true }
context:    { maxDecisions: 50, maxOpenLoops: 20 }
actor:      { requirePrefix: false }
skill:      { targets: [project, agents, dsh, zcode, workbuddy, claude, codex] }
batch:      { claimLimit: 3 }
```

优先级：默认值 < 文件 < loader 行配置；非法值回退默认值，不阻断加载；配置文件损坏是硬错误。

## 11. Git 集成

- 完成版本：显式 `--version` → `version.gitDir` → 会话 cwd → 项目根；先纯文件读 HEAD（`.git` 目录/文件、`commondir`、loose refs、`packed-refs`），取不到再尝试 `git rev-parse --short HEAD`。
- `version.require=true` 且取不到 → 拒绝完成；否则版本可空。
- 自动证据：`git log --grep=<taskId>` 前 3 条摘要；`done --evidence` 优先。
- `git link` 写 `config.version.gitDir`（`--dir` 默认当前 shell 目录，不是 `--root`）；`git hook install` 安装 `prepare-commit-msg`，在 `PTODO_TASK` 存在时追加 `Refs: T-xxxx`。
- 所有 git 调用 best-effort：非仓库/沙箱拒绝子进程时降级为「无数据」，不阻断 ptodo。

## 12. UI 契约

- 注册 `conversation.view`，`id="todo"`，label 走 locale（zh 待办 / en Todo）。
- 页面按契约消费 Host HTTP（仅 loopback）：
  - `GET /dsh-project-todo/state?sessionId=…` → 任务（含派生字段）、里程碑/阶段、标签、counts、actor（含 person）；
  - `GET /dsh-project-todo/people?sessionId=…` → `{ person, people:[{ name, source, active, done, related }] }`
    （**仅 git 历史作者**；当前 person 也必须是 git 作者；任务里的工具名/session id 不再作为人员）；
  - `GET /dsh-project-todo/task?id=…&sessionId=…` → 任务 + 父/子 + 历史 + 前置 + 被依赖 + 资料 + 相关提交；
  - `GET /dsh-project-todo/timeline?sessionId=…&scope=…&tag=…&taskId=…&q=…&type=…&limit=20`；
  - `GET /dsh-project-todo/version?sessionId=…` → 完成版本预取；
  - `GET /dsh-project-todo/export?…`、`POST /dsh-project-todo/import`（base64）；
  - `POST /dsh-project-todo/action`（body 含 `sessionId` 与 action）。
- 写请求鉴权：回环 + 四选一（`x-dsh-project-todo-token`、同源 Origin、`sec-fetch-site: same-origin`、`x-dsh-project-todo-client: 1`）。
- **布局**：紧凑表格（`dpt-table`，min-width 940，窄屏横向滚动；外层 1080px），不再使用大卡片流。
  列：状态 / ID / 任务标题（父子缩进、依赖 ⛓ N、前置 ⏳ N、版本、标签）/ 优先级 / 紧急度 /
  里程碑·阶段（只显示 name，`title=code`；**分组视图下隐藏该列**）/ 负责人 / 更新时间 / 操作。
- **视图切换**：工具栏「视图」下拉三档，写入 localStorage（`dsh-project-todo-view`）：
  - `auto`（默认）：看板只有 `default` 里程碑与阶段时**平铺**，存在其他里程碑或非默认阶段时**按里程碑分组**；
    当前实际结果通过 `title` 提示。单一默认组织不渲染任何组头。
  - `flat`：强制平铺（无里程碑/阶段组头，父子仍以缩进+折叠展示）。
  - `grouped`：强制按里程碑分组，即使只有默认组织。
  平铺与分组共用同一套行操作（开始/完成/恢复/指派/详情）；已完成、已归档始终平铺。
- **Tab 固定顺序**：全部 / 就绪 / 进行中 / 被阻塞 / 已完成 / 已归档；**计数跟随当前筛选**
  （tag、搜索、里程碑、阶段）：全部 = 过滤后的活动任务数；就绪 = `isReady`；进行中 = `status=doing`；
  被阻塞 = `effectiveStatus=blocked`；已完成 = `status=done`；已归档 = 过滤后的归档条数。
- **默认 tab**：`ui.defaultTab` 有效值优先；`auto` 时有 doing → 进行中，否则有 ready → 就绪，否则全部。
- **筛选/排序**：标签、搜索、里程碑、阶段；阶段下拉只列当前里程碑的阶段且 value=code/显示 name。
  排序：优先级（P0→P5，再紧急度、更新时间）/ 最近更新 / 创建时间（新→旧），纯前端、只影响当前列表。
- **分组视图层级**（全部/就绪/进行中/被阻塞）：里程碑 → 阶段 → 任务三级均可折叠；
  - 里程碑行：品牌色左侧竖条 + 组头 name（`title=code`）+ 编码徽标 + `effectiveStatus` + 任务数 + 进度条/进度；
  - 阶段行：缩进 30px、浅色底、组头 name + 编码徽标 + 任务数 + 进度；`blocked_by_upstream` 显示 ⚠；
  - 任务行：状态列缩进 44px，并以竖线 + 短横线连到所属阶段；子任务再缩进一级；default 收件箱置底。
  - **计数与进度跟随过滤**：组头任务数 = 当前 tab 下该组实际展示的任务数；进度 = 当前过滤（含人员）
    下活跃+归档任务的 done/total，人员过滤变化时两者同步变化，不再用全局 progress。
  已完成/已归档为扁平表。
- **只读原则**：详情对 context/依赖/阻塞/前置/资料/因果/相关提交只展示（空区块隐藏），
  **不提供**这些字段的 UI 编辑入口；避免绕过 CLI 造成数据不一致。
- **可写操作仅限**：
  - 基础状态：开始（`start`）/ 完成（`done`，完成弹窗版本+证据）/ 阻塞恢复（`unblock`）/ 释放（`release`，可带说明）；
  - 指派负责人：行内/详情「指派」从人员列表选择（**只接受 git 作者**；手填非 git 名会被服务端 `INVALID` 拒绝），调用 `claim`（`by=人员, holder=人员, force=true`），done/cancelled/父任务禁用；
  - 归档：已完成任务行内「归档」（`archive`）与「批量归档」（`archive_batch`，当前筛选内的全部已完成，需确认）；
  - 任务描述：标题/优先级/紧急度/标签/备注（`update`）；状态下拉只列合法迁移。
- **不提供的写入口**：删除任务、取消归档、导入、批量认领/释放、清空日志（这些只走 `ptodo admin`）。
- **人员过滤**：工具栏「人员」下拉，默认「与我相关」（person 命中 holder/createdBy/doneBy），
  支持勾选多人与「全部人员」；计数/Tab 跟随该过滤。人员来源 = **仅 git 历史作者**（`GET /people`）；
- **Holder/操作人**：工具栏「操作人」localStorage 优先，否则 `state.actor.person`，作为所有动作的 `person`
  （工具身份仍以 `--by` 记账）；负责人列/详情显示 holder，已完成任务额外显示完成人与完成时间。
- **保留的只读入口**：导出 md/xlsx（active/all）、刷新、校验、搜索/筛选/排序；快速新建（标题/P/紧急度/阶段，
  当前标签筛选值作为 create tag；默认负责人 = 当前操作人）。
- **XLSX 导出（v2.2）**：纯 JS 生成（`node:zlib`，无 Python/openpyxl/辅助脚本路径依赖）；
  `总览` = KPI + 状态/优先级/里程碑/标签统计 + 4 张原生图表；`任务明细` = 配色/隔行/冻结/筛选/打印设置；
  标签列与标签 Top 用注册表 `name`（缺失回退 `code`），回导按 `code/name/alias` 还原编码；
  导出失败返回 HTTP 500 + JSON，面板展示错误而不是保存坏文件。
- **里程碑完成提示**：`done` 返回 `milestone.complete=true` 时提示「里程碑已全部完成，可在已完成页归档」。
- **开工简报弹窗**：渲染 `start` 返回的 `brief`，分区展示
  `goal/progress/decisions/upstreamDone/upstreamPending/changes/resources/openLoops/preconditions/blocking/nextStep`；
  X / 遮罩 / Esc 关闭。
- **详情弹窗**：只读展示阶段/里程碑、context、依赖、blocking、前置、资料、causedBy、relatedCommits、
  父子跳转；编辑区仅 description/status/assign/release。**「最近变更」以竖向流转图呈现**：
  每个历史节点一行显示动作、操作人、状态 `from → to` 内联徽标与时间（新建/开工/完成/阻塞等按状态着色），
  不再用纯文本行，也不重复末尾当前状态节点（当前状态由页脚与状态下拉展示）。
- **详情信息不重复**：头部只放里程碑/阶段/实际状态徽标；owner/状态/优先级/版本/证据各有控件；
  meta 区只保留「创建/更新/认领/状态更新/完成时间」与（完成人与负责人不同时）完成人，避免同一字段出现两次。
- 无时间轴图表页签；视觉细节以 `client.js` 为准。

## 13. 迁移

- **v2 → v3（当前）**：`ptodo migrate --dry-run` 预览；`ptodo migrate` 原地升级并备份到 `docs/ptodo/.backup/v2-<时间>/`；重建默认里程碑/阶段、把标签登记为 `draft`。不跑 migrate 时，首次写入也会自动备份 v2 文件。
- **旧 `.dsh` 布局 → `docs/ptodo/`**：`ptodo migrate` 保留任务/ID/revision/nextId，旧 history 丢弃，成功后删旧 JSON（`--keep-legacy` 保留）；目标已存在且不同 → `CONFLICT`，`--force` 先备份再覆盖。
- 不做旧布局回退；`doctor` 提示待迁移。

## 14. 快照与历史

- 快照 `.dsh/TODO.md` / `.dsh/ARCHIVE.md` 只写不读；格式不变（单表、父子缩进、标签列、归档完成/版本/证据）。
- 历史日志独立、只追加、可清空（`admin timeline-clear --confirm` 只截断日志，不动任务/归档/revision）。
- 删除任务不回写日志；时间轴可追溯到已删除任务。

## 15. 技能与提示

- `skill/project-todo/` 是跨工具技能；`ptodo skill install` 安装到 7 个目标（project/agents/dsh/zcode/workbuddy/claude/codex）。
- `index.js` 注入两段提示：常驻 systemPrompt（唯一入口、六个动作、禁止手改）与会话摘要（计数 + 进行中 + 就绪优先，≤400 字）。
- 不做工具调用拦截、不做 audit；强制依赖技能 G0–G4 与 `--evidence` 可见性。

## 16. 兼容与版本

- 数据版本：store 3、archive 2、milestones 1、tags 1；未来结构变化升版本并提供迁移。
- 命令面：`task/milestone/stage/tag/context/res/pre/cause/git` 域 + 兼容别名；发布后不复用旧命令名，新能力只加子命令/可选参数。
- 包版本以 `package.json` 为准（v2 升级对应 2.0.0）；不注册 model-facing 工具是刻意设计。
- 组织依赖不阻塞任务是刻意设计（避免「排期锁死」）；需要严格门禁时用任务前置条件。

## 17. 测试

`node --test`（`test/*.mjs`）覆盖：

- `actor`：五级解析、git 配置读取（含 worktree/commondir）、env 优先级；
- `cli` / `cli-v2`：init/whoami、create→ready→start→done→list、退出码、嵌套仓库根解析、`.dsh` 迁移；
  `cli-v2` 另覆盖 `NOT_READY`(10)、milestone/stage/tag/context/pre/res/cause 子命令、block 必填原因、`timeline --type`；
- `config`：默认路径、文件合并、根解析优先级、纯文件 git 解析；
- `deps-ready`：硬依赖隐藏/解锁、软依赖不阻塞、成环、release 交接、block 原因、start 幂等；
- `org-tags`：里程碑建阶段、默认 inbox、阶段依赖只标记不阻塞、里程碑成环、标签 draft/deprecate/strict、usageCount；
- `v3-schema` / `migrate-v3`：v2 读取归一化、initOrg、stage 校验、首次写备份、缺文件合成、未知字段保留；
  `migrate-v3` 另覆盖 dry-run 不写盘、备份目录、revision/nextId 保留与 v3 幂等；
- `store` / `state`：原子写/日志/快照、自动归档与恢复、并发 claim 唯一赢家、坏 JSON 拒绝；
  `state` 另覆盖 getState 派生字段、getTask 前置/阶段/提交、Markdown 导出的阶段/里程碑列；
- `model`：父状态派生、容器限制、环/深度、group→tags、排序、批量、状态时间、编码分配、完成版本/证据；
- `context-pre-cause`：决策折叠、task_done/manual_confirm 前置、资料替换 stale、因果镜像与链路；
- `markdown`、`timeline`、`version`、`transfer`、`import`、`skill`、`plugin`。

## 18. 决策记录

1. **三层而非两层**：任务直接挂阶段，阶段挂里程碑；任务不直接挂里程碑，避免归属二义。
2. **default 不可删**：保证任何新任务都有 inbox，不会因缺阶段而无法创建。
3. **组织依赖只做组织**：stage/milestone 的 `blocked_by_upstream` 只影响组织视图；任务门禁由 `dependsOn` 与前置条件承担。
4. **派生不落库**：`effectiveStatus/isReady/blocking/progress/usageCount` 每次读取重算，避免状态漂移。
5. **start 即认领**：用一条命令完成「检查就绪 + 认领 + 简报」，减少 agent 往返；简报聚合 get/dep/res/pre 的信息。
6. **release 必须留痕**：中断进度与 note 自动进入 context/openLoops/handoff，交接不靠口头。
7. **上下文有界**：决策/未关闭事项超限折叠为 system 摘要，原文留在独立日志。
8. **标签注册表**：任务只存编码，注册表集中管理别名/废弃/替代；未知标签默认 draft（`strict` 可选）。
9. **actor 五级解析**：优先显式 --by，其次环境变量，再 git 名，最后会话/系统；不因缺前缀阻断。
10. **v2/v3 数据升级内建备份**：`migrate` 与首次写入都先备份，迁移可 dry-run。
