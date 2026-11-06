# ptodo 实际使用反馈（2026-11-06，Agent 视角）

> 使用场景：单项目（fuyao-ai）单体仓库，87 条任务、10 个容器父任务，一次会话内完成"批量建任务 + 调整结构 + 补决策记录 + 刷新看板"。
> 本文只记**这一天真实踩到**的问题，每条附代码位置与复现方式。未验证的猜测不写。

## 处理状态

| 编号 | 问题 | 状态 |
|---|---|---|
| A1 | `create` 默认占 holder | **已修**（79fffa3）：默认 `holder=null`，新增 `--claim` |
| A2 | `NOT_READY` 报错方向反 | **已修**（79fffa3）：改用 `blockersOf`，`decorateTask` 增 `blockers` |
| A3 | `release` 拒绝 open | **已修**（79fffa3）：open 可释放，done/cancelled 仍拒绝，未占位为 no-op |
| C4 | 描述长度无护栏 | **已加提示**（`lib/cli/note-guard.mjs`）：create 时 >300 字提示，只警告不阻断 |
| B1~B5、C1~C3、C5~C6、D1~D4、E | 其余 | **待定**，见下文建议 |

已验证：156 条测试全绿（原 150 + 新增 6 条回归），且用全局 `ptodo` 在临时项目实测——新建任务 `holder=null` 直接进 ready；依赖链 A←B←C 启动 B 报「依赖 T-0001 未完成」（修复前会报 T-0003）；`--claim` 后可 `release` 回 open；440 字描述触发提示但任务照建。

## 使用量（说明为什么下面几条重要）

| 操作 | 次数 |
|---|---|
| `task create` | 23 |
| `task start` + `task release`（清 holder） | 46 |
| `context decision` | 25 |
| `task update --notes` | 17 |
| `dep add/remove` | 9 |
| 合计 CLI 调用 | **120+** |

23 条新建任务**全部**命中问题 A1；3 条因问题 A3 需要 4 步才能清干净。

---

## A. 必修：三个会直接造成错误认知的缺陷

### A1 · `create` 默认把创建人写成 holder（CLI 与 service 的设计相反）

**现象**：不带 `--holder` 建任务，任务立刻带上 `holder = 创建人`，从此永不进入 `ready`。

**证据**：
```js
// lib/cli/task.mjs:55
holder: holder && holder !== true ? String(holder) : ctx.person,

// lib/cli/commands.mjs:204（同一逻辑的第二处）
holder: holder && holder !== true ? String(holder) : ctx.person,
```

而 service 层的注释与实现是**反的**：
```js
// lib/service.js:563-567
// Assigned only when the caller explicitly asks for it; the person
// is the default creator, not the default assignee.
holder: payload.holder,
```

`isReady` 的判据（`lib/derive.js:97`）：`if (task.holder) return false`。

**影响**：新建任务 100% 隐身。今天 23 条全部中招，必须逐条 `start` → `release` 才清出来。更麻烦的是有硬依赖的任务无法 `start`（见 A3），要靠临时摘依赖绕过。

**建议**：两处改为 `: null`，与 service 注释对齐。需要认领时显式 `--holder X`，或另加 `--claim`。

**附带**：`--holder " "` 目前能绕过（`String(' ').trim() || null` → null），说明这条路已经有人踩过。建议直接支持 `--holder none` 并写进 help。

### A2 · `NOT_READY` 报错把"下游"当成"上游"，指向完全相反的方向

**现象**：`T-0091` 依赖 `T-0090`，但启动时报「依赖 **T-0092** 未完成」。而 T-0092 又依赖 T-0091，看起来像循环依赖。

**证据**：
```js
// lib/service.js:744
...(beforeTask.blocking || []).map((entry) => `依赖 ${entry.id} 未完成`),
```
`blocking` 来自 `derive.js:156` → `blockingOf(id, tasks)`（`derive.js:104`），语义是「谁的 dependsOn 里有我」= **我阻塞的下游**。
真正的判定函数是 `blockersOf(task, ctx)`（`derive.js:70`，遍历自身 `dependsOn` 判 `depDone`），`effectiveStatus`（`derive.js:85`）用的就是它。

**影响**：判定本身正确（T-0091 确实不该启动），但**原因说反了**。我当天一度以为存在循环依赖，花时间核对依赖链。任何有依赖链的项目都会重复踩。

