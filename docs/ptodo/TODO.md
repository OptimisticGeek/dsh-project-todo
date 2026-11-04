# 待办

> 本文件由 dsh-project-todo / ptodo 自动生成（revision 130，2026-11-04 19:27），请勿手工编辑。
> 数据源：`docs/ptodo/todos.json`；已完成任务归档后进入 `docs/ptodo/ARCHIVE.md`。
> **工作入口**：agent 请加载技能 `project-todo`（或直接执行 `ptodo task ready`）后按 G0–G4 推进；
> 本文件与 `todos.json` 都是只读快照/存储，**不要直接编辑，也不要以读 JSON 代替认领**。

进行中 0 · 未开始 0 · 阻塞 0 · 已完成 19 · 已取消 0

| ID | 优先级 | 紧急度 | 状态 | 任务 | 标签 | 持有 | 认领 | 状态更新 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| T-0041 | P0 | 紧急 | 已完成 | 项目待办 CLI 化：ptodo 全局命令 + 跨工具 Skills + 数据迁入 docs/ptodo | TODO-SYSTEM、INFRA | optimisticGeek | 11-04 11:01 | 11-04 11:11 | 移除 DSH 20 个 ptodo_* 工具，插件包暴露 bin ptodo；数据迁 docs/ptodo/*.json；技能统一提示词；无 audit；版本 1.0.0；支持“继续开发”零启动批量认领。 |
| T-0057 | P0 | 普通 | 已完成 | 待办负责人治理：仅允许 git 人员，修复无效 person，先指派给 optimisticGeek | TODO-SYSTEM | optimisticGeek | 11-04 17:16 | 11-04 17:21 |  |
| T-0058 | P0 | 普通 | 已完成 | 插件开发待办迁移：把 TODO-SYSTEM 任务移到 E:\dsh-plugins\dsh-project-todo 独立看板 | TODO-SYSTEM | optimisticGeek | 11-04 17:24 | 11-04 17:25 |  |
| T-0043 | P1 | 普通 | 已完成 | ptodo v2 升级：三层组织/依赖/开工简报/UI | TODO-SYSTEM | optimisticGeek | 11-04 14:59 | 11-04 15:20 | 按用户批准的 ptodo 完整开发计划执行：schema v3、actor、里程碑/阶段、标签库、依赖、ready/start/done/release/block/create、前置/因果/资料、UI 分组。 |
| T-0045 | P1 | 普通 | 已完成 | ptodo Web UI：任务列表平铺/分组切换与层级可读性优化 | TODO-SYSTEM | optimisticGeek | 11-04 16:01 | 11-04 16:06 |  |
| T-0047 | P1 | 普通 | 已完成 | 身份语义：完成人/负责人用 git 用户名（person），新增人员列表与批量归档 API | TODO-SYSTEM | optimisticGeek | 11-04 16:09 | 11-04 16:17 |  |
| T-0048 | P1 | 普通 | 已完成 | UI：人员多选过滤（默认与我相关）、指派人员选择、已完成归档/批量归档 | TODO-SYSTEM | optimisticGeek | 11-04 16:09 | 11-04 16:18 |  |
| T-0050 | P1 | 普通 | 已完成 | 详情弹窗变更流转图 + 分组进度/计数跟随人员过滤 | TODO-SYSTEM | optimisticGeek | 11-04 16:24 | 11-04 16:26 |  |
| T-0053 | P1 | 普通 | 已完成 | 详情弹窗去重与流转图样式修正 | TODO-SYSTEM | optimisticGeek | 11-04 16:28 | 11-04 16:29 |  |
| T-0054 | P1 | 普通 | 已完成 | ptodo 插件文档：Agent 生命周期流程图 + README/帮助文档重写 | TODO-SYSTEM | optimisticGeek | 11-04 16:33 | 11-04 16:45 | 用泳道图/时序图讲清 agent 工具使用 ptodo 的完整生命周期；重写 README.md 并新增帮助文档（安装、命令、FAQ、排障）。 |
| T-0056 | P1 | 普通 | 已完成 | dsh-plugins 迁出到 E:\dsh-plugins：移动目录并修复 profile link / 技能 junction / npm link / 文档路径 | TODO-SYSTEM | optimisticGeek | 11-04 17:01 | 11-04 17:07 |  |
| T-0100 | P1 | 普通 | 已完成 | 技能激活改造：SKILL.md 从 CLI 手册改为标准技能定义 | skill、docs | optimisticGeek | 11-04 18:07 | 11-04 18:07 |  |
| T-0101 | P1 | 普通 | 已完成 | 默认里程碑免归档：代码+提示词+文档一致化 | — | optimisticGeek | 11-04 19:27 | 11-04 19:27 |  |
| T-0044 | P2 | 普通 | 已完成 | ptodo Web UI：紧凑表格/只读详情/指派负责人 | TODO-SYSTEM | optimisticGeek | 11-04 15:39 | 11-04 15:56 | 方向已确认：美观紧凑表格；只读详情（context/依赖/前置/资料/因果只展示）；仅允许状态变更、指派负责人、编辑任务描述；移除删除/导入/清空日志/批量等写入口；计数/排序/筛选跟随筛选条件。 |
| T-0046 | P2 | 普通 | 已完成 | 技能跨工具可移植性：WorkBuddy 等工具能正确使用 ptodo | TODO-SYSTEM | optimisticGeek | 11-04 16:05 | 11-04 16:05 |  |
| T-0049 | P2 | 普通 | 已完成 | 技能与提示词：完成人是 git 用户名、里程碑全部完成后询问是否归档 | TODO-SYSTEM | optimisticGeek | 11-04 16:09 | 11-04 16:15 |  |
| T-0051 | P2 | 普通 | 已完成 | doctor：版本文档缺失提醒（version.docDir） | TODO-SYSTEM | optimisticGeek | 11-04 16:23 | 11-04 16:25 |  |
| T-0052 | P2 | 普通 | 已完成 | 技能：完成/发版前创建版本文档并关联任务 | TODO-SYSTEM | optimisticGeek | 11-04 16:23 | 11-04 16:26 |  |
| T-0055 | P2 | 普通 | 已完成 | dsh-project-todo 开源仓库：关联 GitHub 并推送 main | TODO-SYSTEM | optimisticGeek | 11-04 16:55 | 11-04 16:55 |  |
