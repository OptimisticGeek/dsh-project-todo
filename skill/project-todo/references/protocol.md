# 协议：三层组织、依赖、就绪、简报与交接

## 1. 三层组织

```
里程碑 Milestone（M-0001 / default「默认」）
  └─ 阶段 Stage（S-0001 / default「未分类」）
       └─ 任务 Task（T-0001，可嵌套子任务，深度 ≤ 5）
```

- 任务通过 `stageCode` 归属阶段；阶段通过 `milestoneCode` 归属里程碑。任务不直接挂里程碑。
- `default` 里程碑（「默认」）与 `default` 阶段（「未分类」）是 **inbox**：文件缺失时读取即合成、`ptodo init` 时写入，**永远不可删除**；默认阶段不能移动、必须保持 `active`。
- 新建任务默认 `stageCode=default`；`task create --stage S-0002` 可指定，阶段不存在 → `NOT_FOUND`。
- 里程碑状态：`active|done|archived`；阶段状态：`pending|active|done|skipped`（默认阶段恒 `active`）。
- `milestone create --stages a,b` 自动建阶段：首个 `active`，其余 `pending`；不给 `--stages` 则建一个「未分类」。
- **组织依赖只影响组织自身**：阶段/里程碑依赖未完成时，其 `effectiveStatus=blocked_by_upstream`，但**不会**让任务 `isReady=false`。任务就绪只看任务硬依赖与前置条件。

## 2. 叶子任务状态机

```
create → open
open --task start--> doing                  （被他人持有/非 open → NOT_READY；强抢用兼容别名 claim --force）
doing | blocked --task release--> open       （写「中断于 …」，可带交接 note）
doing --task done--> done                    （非持有者 → CONFLICT；force 才可完成）
open | doing --task block--> blocked         （--reason 追加到 openLoops）
blocked --unblock--> doing | open            （有 holder 回 doing，否则 open）
done | cancelled --reopen--> open
任意非 done --delete/取消--> cancelled       （页面/admin；软删）
```

- 描述字段（title/priority/urgency/tags/notes/parentId/stageCode）走 `task update`；
  状态只能走 `start/release/done/block/unblock/reopen` 等状态动作。
- `doing` 的叶子任务必须有 holder；父任务 holder 恒为 `null`。
- 状态变化才更新 `statusChangedAt`；描述字段变化只更新 `updatedAt`。

## 3. 依赖与就绪

依赖写在「被依赖方」任务上：`task.dependsOn = [{id, type: hard|soft, note}]`。

| 类型 | 对就绪的影响 |
|---|---|
| `hard` | 未完成即阻塞：任务 `effectiveStatus=blocked`，不可 ready/start |
| `soft` | 只提示，不影响就绪 |

- 依赖目标必须存在（活跃或归档）；不能依赖自己；加边后做全图 DFS，成环 → `DEPENDENCY_CYCLE`（8），**加边回滚、不落盘**。
- 依赖只能加在**叶子任务**上；给父任务 `task dep add` 会报 `INVALID`（父任务由子任务汇总）。
- 归档中的 `done` 任务仍可满足依赖（派生时合并活跃+归档任务表）。
- 「被依赖」= 反向边（`blocking`），只读派生，不落库。

**就绪（isReady）的完整判据**：

1. 是叶子任务（没有子任务）；
2. `status === 'open'`；
3. 没有 holder；
4. 所属阶段、里程碑都未 `archived`；
5. `effectiveStatus === 'open'`，即：所有 `hard` 依赖都 `done`，且所有必填前置条件都满足。

> `effectiveStatus` 优先反映硬依赖/前置：`done/cancelled` 原样返回；否则有 blocker 就是 `blocked`，再否则是原状态。

**前置条件（AND 门）**：

| type | 判定 |
|---|---|
| `task_done` | 指定任务 `status=done` |
| `tag_done` | 该标签下所有非 cancelled 任务都 done，且至少一条 |
| `resource_approved` | 本任务指定资料 `status=approved` |
| `commit_exists` | 指定提交在仓库中存在（git 不可用 → 未满足） |
| `manual_confirm` | 人工 `pre confirm` 后满足 |

`required=false` 恒满足（仅提示）。除 `manual_confirm` 外都在读取时实时计算，不会过期。

**派生字段（只读、永不落库）**：

| 字段 | 含义 |
|---|---|
| `effectiveStatus` | 硬依赖/前置后的有效状态 |
| `isReady` | 是否可被 `task start` |
| `blocking` | 哪些任务依赖我（反向边） |
| `preconditions[].satisfied` | 前置条件实时判定结果 |
| `staleResources` | 已被替换（`superseded`）的资料 |
| `stageName / milestoneCode / milestoneName` | 组织归属 |
| `parentProgress` | 父任务 `done/total` |
| 阶段/里程碑 `effectiveStatus/progress` | `blocked_by_upstream` 与完成度 |
| `counts.ready / counts.blockedEffective` | 就绪数、有效阻塞数 |
| 标签 `usageCount` | 活跃+归档任务引用数 |

