# 各工具安装、自检与跨工具执行

技能源码：`dsh-plugins/dsh-project-todo/skill/project-todo`（本机：`E:\dsh-plugins\dsh-project-todo\skill\project-todo`）。
安装（在项目根执行）：`ptodo skill install --targets all`；检查：`ptodo skill status` / `ptodo doctor`。

## 安装目标

| 目标 | 安装位置 | 说明 |
|---|---|---|
| `project` | `<项目根>/.agents/skills/project-todo` | 随项目生效，DSH 等工具会自动发现 |
| `agents` | `~/.agents/skills/project-todo` | 跨项目通用目录 |
| `dsh` | `~/.dsh/skills/project-todo` | DSH 全局技能目录 |
| `zcode` | `~/.zcode/skills/project-todo` | ZCode |
| `workbuddy` | `~/.workbuddy/skills/project-todo` | WorkBuddy |
| `claude` | `~/.claude/skills/project-todo` | Claude Code |
| `codex` | `~/.codex/skills/project-todo` | Codex |

- `--targets` 可逗号分隔（如 `project,codex`）或 `all`；默认 7 个全装。
- Windows 优先建目录 junction（更新源码即更新技能），权限不足自动退回复制；`--copy` 强制复制。
- `linked` = 指向源码（最新）；`copy` = 复制（源码改动后需重装）；`drift` = 副本与源码不一致；`missing` = 未安装；`foreign` = 同名但不是本技能。
- 目标已存在且不是本技能：默认 `CONFLICT`（退出码 4），`--force` 才覆盖；`skill remove` 只删本技能安装。
- `--home DIR` 可指定 home（测试/多用户）；`skill.targets` 配置可改默认目标列表。

## 四步自检（任何工具，按顺序照抄）

在**项目根**执行；第 1 步确认装的是最新源码，第 2 步确认身份，第 3 步看环境，第 4 步读数据。

```bash
# 1) 技能是否装到本工具（本工具那行必须是 linked 或 copy）
ptodo skill status

# 2) 身份是否有 <工具>: 前缀（actor 应是 wb:xxx / zcode:xxx 这类），person 应是 git user.name
ptodo whoami --by wb:<名字>

# 3) 环境（不能有 ✗；⚠ git 无 = 完成时必须 --version）
ptodo doctor

# 4) 数据（task ready 是「未指派」就绪队列；显示「本项目暂无待办」= 还没建看板）
ptodo task ready --limit 3
```

通过后直接进入 SKILL.md 的 G0/G1，不要重复读技能。

## ptodo 不在 PATH 时（三级降级）

工具只给 cmd/PowerShell、或 PATH 被裁剪时，按顺序试，任一可用就把它当作 `ptodo`：

```bash
# 1) 在 PATH（Windows 有 ptodo / ptodo.cmd / ptodo.ps1 三个 shim）
ptodo --version

# 2) 全局 npm 包（node 在 PATH 但 ptodo 不在时）
node "$(npm root -g)/@local/dsh-project-todo/bin/ptodo.mjs" --version

# 3) 源码仓（node 用绝对路径；本机示例）
node "E:\dsh-plugins\dsh-project-todo\bin\ptodo.mjs" --version
```

- PowerShell 示例：`& "D:\Program Files\nodejs\node.exe" "E:\dsh-plugins\dsh-project-todo\bin\ptodo.mjs" whoami --by wb:<名字>`
- cmd 示例：`node "E:\dsh-plugins\dsh-project-todo\bin\ptodo.mjs" task ready --limit 3`
- 后续命令只需替换前缀，参数完全一致：`--by`、`--root`、`--json`、`--version` 都支持。
- 路径含空格/中文逐段加引号；找不到项目根用 `--root "<项目根>"`。
- 实测（本机）：`PATH` 只剩 `C:\Windows\System32` 时，用 node 绝对路径 + 源码仓 `bin/ptodo.mjs` 仍能 `whoami` / `task ready` / `task status`，退出码 0。

## Actor：必须带 `<工具>:` 前缀

解析优先级：`--by` > `PTODO_ACTOR` > git `user.name` > `DSH_SESSION_ID` > `cli-<用户名>`。

- **没有 DSH 环境时，actor 会静默回落成 git 名**（本机 `optimisticGeek`），WorkBuddy/ZCode/Claude 同时用会混成同一个人，分不清谁认领。
- 固定写法（每条命令都带，别只依赖 shell 变量）：

| 工具 | 一次性 | 会话级 |
|---|---|---|
| WorkBuddy | `--by wb:<名字>` | `set PTODO_ACTOR=wb:<名字>` |
| ZCode | `--by zcode:<名字>` | `set PTODO_ACTOR=zcode:<名字>` |
| Claude Code | `--by claude:<名字>` | `export PTODO_ACTOR=claude:<名字>` |
| Codex | `--by codex:<名字>` | `export PTODO_ACTOR=codex:<名字>` |
| DSH | 可省略（DSH 注入 `DSH_SESSION_ID`） | 推荐 `--by dsh:<名字>` |

