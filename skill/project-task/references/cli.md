# ptask CLI 参考

数据在 `docs/ptask/`；CLI、DSH 页面、脚本共用同一套 `service.act()` 与文件锁。

## 全局参数

```
ptask <命令> [子命令] [参数] [--root DIR] [--by ACTOR] [--config FILE] [--json]
```

| 参数 | 说明 |
|---|---|
| `--root DIR` | 项目根；默认从 cwd 向上找 `docs/ptask/tasks.json`，找不到再看最近的 `.git`，都没有则用 cwd |
| `--by ACTOR` | 操作者；优先于 `PTASK_ACTOR` > git `user.name` > `DSH_SESSION_ID` > `cli-<用户>` |
| `--config FILE` | 指定配置文件；默认 `docs/ptask/config.json`（可缺省） |
| `--json` | stdout 只输出一个 JSON 文档；诊断与错误 JSON 走 stderr |
| `--help` | 分级帮助：`ptask --help` 全览 / `ptask task --help` 列子命令 / `ptask task update --help` 列参数与示例 |

列表参数（`--tags`、`--stages`、`--aliases`）支持逗号/顿号/分号分隔，也可重复传参。
PowerShell 会把未加引号的逗号当作参数分隔符，写 `--tags "KB,auth"` 或 `--stages "调研,实现"`。

`ptask --version`（无其他命令）打印包版本；`ptask schema --json` 返回全部命令、子命令、参数、示例的机器可读结构（Agent 自发现首选，不需要读源码）。

## Agent 的六个动作

### task ready

```
ptask task ready [--limit N] [--stage S-0002] [--milestone M-0001] [--json]
```

只返回**就绪叶子任务**：`status=open`、无 holder、硬依赖全部 done、必填前置条件满足、阶段/里程碑未归档。
`--limit` 取前 N 条；`--stage`/`--milestone` 过滤。JSON：`{ok,action:"ready",counts,tasks}`。

### task start

```
ptask task start <id> [--json]
```

认领并返回**开工简报**（`brief`）。已在本人名下时幂等，只回简报。
未就绪 → `NOT_READY`（10），提示上游依赖/未满足前置；若任务被他人持有、非 `open` 或所属阶段/里程碑已归档，也返回 `NOT_READY`（消息可能只有「尚未就绪」，先 `task get` 看 holder）。
并发抢同一任务/文件锁 → `CONFLICT`（4）。

JSON：`{ok,action:"start",message,task,brief,warning?}`。
`brief` 字段：`task / stage / milestone / goal / progress / decisions / upstreamDone / upstreamPending / changes / resources / openLoops / preconditions / blocking / nextStep`。

### task done

```
ptask task done <id> [--evidence "可复核证据"] [--version v] [--force] [--backfill] [--json]
```

仅当前持有者；`--evidence` 缺省时自动取 `git log --grep=<id>` 摘要；版本缺省自动取 git 短 hash。
完成时补默认 `context.progress`，并解锁下游。JSON：`{ok,action:"done",message,version,evidence,unlocked,warning?}`。

### task release

```
ptask task release <id> [--note "交接说明"] [--force] [--json]
```

把任务交还（`doing|blocked → open`），进度改写为「中断于 <时间>：<原进度>」，`--note` 追加到 `context.openLoops`。
JSON：`{ok,action:"release",message,handoff,warning?}`；`handoff = {id,title,progress,openLoops,note,nextStep}`。

### task block

```
ptask task block <id> --reason "..." [--json]
```

`open|doing → blocked`；`--reason` 必填，并追加到 `context.openLoops`。
解除用 `ptask task unblock <id>`（有人持有回 `doing`，否则回 `open`）。

### task create

```
ptask task create --title "..." [--stage S-0002] [--priority P0..P5] [--urgency 1..5]
                  [--tags a,b] [--parent <id>] [--notes "..."] [--claim] [--holder X]
                  [--container] [--blocked-by <id>]... [--dep-type hard|soft] [--json]
```

ID 由内核分配（`T-0001` 起，不复用）；默认 `P2`、urgency 3、阶段 `default`（未分类）。**默认 `holder=null`，新建任务直接进 `ready`**；`--claim`/`--holder X` 才占负责人，`--container` 预声明容器（不可开工，`--role task` 可撤销）。
`--blocked-by` 可重复，创建后立即加依赖（默认 `hard`）。标签未注册时自动建 `draft`，`tag.strict=true` 则报 `TAG_NOT_FOUND`。
JSON：`{ok,action:"create",message,task,warnings,warning?}`。