## 4. 开工简报（task start）

```bash
ptodo task start T-0007
```

`start` 一次完成「检查就绪 → 认领 → 组装简报」，不需要再 `task get`。简报字段：

| 字段 | 内容 |
|---|---|
| `task` | id/title/priority/urgency/status/effectiveStatus |
| `stage` / `milestone` | 编码与名称 |
| `goal` / `progress` | `context.goal` / `context.progress` |
| `decisions` | 最近 3 条决策 |
| `upstreamDone` | 已完成上游：版本、证据、进度（交接） |
| `upstreamPending` | 未完成上游及状态 |
| `changes` | 资料被替换、上游在本任务创建后有更新等提醒 |
| `resources` | 按 draft/approved/superseded 分组 |
| `openLoops` | 未关闭事项 |
| `preconditions` | 全部前置及满足情况 |
| `blocking` | 被依赖任务 |
| `nextStep` | 下一步建议（未满足前置 → 未关闭事项 → 目标 → 上游证据 → 补 goal） |

- 已在本人名下且 `doing`：**幂等**，只回简报，不重复认领、不报错。
- 不就绪：`NOT_READY`（10），消息列出「依赖 X 未完成 / 前置 pc-xxxx 未满足」；若任务被他人持有、非 `open` 或阶段/里程碑已归档，也返回 `NOT_READY`（可能没有具体原因，先 `task get` 看 holder）。
- `force` 不适用于 `start`；绕过就绪只能先补依赖/前置。

## 5. 释放与交接（task release）

```bash
ptodo task release T-0007 --note "等客户确认，下一步跑 probe_citation"
```

- 状态 `doing|blocked → open`，holder/claimedAt 清空，记录 `releasedBy`。
- `context.progress` 改写为 `中断于 <本地时间>：<原进度>`（原进度为空则只写时间）。
- `--note` 追加一条 `context.openLoops`（也会被后续折叠）。
- 返回 `handoff`：`{id, title, progress, openLoops, note, nextStep}`；下一位 `task start` 会在简报里看到。
- 非持有者释放 → `CONFLICT`；`--force` 仅在用户明确要求时使用。

## 6. 完成与解锁（task done）

- 仅当前持有者可完成；`--evidence` 缺省时用 `git log --grep=<id>` 的前 3 条提交摘要（无 git 则为空）。
- 版本解析顺序：显式 `--version` → `version.gitDir` → 会话 cwd → 项目根；优先直接读 `.git`（不依赖子进程），取不到才尝试 `git`。
- `version.require=true`（默认）且两处都取不到版本 → 拒绝完成（`INVALID`，提示显式传版本）。
- 若 `context.progress` 为空，自动写入 `完成于 <ISO>：<证据>`。
- 完成后计算 `unlocked`：所有以本任务为 `hard` 依赖、且自身其余硬依赖都已完成的 `open` 任务；同时追加一条 `dependency_resolved` 历史。

## 7. 阻塞（task block）

- `open|doing → blocked`；`doing` 必须是本人持有。
- `--reason` 必填，写入 `context.openLoops`，并出现在下一次开工简报与 release handoff 里。
- 解除：`task unblock`；有 holder 回 `doing`，无 holder 回 `open`。

## 8. 上下文折叠

- `context.decisions` 上限 `context.maxDecisions`（默认 50）；`openLoops` 上限 `context.maxOpenLoops`（默认 20）。
- 超限时最旧条目被替换为一条 `{by:"system", folded:true, text:"[已折叠 N 条更早决策/未关闭事项，见时间轴]"}`，只保留 1 条摘要 + 最新 `max-1` 条。
- 被折叠的原文仍保留在 `todos.history.jsonl` 对应 `before/after` 快照里，可用 `timeline --scope task` 追溯。

## 9. 父子、排序与并发

- 父任务 = 容器：有任意子任务即不可 claim/release/done/block；不能挂到自己的后代下；深度 ≤ 5；禁止环。
- 父任务状态由子任务自底向上派生：全 cancelled → cancelled；非 cancelled 全 done → done（`doneAt` 取最晚）；任一 doing → doing；其余 open。进度按非 cancelled 子任务计算，只在读取时派生。
- Agent 排序：`priority`（P0 最先）→ `urgency`（5 最急）→ `createdAt`（最早）→ id。
- 并发：同一项目共用 `.lock`（`todos.json.lock`），进程内队列 + 跨进程锁；锁等待 2 秒，超过 10 秒的锁视为陈旧可清理；冲突返回 `CONFLICT`。同一任务只允许一个 holder。

## 10. 需求门在协议中的位置

G0.5 在 `task start` 之后、第一次改文件之前执行；结果用 `context decision` 写回。
口径不能裁决时用 `task block --reason "等客户确认口径"`，不要带着未决口径实现或写证据。
