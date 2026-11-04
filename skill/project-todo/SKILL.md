---
name: project-todo
description: "Use at the start, during, and end of ANY development task in this repository — implementing, fixing, refactoring, testing, reviewing, documenting, delivering — even when the user never mentions todos. 强制：开工先 ptodo task ready（用户说「继续开发」→ ptodo task ready --limit 3），用 ptodo task start <id> 认领并拿开工简报；进行中用 ptodo context / task block / task release 写回；完成用 ptodo task done <id> --evidence；收尾用 ptodo task status 确认并给结论行。完成人/负责人是 git user.name（person），--by 只是工具身份；done 返回 milestone.complete=true 时必须先问用户是否归档，确认后才 ptodo admin archive-batch --milestone。触发词：待办、任务、开工、认领、就绪、下一步、继续、修 bug、实现需求、排期、完成、交接、谁在做、归档、负责人。纯只读问答可跳过认领。"
---

# 项目待办（ptodo v2）

本仓库的待办**只有一套**：数据在 `docs/ptodo/`，唯一入口是终端命令 `ptodo`。
本技能不是建议，是执行协议：**没有记录到 ptodo 的工作，不算开始，也不算完成。**

## 铁律

1. 只用 `ptodo`；不要手改 `docs/ptodo/*.json`，不要用 `开发计划/todo/TODO.md`、`.dsh/TODO.md` 或会话内 todo 清单代替。
2. 三层模型：里程碑（`M-0001`）→ 阶段（`S-0001`）→ 任务（`T-0001`）；`default/默认` 与 `default/未分类` 自动存在、不可删除，新建任务默认落到「未分类」。
3. 任务编码由内核分配；禁止编造或手填 `T-xxxx`。父任务由子任务汇总，不要认领/完成父任务。
4. 不要动他人持有的任务；被持有时换一条（可能表现为 `NOT_READY` 或 `CONFLICT`），先看 holder，不要默认 `--force`。
5. 依赖与前置条件由系统判定。`NOT_READY` 时看原因（硬依赖未完成 / 前置未满足 / 被他人持有 / 非 open），不要绕过或强开。
6. 同一件事不要重复 `task create`：先 `ptodo task ready` 或 `ptodo task list` 按标题/`legacyId` 查重。
7. **需求未校验不得开工**：`task start` 之后先按 `references/requirements.md` 做 G0.5 三查；命中「已取代/已作废」的文档不得采纳其 DoD。
8. 里程碑/阶段之间的依赖只影响组织状态 `blocked_by_upstream`，**永远不会阻塞任务**；任务能不能开工只看任务硬依赖与前置条件。

## 执行门（必须按顺序）

### G0 开工：先读就绪，再领简报

任何会改文件、跑构建、产出交付物的回合，第一步执行：

```bash
ptodo task ready --limit 3
```

- 只返回**未指派的就绪叶子任务**（硬依赖已完成、必填前置条件已满足、未被他人持有、所属阶段/里程碑未归档）。**已指派给你（holder=你）的任务不在 ready 里**，直接 `task start` 即可。
- 用户点名任务：直接 `ptodo task start <T-xxxx>`；不知道 ID 时用 `ptodo task list --status open` 找。
- 用户说「**继续开发待办**」「**继续开发**」「继续」「下一步」且**没有指定任务/上下文**：
  直接 `ptodo task ready --limit 3`，从第一条开始 `task start`，不要反问「做哪个」。
- 看板为空：`ptodo task create --title "..." --priority P2`，再 `task start <新 ID>`（create 会把负责人设成当前 person，所以新任务不会出现在 `task ready`，但 `start` 仍可直接认领）。
- 只读总览可用 `ptodo task status`（计数 + 进行中 + 建议优先）。

### G0.5 需求校验：认领后、改文件前

任务排期正确 ≠ 需求口径正确。按 `references/requirements.md` 做三查（**只对配置了需求注册表的项目生效**，例如本仓的 `utp/docs/prd/README.md`）：

1. **查状态**：关联文档在 `utp/docs/prd/README.md` §3 的状态；命中 `已取代`/`已作废`/`已归档` → **停止**，不采纳其 DoD。
2. **查 CR**：§6 修订记录是否推翻了这条需求；有则用「新口径」，正文带 `⛔ CR-xxxx` 的句子视为历史。
3. **查实测**：`utp/docs/version/` 最新版本文档的结论与 DoD 冲突 → **以版本文档为准**。