**建议**：
```js
// derive.js decorateTask 增加
blockers: blockersOf(task, ctx),
// service.js:744 改读
...(beforeTask.blockers || []).map((entry) => `依赖 ${entry.id} 未完成`),
```
顺便让 `task get` 也输出 `blockers`，与现有 `blocking` 并列，语义注释写清"blocking=我挡住的、blockers=挡住我的"。

### A3 · `release` 拒绝清理 open 状态的占位，与 A1 形成死路

**现象**：任务是 open 且带 holder 时，`release` 报「不在进行中」；想先 `start` 又被 `NOT_READY` 挡住。**没有任何命令能清掉 holder**（`task update` 不接受 `--holder`）。

**证据**：`lib/model.js:698`
```js
if (task.status !== 'doing' && task.status !== 'blocked') fail('CONFLICT', `${task.id} 不在进行中`)
```

**影响**：今天 T-0091 / T-0092 / T-0098 三条走完了：
```
dep remove → start → release → dep add
```
四个命令清一条，且中途任一步失败就留下半清理状态。

**建议**：允许 open → open 的 release，语义定义为「放弃占用」（不改业务状态）；或加管理命令 `ptodo task unassign <id>`，只清 holder、只写管理类时间轴。

---

## B. 强烈建议：反直觉或会造成静默偏差

### B1 · `context progress` 是覆盖式，`decision` 是追加式，行为不一致

想"在已有进度后补一段"时，progress 会整体替换，必须先 `task get` 取回全文再拼，容易丢内容。`decision` 的 append 行为很好用（今天加了 25 条，全部无损）。

**建议**：progress 支持 `--append`；或在 help 里一句话讲清「progress=当前快照（覆盖），decision=决策流水（追加）」。

### B2 · 给已完成父任务加子任务时，父任务被静默回退为 open

今天给已 done 的 `T-0021` 加子任务 `T-0085`，父任务自动变 open。项目里的旧笔记记了这是"预期行为"，但**操作当场没有任何提示**，看板上"已完成"会突然少一项。

**建议**：若确为设计，`create --parent` 的输出里加一句 `⚠ 父任务 T-0021 已由 done 回退为 open（子任务未闭环）`。作者已经用 `result.warning` 做过类似通道（`task.mjs:61`），复用即可。

### B3 · 父任务只能靠子任务汇总，但没有"自动收口"

`release` / `done` 走 `assertLeaf`，报错文案很好（「父任务由子任务汇总，不能直接改状态」）。但子任务全部 done 后，父任务仍停在 open，需要人工 `done`（项目里 T-0023/T-0026 就是人工收的）。

**建议**：子任务全 done 时自动把父任务置 done，或提供 `ptodo task sync-parents` 批量收口并在 dry-run 里列出将变更项。

### B4 · `dep add A B` 看不出谁是主语

`dep add T-0091 T-0090` 表示"前者依赖后者"，但命令本身没有方向提示。我用 `dep list` 反复确认了两次方向。

**建议**：支持命名参数 `--task T-0091 --depends-on T-0090`；成功输出改为「已登记：T-0091 依赖 T-0090」。

### B5 · `task done` 必须先 `start`，补登记历史完成项要多一步

`lib/model.js:723`：`if (task.status !== 'doing') fail('CONFLICT', '不在进行中，不能完成')`。防作弊合理，但补登历史项（我今天核对时需要给已完成任务补证据）就得 start→done，会污染时间轴。

**建议**：提供 `done --backfill`（跳过 doing 校验、时间轴标为 backfill），或在错误信息里直接给两条可选命令。

---

## C. 缺失能力

### C1 · 没有 JSON 导入导出（Agent 最需要的格式）

`lib/transfer.js:361` 只认 xlsx / md。今天要建 23 条、改 17 条描述、加 25 条决策，只能 shell 循环调 CLI，120+ 次进程启动，每次都读写整个 `todos.json`。

而且 `admin import-file` 这个能力**我一开始根本没发现**（见 D2），先手写了 shell 脚本，后来读源码才看到。

**建议**：`admin export --format json` / `admin import-file --format json`，按 id 幂等合并，复用已有 `--dry-run`。批量场景下这一条能省掉大部分脚本。

### C2 · 批量执行没有原子性，失败静默

今天 shell 循环清 holder 时，3 条因 `NOT_READY` 失败，我加了 `>/dev/null 2>&1`，**事后读 JSON 才发现**。

