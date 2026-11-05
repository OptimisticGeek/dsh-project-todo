# 数据治理

## 唯一事实源

| 文件 | 版本 | 作用 |
|---|---|---|
| `docs/ptodo/todos.json` | v3 | 活跃看板与任务（唯一事实源） |
| `docs/ptodo/milestones.json` | v1 | 里程碑与阶段（三层组织） |
| `docs/ptodo/tags.json` | v1 | 项目标签注册表 |
| `docs/ptodo/archive.json` | v2 | 已归档任务 |
| `docs/ptodo/todos.history.jsonl` | — | 只追加操作日志（看板/组织/标签共用） |
| `docs/ptodo/config.json` | — | 可选配置（缺省用内置默认值） |
| `.dsh/TODO.md`、`.dsh/ARCHIVE.md` | — | **只写** Markdown 快照，不回读 |

- CLI 与 DSH 待办页面读写同一份数据；所有变更都走 `service.act()` 与同一把文件锁。
- 任务编码由内核单调分配（`T-0001` 起，不复用）；导入件的外部编号只进 `legacyId`。
- 每笔变更：拿锁 → 重读 → 校验 → 变更 → `revision+1` → 原子写（temp + fsync + rename）→ 追加日志 → 重写快照。
- 损坏 JSON / 版本不匹配 → `PARSE_ERROR`（6），拒绝写入并保留原文件。

## 配置（`docs/ptodo/config.json`，可缺省）

| 键 | 默认 | 说明 |
|---|---|---|
| `store.path` | `docs/ptodo/todos.json` | 看板路径 |
| `milestones.path` | `docs/ptodo/milestones.json` | 组织文件路径 |
| `tags.path` | `docs/ptodo/tags.json` | 标签文件路径 |
| `archive.path` | `docs/ptodo/archive.json` | 归档路径 |
| `archive.afterDays` | `3` | 完成后自动归档天数；`0` 关闭 |
| `history.enabled` / `history.path` | `true` / `docs/ptodo/todos.history.jsonl` | 独立日志 |
| `markdown.enabled/path/archivePath/doneLimit` | `true` / `.dsh/TODO.md` / `.dsh/ARCHIVE.md` / `20` | 快照 |
| `version.auto` / `version.require` | `true` / `true` | 自动取 git 短 hash / 取不到时拒绝完成 |
| `version.gitDir` | `''` | 仓库目录（相对项目根；`git link` 写入） |
| `ui.enabled` / `ui.defaultTab` | `true` / `auto` | 页面开关与默认 tab |
| `tag.strict` | `false` | `true` 时未注册标签报 `TAG_NOT_FOUND` |
| `dependency.suggestOnCreate` | `true` | 新建时提示可加依赖（UI） |
| `context.maxDecisions` / `maxOpenLoops` | `50` / `20` | 上下文字段折叠阈值 |
| `actor.requirePrefix` | `false` | 是否要求 actor 带 `<agent>:` 前缀（仅提示，不阻断） |
| `skill.targets` | 7 个目标 | `project/agents/dsh/zcode/workbuddy/claude/codex` |
| `batch.claimLimit` | `3` | 兼容批量认领默认条数 |

配置优先级：默认值 < `config.json` < DSH loader 行配置。配置文件损坏是硬错误，避免 CLI 与页面悄悄使用不同路径。

## v2 → v3 迁移

v2 看板（`version: 2`）读取时在内存中归一化为 v3：补 `stageCode=default`、`context`、`dependsOn`、`preconditions`、`resources`、`causedBy/causes`、actor 字段与 `revision`，`group` 并入 `tags`。

升级方式（任选，推荐显式迁移）：

```bash
ptodo migrate --dry-run   # 只预览：任务数、标签、目标路径、备份位置
ptodo migrate             # 原地升级 v2 → v3，先备份
```

- 备份目录：`docs/ptodo/.backup/v2-<时间戳>/`，含 `todos.json`、`archive.json`、`todos.history.jsonl`。
- 迁移会重建默认里程碑/阶段（`milestones.json`），并把看板里出现的标签登记为 `draft`。
- 即使不跑 `migrate`，v3 的**首次写入**也会自动把原 v2 文件备份到 `docs/ptodo/.backup/v2-<时间戳>/` 后再写。
- `revision`、`nextId`、任务 ID 保持不变；`doctor` 会提示「v2，首次写入将自动备份并升级 v3」。

## 旧 `.dsh` 布局迁移（一次性）

旧 `.dsh/todos.json` / `archive.json` / `todos.history.jsonl`：

```bash
ptodo migrate --dry-run
ptodo migrate
```

- 看板/归档保留任务、ID、revision、nextId；成功后旧 JSON 删除（`--keep-legacy` 保留）。
- 旧 history 按约定丢弃，新 history 从空开始。
- 目标已存在且内容不同：默认 `CONFLICT`，需 `--force`（覆盖前先备份）。
- 新版本不做旧布局回退，所有工具只看 `docs/ptodo/`。

## 历史日志

- 只追加；每行 `{at, revision, action, by, taskIds, transitions, before, after}`；组织/标签条目用 `entity/changes`。
- 与看板/归档解耦：删除任务不回写日志；清空日志不改任务、归档与 `revision`。
- 坏行（如写到一半的尾行）跳过，不影响整个时间轴。
- 查看：`ptodo timeline [--scope project|tag|task] [--type ...] [--q ...]`。
- 清空：`ptodo admin timeline-clear --confirm`（破坏性，先问用户）。

## Markdown 快照

- 每次成功变更后重写 `<root>/.dsh/TODO.md` 与 `.dsh/ARCHIVE.md`；格式与 v1 一致，只写不读。
- 写入失败只返回 `warning`，不回滚业务变更。
- 快照不是事实源；冲突时以 `docs/ptodo/*.json` 为准。

## 旧 Markdown 队列

`开发计划/todo/TODO.md` 已冻结：只保留计划索引与历史快照，不再写任务状态。
`todo.py` 的写命令（claim/take/done/release/sync）默认拒绝；读命令仍可用。
**不要再从中认领任务**，也不要两边同时认领。

## 为什么没有 audit

当前版本不做定时/收尾审计命令；强制落在：

1. 技能描述与 G0–G4 协议；
2. 插件每轮注入的短提示（`index.js` 的 systemPrompt 段与会话上下文）；
3. `AGENT.md` / `MEMORY.md` 的强制条款；
4. 完成时 `--evidence` 与 `ptodo task status` 的人工可见性。

不做工具调用拦截，也不做 audit。需要复盘时用 `ptodo timeline` 查看历史。

## 自检与排障

```bash
ptodo whoami     # root / actor 来源 / 数据路径 / revision
ptodo doctor     # 包、Node、看板、组织、标签、归档、日志、快照、config、git、actor、
                 # 依赖环、context 目标缺失率、过期资料、技能安装
```

发现 `deps` 成环、`context` 目标缺失率高、资料 `superseded`、标签 `draft` 过多时，先修数据/补上下文再继续开发。