> **降级规则（其他项目/工具必读）**：本项目没有 `utp/docs/prd/README.md`、或该任务没有关联 PRD 时，**跳过三查，不要阻塞、不要报错**，只写回一句：
> `ptodo context decision <id> "无需求资产（<项目名>），按任务描述 DoD 执行"`。缺文档 ≠ 需求已作废。

结果写回：

```bash
ptodo context decision <id> "G0.5 已查：注册表 R<n> / CR-xxxx / 版本 x.y.z；DoD@R<n>"
```

不能裁决的口径分歧（如客户确认函未回执）→ `ptodo task block <id> --reason "等客户确认口径"`，不实现、不改证据帧。
**纯只读问答、以及不改代码/文档的运维动作可跳过 G0.5。**

### G1 认领：改文件前

```bash
ptodo task start <T-xxxx>
```

- `task start` **本身就是认领**（claim），并返回开工简报；成功后在本人名下，状态为 `doing`。任务已指派给你（holder=你）时同样可以 start（幂等返回简报）。
- 简报已包含：阶段/里程碑、目标、最近决策、前序完成（版本/证据/交接）、未完成前序、资料、未关闭事项、前置条件、下一步。
  **不要再 `task get` 重复读。**
- 已在自己名下的任务重复 `start` 是幂等的，直接回简报。
- 返回 `NOT_READY`：按提示先完成上游依赖或前置条件（`pre confirm` / `res approve`）；如果消息只有「尚未就绪」而没有列原因，多半是已被他人持有、任务不在 `open`，或所属阶段/里程碑已归档——先 `task get <id>` 看 holder/状态，换一条，不要抢。
- 返回 `CONFLICT`：通常是与他人并发抢同一任务或文件锁；换一条或稍后重试，不要默认 `--force`。

### G2 进行中：状态变化立即写回

```bash
ptodo context decision  <id> "为什么这样选、放弃了什么"
ptodo context progress  <id> "当前做到哪、下一步"
ptodo context loop      <id> "待确认/待补测事项"      # 关闭：--close 1
ptodo task block        <id> --reason "等外部条件"
ptodo task release      <id> --note "交给下一位的说明"
ptodo task dep add      <id> --blocked-by <上游 ID> [--type soft]
ptodo task create       --title "..." --parent <id> --stage S-0002 --tags a,b [--blocked-by <id>]
```

- `block` 把任务改为 `blocked`，原因追加到 `context.openLoops`；`unblock` 在有人持有时回 `doing`，否则回 `open`。
- `release` 写回「中断于 …」进度、把 note 追加到 `openLoops`，并给出 handoff（下一位 `task start` 就能看到）。
- 每完成一个子步骤就写回；长时间不写回会被视为失联。
- 阶段/里程碑依赖用 `ptodo stage dep add` / `ptodo milestone dep add` 维护；它们只影响组织状态，不影响任务就绪。

### G3 完成：先记录，再宣称

```bash
ptodo task done <id> --evidence "可复核证据（命令/用例/截图路径）"
```

- 只有当前持有者能完成；`--version` 可显式指定版本，否则自动取 git 短 hash；未传 `--evidence` 时自动取 `git log --grep=<id>` 的提交摘要。
- **非 git 项目（或从非 git 目录执行）必须带 `--version <版本>`**，否则报 `[INVALID]` 退出码 5；工作区不是 git 仓是常见情况，不要因此谎报完成。
- `done` 会写 `doneAt/doneBy/doneVersion/doneEvidence`，补默认 `context.progress`，并解锁下游（返回值 `unlocked`）。
- **归档询问（强制）**：`task done` 返回 JSON 的 `milestone.complete=true`（该里程碑下活跃叶子任务全部完成；文本输出也会多一行「里程碑 `M-xxxx` 已全部完成；归档前先询问用户：`ptodo admin archive-batch --milestone M-xxxx`」）时，**必须先问用户**「里程碑 `M-xxxx`（名称）已全部完成，是否归档？」，**得到肯定答复后**才执行 `ptodo admin archive-batch --milestone M-xxxx`；用户拒绝则写回 `ptodo context loop <id> "里程碑 M-xxxx 待归档，用户暂不归档"`。**未确认不得归档**。`milestone=null`（无里程碑）或 `complete=false` 不要提归档，继续做剩余任务。
- **版本文档（批量完成 / push 前）**：一次要完成多个任务、或准备 push/交付时，**先确认版本文档已存在**（没有就按「版本文档」小节模板新建），再让同批任务 `done --version <文档号>` 关联；单条小任务且不 push 可沿用最近一份文档，不新建。`ptodo doctor` 报「版本文档缺失」时先补文档再继续。
- 不能完成：`task block --reason` 或 `task release --note`，并在答复里说明。
- 未执行 `done` 不得说「已完成」。