**建议**：批量入口（import-file 或 `--batch`）返回逐条结果清单（成功/跳过/失败+原因），有失败时非零退出。

### C3 · 没有"下一次该做哪一条"的直接答案

`ptodo status` 只给计数 + 2 条建议；`task ready` 给列表但不解释排序理由。Agent 每次都要自己按 priority + urgency + 依赖重新排一遍。

**建议**：`ptodo next` 返回 1 条 + 理由，例如「T-0083：P0、urgency 3、无未满足依赖、与 T-0090 不冲突，建议先做」。

### C4 · 没有描述长度护栏

今天作者明确要求"单条描述别太长，多职责就拆"，但我前 9 条任务写了 300~615 字，**工具没有任何提示**。

`create` 已有 warning 通道（`task.mjs:61` 会打印 `result.warning`），加规则成本很低。

**建议**：
- `notes` 超过 300 字 → warning「描述偏长，建议精简或拆子任务」
- 标题含「与/和/及/、」且 notes 里出现 ≥2 个「验收」→ warning「疑似多职责，建议拆 `--parent`」
- 可选 `--strict-notes 200` 严格模式（超限直接失败）

### C5 · `task get` 长文本不截断

一条 700 字的 notes 在终端占满一屏，真正要看的状态、依赖、决策反而被挤走。

**建议**：notes 默认截断（如 300 字 + "…（--full 查看全文）"）。

### C6 · 管理型操作淹没时间轴

清 holder 产生 46 条 `start`/`release`，真实业务变更被埋。

**建议**：管理修正单独归类（如 `holder_fix` 事件），`timeline` 默认过滤管理类，`--type admin` 才显示。

---

## D. 能力可发现性（这条影响所有上述问题的严重度）

### D1 · `--help` 对所有子命令输出同一份全局帮助

实测 `ptodo task update --help` 与 `ptodo --help` **逐字相同**。我为了知道 `task update` 支持哪些字段，最后是去读 `lib/cli/task.mjs:188` 的报错字符串反推出来的。

**建议**：`<命令> <子命令> --help` 输出该子命令的参数表与一个示例；或加 `ptodo schema --json`（全部 action + 参数 + 返回结构），Agent 可直接自发现。

### D2 · 能力藏在 `admin` 下，Agent 不会去找

`admin import-file` / `admin export` / `admin timeline-clear` 都存在，但 `ptodo --help` 里 `admin` 只有两个词。今天先写了 shell 循环，之后才读到源码发现。

**建议**：`--help` 把 admin 子命令列全；或把 `import` / `export` 提升为顶层命令（更符合直觉）。

### D3 · `--json` 的字段结构没有约定

`task get --json` 里 `dependsOn` 是对象数组 `{id,type,note}`，不是 id 数组。我写脚本时 `', '.join(dependsOn)` 直接 TypeError，试错成本落在调用方。

**建议**：`ptodo schema --json` 给出各 action 的返回结构；或统一为 `dependsOn: ["T-0090"]` + `dependsOnDetail: [...]`。

### D4 · `--root` 位置敏感，位置不对会被静默换成别的子命令

实测 `ptodo task create --title x --parent T-0075 --root /tmp/test` 直接输出了 `list` 的结果——即 `--root` 放末尾时子命令解析被改写。这类"静默执行了另一件事"比报错危险得多。

**建议**：全局 flag 在任意位置都先剥离再解析子命令；无法识别时报明确错误。

---

## E. 小问题

- **`tag list` 被 deprecated 淹没**：输出 40 行里 30 行是 deprecated。建议默认只列 active，`--all` 展开。
- **容器无法用命令标记**：`create --parent` 建出的父任务只能靠 notes 手写「【容器】」表达语义。建议加 `role: container` 字段或 `--container` 参数，让导出和 UI 能区分。

---

## 如果只改三处

1. **A1**（holder 默认值）—— 一行改动，消灭最高频的"任务隐身"。
2. **A2**（blockers/blocking 混用）—— 一行改动，消灭最误导的报错。
3. **C1 + D1**（JSON 导入导出 + `schema --json`）—— 让 Agent 从"120 次 CLI 调用 + 读源码猜参数"变成"一次导入 + 自发现"。

前两条是纯 bug，第三条是把 ptodo 从"人类 CLI"变成"Agent 一等公民"的关键。