## 任务管理

```
ptask task list [--status open|doing|blocked|done|cancelled|all] [--tag T]
                [--stage S-0002] [--milestone M-0001] [--blocked] [--ready]
                [--archived] [--flat] [--json]
ptask task get <id> [--no-history] [--full] [--json]   # 备注默认截 300 字；JSON 始终全文
ptask task update <id> [--title t] [--priority P0..P5] [--urgency 1..5] [--tags a,b]
                     [--notes s] [--parent <id>] [--stage S-0002] [--role container|task]
                     [--status <s>] [--force] [--version v] [--evidence s]
ptask task status [--json]
ptask task suggest [--json]                  # 只读推荐 1 条 + 排序理由 + 备选
ptask task sync-parents [--dry-run] [--json] # 收口子任务已全完成的父任务
ptask task unblock <id>
ptask task reopen <id>
ptask task dep list <id> [--json]
ptask task dep add <id> --blocked-by <depId> [--type hard|soft] [--note s]
ptask task dep remove <id> --blocked-by <depId>
```

- `task list` 默认按里程碑/阶段分组显示（树），`--flat` 关闭分组；`--archived` 只列归档。
- `task get` 返回父/子、上下文、依赖（含被依赖）、前置、资料、最近历史、相关提交；`--no-history` 跳过历史。
- `task update` 至少给一个字段；状态字段也支持，但内部仍走同一状态机（等价于 claim/release/block/done）。`--version/--evidence` 可修正已完成任务。
- `task dep add` 加边后做全图成环检查；成环 → `DEPENDENCY_CYCLE`（8），且不落盘。
- `task status` 是只读总览：计数 + 进行中 + 建议优先。

## 里程碑与阶段

```
ptask milestone create --name "Q4 交付" [--description s] [--stages 调研,实现] [--json]
ptask milestone list [--json]
ptask milestone get <M-0001> [--json]
ptask milestone update <M-0001> [--name s] [--description s] [--status active|done|archived] [--order N]
ptask milestone delete <M-0001> [--force]
ptask milestone dep list <M-0001>
ptask milestone dep add <M-0001> --on <M-0002> [--note s]
ptask milestone dep remove <M-0001> --on <M-0002>

ptask stage create --name "实现" [--milestone M-0001] [--description s] [--status pending|active|done|skipped]
ptask stage list [--milestone M-0001] [--json]
ptask stage get <S-0002> [--json]
ptask stage update <S-0002> [--name s] [--description s] [--status ...] [--milestone M-0001] [--order N]
ptask stage reorder <S-0002> --order N
ptask stage delete <S-0002> [--move-to S-0001] [--force]
ptask stage dep list <S-0002>
ptask stage dep add <S-0002> --on <S-0001|M-0001> [--on-milestone] [--note s]
ptask stage dep remove <S-0002> --on <...> [--on-milestone]
```

- `milestone create` 会按 `--stages` 自动建阶段（无则建一个「未分类」；首个 active，其余 pending）。
- `default` 里程碑「默认」与 `default` 阶段「未分类」自动存在、不可删除；默认阶段不能移动、必须 active。
- `milestone delete --force` 把其下阶段迁到默认里程碑；`stage delete` 有任务时必须 `--move-to`，有下游阶段依赖时需 `--force`。
- 组织依赖只产生 `effectiveStatus=blocked_by_upstream`，**不阻塞任务就绪**。

## 标签

```
ptask tag add --name "知识库" [--code KB] [--description s] [--aliases 别名1,别名2] [--status active|draft|deprecated]
ptask tag update <code> [--name s] [--description s] [--aliases a,b] [--status ...]
ptask tag deprecate <code> [--replacement <新code>]
ptask tag list [--status active|draft|deprecated] [--json]
ptask tag todos <code> [--archived] [--json]
```

- 任务只存标签编码；`tag add` 的 code 默认取 name（合法编码）或 slug。
- `tag deprecate` 的替代标签用 `--replacement`（`--by` 已被全局 actor 占用）。
- 用户输入未注册标签：默认自动建 `draft`；`tag.strict=true` 时失败 `TAG_NOT_FOUND`。
- `tag list` 的 `usageCount` 由活跃+归档任务推导，不落库。