### G4 收尾：给结论前再读一次

```bash
ptodo task status
```

最终答复必须带一行：

```
待办：T-00xx 已完成（版本 xxxx，证据 ...）
```

或

```
待办：T-00xx 仍进行中（阻塞：...，持有：...）
```

纯只读问答（解释概念、查资料、不产生文件变更）可跳过 G1–G3，但涉及「下一步做什么」时仍先 `ptodo task ready` 或 `task status`。

## 版本文档（批量完成 / push 前）

**触发**（任一）：一次要完成多个任务；准备 push / 交付 / 发版；改动形成了可交付变更。
**不触发**：单条小任务且不 push（可沿用最近一份文档）；纯只读问答；不产生交付物的文档整理。

### 路径与命名

- 本项目：`utp/docs/version/<文档号>.md`（本仓实际的版本目录；doctor 按 `docs/version` → `utp/docs/version` 顺序探测，取第一个存在的）。
- 其他项目：`docs/version/<x.y.z>.md`；推荐显式配置（相对项目根），写进 `docs/ptodo/config.json`：
  ```json
  { "version": { "docDir": "utp/docs/version" } }
  ```
  配了 `docDir` 就按它判断（目录不存在也不自动改）；不配则探测 `docs/version` / `utp/docs/version`，都没有时用 `docs/version`。
- **文件名 = `done --version` 原值 + `.md`**：推荐不带 `v`；若传了 `v1.0.176`，文件名必须是 `v1.0.176.md`（doctor 按原值找）。同一文档号只有一份。
- 只检查形如 `x.y.z` 或 `x.y.z-后缀`（如 `1.0.176`、`2.0.0-ui.3`、`2.0.1-skill.1`）的 `doneVersion`；git 短 hash、`test-1` 这类会被跳过。**批量完成/交付请显式传 `x.y.z`**。

### 固定模板（照抄，按需加章节）

```markdown
# 版本 x.y.z

> **时间**：YYYY-MM-DD
> **关联任务**：T-0049（技能 person 语义）、T-0052（版本文档规则）
> **范围/制品**：仓库/模块/镜像（如 utp：后端 X、前端 Y；dify 零改动）
> **证据**：可复核命令、用例、截图路径

## 一、变更摘要
- 改了什么、为什么改（对应客户/用户要求；影响面）

## 二、验证与证据
- `node --test`：N/N 通过；手工命令；页面截图路径；验收用例编号

## 三、风险与待办
- 已知限制、未覆盖项、后续任务 T-xxxx

## 四、SQL / 制品（可选）
- `V1.0.xxx__xxx.sql`（建表/菜单）、镜像 tag
```

### 合并规则（避免每个小任务建一份）

- **同批任务共用一份**：一次完成多个任务 → 写进同一份文档的「关联任务 / 变更摘要」，每个任务 `done --version <同一文档号>`。
- **时间相近的小改动追加到最近一份**：在最近文档里加一节/一条，不新建；只有形成新的可交付变更才建新文档。
- **一个文档号可被多个任务引用**；`done --version` 必须等于文档号（点号/大小写一致），否则 doctor 找不到。
- 批量完成/归档前检查：`ptodo doctor` 或 `ls utp/docs/version/`，缺的先补。

### 缺失后果（doctor 提醒，不阻断）

`ptodo doctor` 有一条 `version` 检查，缺文档时 warn（人读示例；JSON 在 `checks[]` 里是 `{name:"version", status:"warn", detail:"..."}`）：

```
⚠ version  版本文档缺失：1.0.176（3 个任务）、1.0.177（1 个任务）；建议在 <docDir> 创建 1.0.176.md、1.0.177.md（只提醒，不阻断 done）
```

