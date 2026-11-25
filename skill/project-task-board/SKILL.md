---
name: project-task-board
description: "项目级任务台账：跨会话记录开工、进度、决策、阻塞、交接与完成证据。当用户问任务、下一步做什么、谁在做、还剩多少，或准备改代码/跑构建/出交付物前，先读任务再开工；默认只读摘要，需要时再按关系或完整详情展开。不适用：纯只读问答、概念解释、与仓库无关的临时命令、当前回合的多步计划（用 todo_write）、多 agent 分工（用 team_task）。"
description_zh: "项目任务台账：认领、写回、完成取证与交接。默认摘要，按需展开上下文或完整详情。"
description_en: "Project task ledger: claim, progress, evidence and handoff. Summary first; expand relations or full details only when needed."
version: 4.0.0
license: Apache-2.0
allowed-tools: Bash, PowerShell, Read, Glob, Grep, Edit, Write
display_name: "任务"
display_name_en: "Project Tasks"
---

# 任务（ptask v4）

> **一句话**：一个项目一份任务台账。数据在 `docs/ptask/`，命令是 `ptask`，页面读写同一份数据。  
> 默认查摘要；要看依赖/子任务用 `--context`；只有交接或验收才用 `--full`。

## 三套任务系统，别混用

| 系统 | 作用域 | 何时用 |
|---|---|---|
| `todo_write` | 当前会话、当前回合 | 多步执行计划、临时拆解；**允许使用** |
| `team_task_*` | 多 agent 协作 | 分工、认领、依赖 |
| **本技能 / `ptask`** | 跨会话、项目级 | 开工、写回、完成取证、交接、归档 |

本技能不禁止 `todo_write`；只禁止另建 Markdown/JSON 任务台账。

## 何时使用 / 不使用

**使用**：问「有什么任务」「下一步」「谁在做 X」「还剩多少」；说「继续开发」「做这个」；准备改文件、跑构建、补测试、写文档前；要完成、交接、归档时。

**不使用**：纯只读问答、解释概念、一次性环境命令、用户明确说「这次不用登记」；这些直接回答，最多跑一条 `ptask status`。

## 查询分级（先小后大）

| 级别 | 命令 | 内容 | 何时 |
|---|---|---|---|
| 摘要 | `ptask status` | 计数 + 前 2 条待开工 | 开场、随时看总量 |
| 列表 | `ptask list` / `ptask ready` | ID、状态、优先级、标题、阶段、持有 | 找活、筛选；默认 20 / 3 条 |
| 单任务摘要 | `ptask show <id>` | 目标、进度、2 条决策、未关闭计数、阻塞、下一步 | 问「T-123 是什么/做到哪」 |
| 上下文关系 | `ptask show <id> --context` | 父/子、上下游、阶段、前置、资料、因果 | 问「为什么卡/依赖谁/有哪些子任务」 |
| 完整详情 | `ptask show <id> --full` | 全备注、全决策、全循环、资料、证据、近 10 历史 | 交接、验收、用户明确要完整背景 |

铁律：**默认不要 `--full`，不要读 `tasks.json`，不要读 `history.jsonl`**。一次只取当前问题需要的层级；`--json` 也遵守所选视图。

## 调用约定（30 秒版）

```text
读摘要/列表 → 认领拿简报 → 需求三查（有注册表才做）→ 干活并写回 → done 带证据 → status + 结论行
```

五条命令覆盖 90% 的回合：

```bash
ptask ready --limit 3
ptask start <T-xxxx>
ptask note progress <T-xxxx> "做到哪、下一步"
ptask done <T-xxxx> --evidence "可复核证据"
ptask status
```

其余参数先 `ptask <命令> --help`，不要凭记忆拼。

## 铁律

1. 只用 `ptask`；不手改 `docs/ptask/*.json`；不维护第二份任务台账。
2. 没 `start` 不算开工；没 `done` 不得说「已完成」。
3. 证据必须可复核（命令、用例、截图路径），不接受「已修复」自述。
4. 非默认里程碑全部完成（`archivable=true`）时**先问用户**是否归档；`default` 不归档。
5. 不抢他人持有的任务；`NOT_READY`/`CONFLICT` 先看原因，不默认 `--force`。

## 执行门

### G0 开工

```bash
ptask ready --limit 3
```

只返回未指派、依赖/前置满足的就绪叶子。用户点名任务直接 `ptask start`；说「继续开发」且无上下文，从第一条 ready 开始，不要反问。

### G0.5 需求校验

仅当项目配置了需求注册表（如 `utp/docs/prd/README.md`）时做三查：状态、CR、最新版本文档。没有注册表就跳过，写一句 `ptask note decision <id> "无需求资产，按任务 DoD 执行"`，不要阻塞。

### G1 认领

```bash
ptask start <id>
```

`start` 即认领并返回开工简报（默认 ≤1.2KB）。简报已含阶段、目标、最近决策、前序、未关闭、前置和下一步；**不要再 `ptask show` 重复读**。

### G2 进行中

```bash
ptask note decision <id> "为什么这样选，放弃了什么"
ptask note progress <id> "做到哪、下一步"
ptask note loop <id> "待确认/待补测"       # 关闭：--close N
ptask block <id> --reason "等外部条件"
ptask release <id> --note "交给下一位"
```

### G3 完成

```bash
ptask done <id> --evidence "可复核证据"
```

只有持有者能完成；未 `start` 先 `start`。非 git 项目必须带 `--version`。`done` 返回 `milestone.complete/archivable`；非默认里程碑全完成时先问用户是否 `ptask admin archive-batch --milestone <M-x>`。

### G4 收尾

```bash
ptask status
```

最终答复带一行：`任务：T-xxxx 已完成（版本 x，证据 …）` 或 `任务：T-xxxx 仍进行中（阻塞：…）`。

## 失败处理

| 现象 | 处理 |
|---|---|
| `NOT_READY`(10) | 看依赖/前置/持有者，换一条或先做上游 |
| `CONFLICT`(4) | 多半是没 `start` 就 `done`；先 `start` |
| `INVALID`(5) | 参数/版本问题；非 git 项目补 `--version` |
| `NOT_FOUND`(3) | `ptask list` 重新找 ID，不要新建重复任务 |
| `NO_PROJECT`(7) | 先 `ptask init`，或 `--root` 指到有 `docs/ptask/tasks.json` 的目录 |
| 中文乱码 | 输出是 UTF-8；PowerShell 先 `chcp 65001` |

## 跨工具执行（可选）

外部工具没有 DSH 的自动摘要，本文件正文就是协议。先 `ptask skill status`，再 `ptask whoami`、`ptask doctor`、`ptask ready`。`ptask` 不在 PATH 时用 `node <包>/bin/ptask.mjs`；细节见 `references/tools.md`。

## 身份与目录

- 人字段（`createdBy/holder/doneBy`）用 git `user.name`；`--by` 只记工具身份（`wb:张三`）。
- 数据：`docs/ptask/tasks.json`；归档：`archive.json`；历史：`history.jsonl`。
- 从项目根执行；子目录会向上找 `docs/ptask/tasks.json`。

## 需要时再读

- `references/cli.md`：完整参数、JSON、退出码。
- `references/protocol.md`：三层模型、状态机、就绪、交接。
- `references/governance.md`：数据文件、schema、迁移。
- `references/requirements.md`：需求注册表三查。
- `references/tools.md`：外部工具自检、PATH 降级、actor。