## 任务上下文

```
ptask context get <id> [--json]
ptask context decision <id> "决策内容"
ptask context progress <id> "当前进度" [--append]   # 默认覆盖，--append 才是追加
ptask context loop <id> "未关闭事项"
ptask context loop <id> --close 1
```

- 文本也可用 `--text "..."`。
- `decisions` 超过 `context.maxDecisions`（默认 50）、`openLoops` 超过 `context.maxOpenLoops`（默认 20）时，最旧条目折叠为一条 `[已折叠 N 条更早…，见时间轴]` 的 system 记录；原文仍在历史日志。

## 资料

```
ptask res add <id> --title "需求文档" [--type doc] [--url https://...] [--note s]
ptask res approve <id> <res-0001> [--note s]
ptask res supersede <id> <res-0001> --by-resource <res-0002>
ptask res list <id> [--status draft|approved|superseded] [--json]
```

资料是**任务内**列表，不是全局库。`--type` 是自由字符串（常用 `doc/design/repo/url`），默认 `doc`。
替换会标记旧资料 `superseded`，追加 `openLoops` 提醒复核，并出现在下一次开工简报的「变更提示」里。

## 前置条件

```
ptask pre add <id> --type task_done --target <taskId>
ptask pre add <id> --type tag_done --tag <code>
ptask pre add <id> --type resource_approved --resource <res-id>
ptask pre add <id> --type commit_exists --commit <hash>
ptask pre add <id> --type manual_confirm
ptask pre add <id> --type ... --optional          # 仅提示，不阻塞
ptask pre confirm <id> <pc-0001> [--note s]
ptask pre remove  <id> <pc-0001>
ptask pre list    <id> [--json]
```

- 多个前置条件是 AND；`required=false` 恒视为满足。
- 只有 `manual_confirm` 需要 `pre confirm`；其余类型在读取时实时判定（任务是否 done、标签是否全部 done、资料是否 approved、提交是否存在）。
- 未满足的必填前置会让任务不可 ready，`task start` 返回 `NOT_READY`。

## 因果

```
ptask cause add <id> --type task|feedback|decision|resource|external --ref <引用> [--note s]
ptask cause remove <id> --type ... --ref ...
ptask cause list <id> [--json]
ptask cause chain <id> [--depth 3] [--json]
```

`causedBy` 是权威方向；`type=task` 时自动在对方 `causes` 写反向边。因果纯叙事，**不影响就绪与排期**。

## Git

```
ptask git link [--dir DIR]
ptask git hook install [--dir DIR] [--force]
ptask git hook uninstall [--dir DIR] [--force]
```

- `link` 把仓库目录写入 `docs/ptask/config.json` 的 `version.gitDir`。
- `--dir` 默认当前 shell 目录（**不是** `--root` 的数据根）；从项目根执行或显式 `--dir <仓库>`。
- `hook install` 安装 `prepare-commit-msg`：提交时若设了 `PTASK_TASK`，追加 `Refs: T-xxxx`，便于 `done` 自动抓证据。
- 非 git 目录、钩子冲突分别返回 `NOT_FOUND` / `CONFLICT`。

## 时间轴

```
ptask timeline [--scope project|tag|task] [--tag T] [--task id] [--q 关键词]
               [--type task|dependency|org|tag|context|resource|precondition|cause|import]
               [--limit 20] [--json]
```

日志是独立追加文件，最新在前，默认 20 条、上限 200。`--scope task` 额外返回字段级变化。

## 诊断、初始化、迁移、技能

```
ptask whoami [--json]                 # root/actor 来源/gitName/数据路径/revision
ptask doctor [--json]                 # 包/Node/看板/组织/标签/git/actor/依赖环/context/资料/技能
ptask init [--template simple|standard]   # 建空看板 + 默认里程碑/阶段；standard 另建 tags/config
ptask migrate [--dry-run] [--keep-legacy] [--force]
ptask skill install|status|remove [--targets all|project|agents|dsh|zcode|workbuddy|claude|codex]
                                  [--copy] [--force] [--home DIR]
```