- 检查范围：**看板活跃 + 归档**里 `status=done` 且 `doneVersion` 非空的任务，按版本聚合（同版本多任务合并计数）；最多列 3 个版本，其余写「等 N 个版本」。
- 只判断 `<docDir>/<doneVersion>.md` **文件是否存在**，不校验模板字段（模板由本技能约定）。
- 全部齐全显示 `✅ version 版本文档齐全（<dir>）`；没有带版本号的任务显示 `✅ version 暂无带 x.y.z 版本号的已完成任务`。
- **done 行为不变**：缺文档不报错、不改退出码，只在 doctor 提示。处理：先按模板补文档，再 push / 交付；不要用「之后补」或「版本号是 hash」绕过。

## 命令速查（只教这些）

| 目的 | 命令 |
|---|---|
| 找就绪任务 | `ptodo task ready [--limit N] [--stage S-0002] [--milestone M-0001]`（只列**未指派**的就绪任务；已指派给你的直接 `task start`） |
| 认领 + 开工简报 | `ptodo task start T-0007` |
| 完成 | `ptodo task done T-0007 --evidence "301/302 通过"` |
| 版本文档（批量完成/push 前） | 建/补 `utp/docs/version/<x.y.z>.md`（模板见「版本文档」），同批任务都 `done --version <x.y.z>` |
| 交还/交接 | `ptodo task release T-0007 --note "等客户确认，下一步跑 X"` |
| 阻塞 | `ptodo task block T-0007 --reason "等接口权限"` |
| 新建（可拆子任务） | `ptodo task create --title "..." [--stage S-0002] [--priority P0..P5] [--urgency 1..5] [--tags a,b] [--parent T-0001] [--blocked-by T-0006]` |
| 写回上下文 | `ptodo context decision/progress/loop <id> "..."` |
| 人员列表（人员多选/指派用） | `ptodo admin people [--json]`（仅列 git 历史作者） |
| 修复无效负责人 | `ptodo admin repair-people --person <git用户名> [--dry-run]`（把非 git 人员的历史 person 字段改为该人） |
| 里程碑/阶段完成后归档 | `ptodo admin archive-batch --milestone M-0001`（也支持 `--stage S-0001` / `--ids T-0001,T-0002`；只归档已完成，父任务/未完成会进 `skipped`；**先问用户**，未确认不执行） |
| 取消归档 | `ptodo admin unarchive T-0007` |
| 只读总览/详情 | `ptodo task status` / `ptodo task list` / `ptodo task get T-0007` |
| 管理组织/依赖/标签 | `ptodo milestone ...` / `ptodo stage ...` / `ptodo task dep ...` / `ptodo tag ...` |
| 时间轴/自检 | `ptodo timeline` / `ptodo whoami` / `ptodo doctor` |

页面/脚本动作（归档、删除、导入导出、批量、清空日志）在 `ptodo admin ...`，**不要主动使用**；需要清理时先问用户。

## 身份与目录

### 人（person）与工具身份（`--by`）

- **人字段存的是 git `user.name`（person）**：`createdBy / holder / doneBy / archivedBy` 都是人，用来回答「谁负责、谁完成」。`history` 的 `by` 才是 actor（工具身份，可带 `<工具>:` 前缀），只用于区分「哪个工具做的」。
- `--by` / `PTODO_ACTOR` 决定 actor；**person 由 CLI 计算**：git `user.name` 优先，否则取 actor 去掉 `<工具>:` 前缀。两者不是一回事。
- 工具身份统一写成 `<工具>:<名字>`（冒号），固定写法：`--by wb:<名字>`、`--by zcode:<名字>`、`--by claude:<名字>`、`--by codex:<名字>`；`--by wb-张三` 没有冒号，`whoami` 会报「缺少 `<agent>:` 前缀」，**不要用连字符代替冒号**。
- **不要把 session id、随机串或 `<工具>:<session-id>` 当人的名字**：那会让 doneBy/holder 变成无法识别的机器串，看板按人筛选也会失效。
- 先让 person 正确：项目里配好 `git config user.name "张三"`，或设 `PTODO_ACTOR=<工具>:<姓名>`（如 `wb:张三`）。两者都没有时 person 可能回落成 actor 里的 session 串。
- 不确认当前 person 先跑 `ptodo whoami`：JSON 有 `person`、`personSource`，文本显示 `person <姓名>（git user.name）` 或 `person <姓名>（无 git user.name，取 actor 去前缀）`。
- **人员列表只来自 git 历史作者**（`git log --format=%an` 去重；当前 person 也必须是 git 作者）。看板里的工具名、session id 不是有效负责人，不再作为人员展示。
- **负责人（holder）只能是 git 作者**：`task create --holder`、`task start`、页面「指派」都会校验，无效名字报 `INVALID`。历史遗留的无效值先预览再修复：`ptodo admin repair-people --person <git用户名> --dry-run`，确认后去掉 `--dry-run`。
- 指派负责人/完成人时用人名（git user.name）从人员列表选，不要手填机器 id；页面默认「与我相关」，支持人员多选/全部。