- **必须用冒号**：`--by wb-<名字>` 没有冒号，`whoami` 会报「缺少 `<agent>:` 前缀」；`ptodo doctor` 给 warn。
- 一次性验证：`ptodo whoami --by wb:<名字>` 应显示 `actor wb:<名字> (flag, ...)` 与「有工具前缀」。
- git 名从仓库 `.git/config`（worktree 走 `commondir`）或全局 `~/.gitconfig` 读取，不依赖子进程。

## 人（person）与人员列表

**人字段（`createdBy` / `holder` / `doneBy` / `archivedBy`）存 git `user.name`（person）；`--by` 只进 history 的 `by`（actor=工具身份）。** 别把 session id 当人名。

- `ptodo whoami` 文本多一行 `person   <姓名>（git user.name）`；无 git 用户时是 `person   <姓名>（无 git user.name，取 actor 去前缀）`。
- `ptodo whoami --json` 有 `person` 与 `personSource`（`git|flag|env|session|fallback`）；`actor`、`actorSource`、`gitName`、`hasPrefix` 保留，别把 `actor` 当人。
- **person 取不到 git 名时的后果**：`doneBy/holder` 可能变成 `session-xxx` 之类机器串，页面按人筛选会失效。先 `git config user.name "张三"`，或设 `PTODO_ACTOR=wb:张三`（person 会取 `张三`）。
- 人员列表来源：**只列 git 历史作者**（`git log --format=%an` 去重；当前 person 也必须是 git 作者）。命令：`ptodo admin people [--json]`（JSON：`{ ok, action:'people', person, people:[{name,source,active,done,related}] }`，`source` = `me|git`，按名字排序）。
- **负责人（holder）只能是 git 作者**：`task create --holder`、`task start`、页面「指派」都会校验，无效名字报 `INVALID`。旧数据里的 `session-xxx`、`dsh:xxx`、`wb-agent` 已不再作为人员；历史遗留值用 `ptodo admin repair-people --person <git用户名> --dry-run` 预览，确认后去掉 `--dry-run` 修复。
- 指派负责人/完成人：从人员列表选人名，不要手填机器 id；页面默认「与我相关」，支持人员多选/全部。
- 归档：任务 `done` 后才会进归档；`ptodo admin archive-batch --milestone/--stage/--ids` 批量归档（只处理已完成，父任务/未完成进 `skipped`），`ptodo admin unarchive <id>` 可恢复。**里程碑全部完成时先问用户，未确认不归档。**

## WorkBuddy（重点）

- 安装位置：`C:\Users\<用户>\.workbuddy\skills\project-todo`（Windows 为 junction，指向源码，改源码不需要重装）。
- 实测：junction 可读，`SKILL.md` 哈希与源码一致；WorkBuddy 的 `.skill-list-cache.json` 已收录
  `project-todo`（`filePath` 指向该 junction，`disableModelInvocation:false`）——即 WorkBuddy 已能发现并加载。
- 装/改后**重启 WorkBuddy**（或让其重新扫描技能）再开新会话；不重启可能仍用旧缓存。
- 看到技能但执行失败时，先确认「看到的技能」确实是工作区项目根：
  `ptodo whoami --by wb:<名字>` 的 `root` 必须是当前项目，否则 `--root "<项目根>"`。
- 常见故障：