`migrate` 覆盖两种场景：旧 `.dsh/**` → `docs/ptask/**`；以及已在 `docs/ptask/` 的 v2 看板原地升级 v3（先备份到 `docs/ptask/.backup/v2-<时间>/`）。

## admin（页面/脚本专用，不要主动用）

```
ptask admin reopen <id>
ptask admin unblock <id>
ptask admin archive <id>
ptask admin unarchive <id>
ptask admin delete <id> [--cascade] [--purge]
ptask admin claim-batch [--tag T] [--limit N]
ptask admin release-batch [--tag T]
ptask admin check
ptask admin timeline [--scope ...]
ptask admin timeline-clear --confirm
ptask admin import [--source <path>] [--dry-run]
ptask admin import-file <file> [--format md|xlsx|json] [--dry-run] [--create-only]
ptask admin export [--format md|xlsx|json|html] [--scope active|archive|all]
                   [--template report|<path>] [--title "..."]
ptask admin templates [--json]
```

### 批量与报告通道（用户明确要求导出/批量登记时）

- **HTML 报告**：`admin export --format html --scope all` 生成单文件、无 CDN、离线可开的汇报页（KPI / 里程碑全景 / 状态与优先级分布 / 阻塞专项 / 明细筛选 / 口径说明）。`ptask admin templates` 列出内置模板绝对路径，复制出来改即可；`--template <name|path>` 指定模板，`--title` 改标题。Web 看板「导出」菜单同样有「导出 HTML 汇报页（含归档）」两项，固定用内置模板。
- **模板契约**：模板里放 `{{PTASK_DATA}}`（安全 JSON）与 `{{PTASK_TITLE/PROJECT/GENERATED_AT/SCOPE/TEMPLATE/TASK_COUNT}}`；数据含 `meta/kpi/statuses/priorities/tags/groups/blocked/tasks/labels`，完整说明写在模板文件头部注释里。缺 `{{PTASK_DATA}}` 会报 `PARSE_ERROR`。HTTP 面板只接受内置模板名，不接受任意路径。
- **JSON 幂等合并**：`admin export --format json` 导出完整记录（`dependsOn` 是 id 数组，`dependsOnDetail` 带类型/备注，派生容器带 `role:"container"`）。`admin import-file <file> --dry-run` 先预览；去掉 `--dry-run` 后按 id 合并（存在则只更新该行给出的字段、`context.decisions` 追加，不存在则新建且原 id 存 `legacyId`）。逐行返回 `created/updated/unchanged/failed` 与原因，含失败行退出码 1；跨项目复制用 `--create-only`。
- **补登记与父任务收口**：`task done --backfill --version <版本>` 跳过 doing 校验，时间轴记 `backfill`；`task sync-parents [--dry-run]` 修复子任务已归档/历史遗留导致父任务仍 open 的情况，并聚合子任务版本与证据。
- **时间轴管理事件**：清除 open 状态残留 holder 记 `holder_fix`（`category: admin`），默认时间轴隐藏；`timeline --all` 或 `--type admin` 查看。JSON 输出每条带 `category`。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 通用错误；批量 JSON 导入含失败行（看 `rows` 逐条原因） |
| 2 | 用法错误 |
| 3 | `NOT_FOUND`（任务/里程碑/阶段/资料/前置不存在） |
| 4 | `CONFLICT`（被他人持有、锁占用、已依赖、阶段仍有任务等） |
| 5 | `INVALID`（参数/状态非法） |
| 6 | `PARSE_ERROR` / `IO_ERROR`（JSON 损坏、读写失败） |
| 7 | `NO_PROJECT`（无法解析项目根） |
| 8 | `DEPENDENCY_CYCLE`（任务/里程碑/阶段依赖成环） |
| 9 | `TAG_NOT_FOUND`（严格模式下未注册标签） |
| 10 | `NOT_READY`（依赖或前置未满足，不能开工） |

## JSON 契约

- `--json`：stdout 恰好一个 JSON 文档；文本提示走 stderr。
- 变更类返回 `{ok:true, action, message, ...}`（只带该动作相关字段，不返回整块看板）；
  查询类返回 `tasks` / `task` / `entries` / `checks` 等完整对象。
- 错误统一为 stderr 一行：

```json
{ "ok": false, "code": "CONFLICT", "message": "T-0010 已被 wb-agent 持有" }
```