### 目录与调用

- 从项目根执行；子目录也可以（CLI 向上找 `docs/ptodo/todos.json`，找不到再看 `.git`）。项目根不是 git 时可 `--root <项目根>`。
- `ptodo` 不在 PATH 时**不要停**：按「跨工具执行 → ptodo 不在 PATH 时」三级降级（`node <包>/bin/ptodo.mjs`）；仍不可用再告诉用户安装方式，不要退回 Markdown 队列。

## 跨工具执行（WorkBuddy / ZCode / Claude Code / Codex）

本技能用 `ptodo skill install --targets all` 装到各工具技能目录；Windows 为目录 junction，源码更新即时生效（WorkBuddy 缓存里 `project-todo` 的 `disableModelInvocation:false`，重启应用即重新扫描）。
**外部工具没有 DSH 的 systemPrompt 注入，本文件正文就是唯一协议。** 先做四步自检，再按 G0 开工：

| 步骤 | 命令 | 通过判据 |
|---|---|---|
| 1 技能可见 | `ptodo skill status` | 当前工具那一行是 `linked` 或 `copy`；`missing` → `ptodo skill install --targets <工具>` |
| 2 身份 | `ptodo whoami --by <工具>:<名字>` | `actor` 形如 `wb:xxx`，显示「有工具前缀」，`root` 是本项目 |
| 3 环境 | `ptodo doctor` | 没有 `✗`；`⚠ git 无` 只影响 G3（完成必须带 `--version`） |
| 4 数据 | `ptodo task ready` | 能列出任务；显示「本项目暂无待办」= 该项目还没建看板，先 `task create` |

顺序不要颠倒：先确认技能装的是**当前源码**（`linked` 才保证最新），再确认身份，再看环境，最后读数据。

### ptodo 不在 PATH 时（降级三级，照抄任一）

```bash
ptodo --version                                              # 1) 在 PATH（Windows 同时有 ptodo / ptodo.cmd / ptodo.ps1）
node "$(npm root -g)/@local/dsh-project-todo/bin/ptodo.mjs" --version   # 2) 全局 npm 包
node "<源码仓>/dsh-plugins/dsh-project-todo/bin/ptodo.mjs" --version    # 3) 源码仓（本机示例：E:\dsh-plugins\dsh-project-todo\bin\ptodo.mjs）
```

- PowerShell 用 `& "D:\Program Files\nodejs\node.exe" "E:\dsh-plugins\dsh-project-todo\bin\ptodo.mjs" ...`（node 也不在 PATH 时用 node 绝对路径）。
- cmd 用 `node "E:\dsh-plugins\dsh-project-todo\bin\ptodo.mjs" ...`。
- **后续所有 `ptodo ...` 都替换成当前可用的那种前缀**，参数完全一致（`--by`、`--root`、`--json` 都支持）。
- 路径含空格/中文时逐段加引号；`--root "<项目根>"` 可显式指定项目。

### 输出与退出码（其他工具按此判定）

- 输出是 **UTF-8 中文**；捕获后按 UTF-8 解码，中文乱码不是数据错误。需要机器判定时加 `--json`（键名 ASCII，顶层 `ok`）。
- 退出码：`0` 成功；`3 NOT_FOUND`；`4 CONFLICT`；`5 INVALID`（参数/版本问题）；`7 NO_PROJECT`；`8 DEPENDENCY_CYCLE`；`9 TAG_NOT_FOUND`；`10 NOT_READY`。
- **只按退出码判失败**：非 0 时读 `[CODE]` 那行给的处理建议，不要猜；成功输出不是 JSON 时也是给人看的，不要求工具解析。