| 现象 | 处理 |
|---|---|
| WorkBuddy 技能列表没有 `project-todo` | `ptodo skill install --targets workbuddy`；重启应用；再 `ptodo skill status` 看 workbuddy 是否 `linked` |
| 技能有，但模型不调用 | 确认缓存里 `disableModelInvocation:false`、`disable:false`；用「开工先 ptodo task ready」触发；仍不调用就在消息里显式引用技能名 |
| 执行时 `ptodo: command not found` | 用三级降级（node + `bin/ptodo.mjs`）；不要在 WorkBuddy 里 `npm install` 重装 |
| 认领人显示 `optimisticGeek` 而非 `wb:xxx` | 命令漏了 `--by wb:<名字>`，补上；已用错身份认领 → `ptodo task release <id> --note "身份写错，重认领"` 后重来。注意：这只影响 actor，**人（doneBy/holder）由 person 决定**，见下一行 |
| `doneBy`/`holder` 是 `session-xxx` 或空 | person 没取到 git `user.name`：先 `ptodo whoami` 看 `person`；配 `git config user.name "张三"` 或设 `PTODO_ACTOR=wb:张三` 后重做该动作；不要在参数里手填 session id |
| 完成最后一个任务后没问归档 | `done` 返回 `milestone.complete=true` 时必须先问用户；确认后 `ptodo admin archive-batch --milestone M-x`，拒绝则 `ptodo context loop <id> "里程碑 M-x 待归档，用户暂不归档"`。`admin archive-batch` 的 `skipped` 带 `reasonCode`（NOT_FOUND/NOT_DONE/HAS_CHILDREN/ARCHIVED） |
| `task create` 后 `task ready` 找不到新任务 | 正常：create 把 holder 设为当前 person，ready 只列**未指派**任务；直接 `task start <id>` |
| 归档后列表里找不到任务 | 归档不是删除：页面切「已完成/存档」或 `ptodo task list --archived`；恢复用 `ptodo admin unarchive <id>` |
| 找不到 `ptodo admin people` | 版本旧；用 `ptodo whoami` 的 `person` + `ptodo task list` 里的人员字段汇总，或升级到含 person/people 的版本 |
| 中文乱码 | 输出是 UTF-8；捕获端按 UTF-8 解码，或改用 `--json` |
| 完成报 `[INVALID] 未能解析 git 短 hash` | 项目不是 git 仓：`ptodo task done <id> --evidence "..." --version <版本>` |

## ZCode / Claude Code / Codex

| 工具 | 技能目录 | 自检命令 |
|---|---|---|
| ZCode | `~/.zcode/skills/project-todo` | `ptodo skill status` 看 `zcode`；`ptodo whoami --by zcode:<名字>` |
| Claude Code | `~/.claude/skills/project-todo` | `ptodo skill status` 看 `claude`；`ptodo whoami --by claude:<名字>` |
| Codex | `~/.codex/skills/project-todo` | `ptodo skill status` 看 `codex`；`ptodo whoami --by codex:<名字>` |

- Codex 若没有统一技能格式，可把 `skill/project-todo/SKILL.md` 作为项目规则/AGENTS 引用，命令仍用 `--by codex:<名字>`。
- 三个工具都可省略 `--by` 的只有一种情况：会话里已设 `PTODO_ACTOR` 且 `whoami` 显示「有工具前缀」。

## DSH

- 不注册 `ptodo_*` 模型工具；在 DSH 内也用终端 `ptodo`（或页面「待办」，读写同一份数据）。
- DSH 会注入 `DSH_SESSION_ID`，可省略 `--by`；但为了和 WorkBuddy 等区分，推荐 `--by dsh:<名字>`。
- 技能目录刚装好需开新会话或刷新技能列表；页面与 CLI 数据同源。

## 输出、退出码与编码

- 输出 UTF-8 中文；`--json` 给机器读（键名 ASCII，顶层 `ok`）。人读输出不要强行解析。
- 退出码：`0` 成功；`3 NOT_FOUND`；`4 CONFLICT`；`5 INVALID`（参数/版本）；`7 NO_PROJECT`；`8 DEPENDENCY_CYCLE`；`9 TAG_NOT_FOUND`；`10 NOT_READY`。
- 非 0 时读错误行的 `[CODE]` 与处理建议，不要猜、不要重试成环。
- 实测：`ptodo task get T-9999` → `[NOT_FOUND]` 退出码 3；非 git 项目 `task done` 不带 `--version` → `[INVALID]` 退出码 5，带 `--version 0.0.1` → 退出码 0。

## 新项目 / 资产缺失

- 目录里没有 `docs/ptodo/todos.json` 时，`ptodo task status` 显示「本项目暂无待办」（自动建空看板，退出码 0）：先 `ptodo task create --title "..."` 再 `task start`，不要空转。
- 换项目后先确认 `root`；可用 `--root "<项目根>"` 强制指定，避免读到上层项目的待办。
- G0.5 的需求三查只对配了 `utp/docs/prd/README.md` 的项目生效；其他项目缺 `utp/` 或任务无 PRD 时，写回
  `ptodo context decision <id> "无需求资产（<项目>），按任务描述 DoD 执行"` 即可，**不得阻塞**。

## 换机/新项目检查清单

1. `ptodo whoami --by <工具>:<名字>`：root 指向目标项目、actor 有前缀、`person` 是真实姓名（git user.name）；
2. `ptodo doctor`：没有 ✗（`git 无` 只影响 G3，用 `--version`）；
3. `ptodo task ready --limit 3`：能读到就绪任务即打通；空看板先 `task create`；
4. `ptodo skill status`：目标工具 `linked`（`copy` 表示源码更新后需重装）；
5. `ptodo admin people`：能列出人员（仅 git 历史作者），用于指派/筛选。
5. 技能未生效：确认目标目录存在且指向源码（junction），重启应用/开新会话。