### 只读边界

- 纯解释/查资料、不产生文件变更：可只读（`task status` / `task list` / `task get`），跳过 G1–G3。
- 涉及「下一步/继续开发」：先 `task ready` 或 `task status`，再决定。
- 只要会写文件、跑构建、产出交付物：必须 G0→G4 全走；未 `task start` 不算开工，未 `task done` 不得说完成。

### 新项目 / 资产缺失

- 项目里没有 `docs/ptodo/todos.json`：`ptodo task status` 会显示「本项目暂无待办」（自动建空看板，退出码 0），先 `task create --title "..."` 再 `task start`，不要空转。
- G0.5 三查只对配置了需求注册表的项目（本仓 `utp/docs/prd/README.md`）生效；缺 `utp/` 或无关联 PRD 时按 G0.5 降级规则记录一句就继续，**不得阻塞**。

## 失败处理

| 现象 | 处理 |
|---|---|
| `ptodo` 找不到（command not found） | 按「跨工具执行 → ptodo 不在 PATH 时」三级降级；都不可用再在包目录执行 `npm link`（或 `npm i -g .`）后重试，不要退回 Markdown 队列 |
| `NOT_READY` (10) | 看原因：硬依赖未完成 → 先做上游；前置未满足 → `pre confirm` / `res approve` / 等提交；owner 不是你 → 换一条（`task get` 看 holder），不要抢。若 holder=你仍报错，先看依赖/前置/阶段是否归档 |
| `DEPENDENCY_CYCLE` (8) | 依赖成环；删掉反向边（`task dep remove` / `stage dep remove`），不要继续加边 |
| `CONFLICT` (4) | 并发抢任务/文件锁、阶段还有任务、已依赖同一目标；读返回信息，换任务或稍后重试，不默认 `--force` |
| `INVALID` (5) | 参数或版本问题；最常见是非 git 项目 `task done` 未带 `--version` → 补 `--version <版本>` |
| `TAG_NOT_FOUND` (9) | 标签未注册且 `tag.strict=true`；先 `ptodo tag add --name ...`，或改用已注册编码 |
| `NOT_FOUND` (3) | `task list` 重新找 ID；不要新建重复任务 |
| `NO_PROJECT` (7) | `--root <项目根>`，或先 `ptodo init` |
| 中文乱码 | 输出是 UTF-8；捕获端按 UTF-8 解码（PowerShell：`[Console]::OutputEncoding=[Text.Encoding]::UTF8`），需要机器读就加 `--json` |
| 完成报版本缺失 | 显式 `--version <版本>`（非 git 项目必需），或从子仓目录执行，或 `git link` 关联仓库 |
| `archive-batch` 有 `skipped` | 读每条 `reasonCode`：`NOT_DONE` 未完成 → 先完成；`HAS_CHILDREN` 还有子任务 → 先处理子任务；`ARCHIVED` 已归档 → 跳过；`NOT_FOUND` 不存在 → `task list` 核对 ID。**不要为了让归档通过而强改 done** |
| `doneBy`/`holder` 是 `session-xxx` 之类机器串 | person 没取到 git `user.name`：配 `git config user.name` 或 `PTODO_ACTOR=<工具>:<姓名>` 后重做该动作；历史记录用 `context decision` 说明 |
| doctor 报「版本文档缺失」 | 按模板补 `<docDir>/<文档号>.md`（本仓 `utp/docs/version/`），同批任务共用一份；补完再 push/交付 |
| 看板为空 | `task create` 后 `task start`，再开工 |

## 需要时再读

- `references/cli.md`：完整参数、JSON 输出、退出码。
- `references/protocol.md`：三层模型、状态机、依赖/就绪、开工简报、释放交接、上下文折叠。
- `references/tools.md`：**各工具（WorkBuddy/ZCode/Claude/Codex）的跨工具自检、PATH 降级、actor 写法、常见故障处理**。
- `references/governance.md`：数据文件、v2→v3 迁移、历史与快照、为什么不设 audit。
- `references/requirements.md`：**需求真相源、G0.5 三查、过时判据、已禁用文档清单、DoD 版本约定**。
