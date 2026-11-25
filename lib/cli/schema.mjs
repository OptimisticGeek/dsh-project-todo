/**
 * Command registry — the single source of truth for `--help` and `ptask schema`.
 *
 * Why a registry instead of hand-written help strings: help text used to be one
 * global blob printed for every command, so `ptask task update --help` and
 * `ptask --help` were byte-identical and callers had to read the parser source
 * (or trigger an error) to learn which flags an action accepts. Adding an action
 * here makes it self-documenting for humans and machine-discoverable for agents.
 *
 * Keep `actions[].flags` in sync with the CLI parser: it is documentation, not
 * validation.
 */

/** Flags accepted by every command. */
export const GLOBAL_FLAGS = [
  { name: '--root', value: 'DIR', desc: '项目根目录（默认从当前目录向上找 docs/ptask）' },
  { name: '--by', value: 'ACTOR', desc: '记录到时间轴的工具身份，如 wb:zhangsan' },
  { name: '--json', boolean: true, desc: '输出单个 JSON 文档，诊断信息走 stderr' },
  { name: '--config', value: 'FILE', desc: '读取指定配置文件（相对项目根）' },
  { name: '--help', boolean: true, desc: '查看该命令/子命令的用法' },
]

/** Reusable flag descriptions, keyed by flag name without dashes. */
export const FLAG_DOCS = {
  id: '任务 ID（也可作为位置参数）',
  title: '任务标题',
  parent: '父任务 ID；父任务因此成为容器，由子任务汇总状态',
  priority: '优先级 P0~P3（P0 最高）',
  urgency: '紧急度 1~5（5 最紧急）',
  tags: '标签，逗号分隔或重复传参',
  notes: '任务描述：只写「做什么 + 验收标准」，超过 300 字会提示',
  stage: '阶段编码（S-0001）或名称',
  milestone: '里程碑编码',
  holder: '创建时直接指派负责人',
  claim: '创建时认领给自己（等价 --holder 自己）',
  'blocked-by': '依赖的任务 ID，可重复；表示「本任务依赖该任务」',
  'dep-type': '依赖类型 hard|soft（默认 hard，hard 未完成不能开工）',
  type: '依赖类型 hard|soft',
  'no-history': '不输出时间轴',
  full: '不截断长文本',
  status: '按状态过滤：open|doing|done|blocked|cancelled|all',
  blocked: '只列有效状态为 blocked 的任务',
  ready: '只列就绪任务',
  flat: '不按里程碑/阶段分组',
  archived: '查询归档而不是当前看板',
  limit: '最多返回条数',
  tag: '按标签过滤',
  reason: '阻塞原因',
  note: '备注（释放说明 / 依赖说明）',
  evidence: '完成证据：命令输出、测试结果、验证结论',
  version: '证据对应的上线版本号',
  force: '跳过校验（谨慎使用）',
  name: '名称',
  code: '编码',
  description: '说明',
  aliases: '别名，逗号分隔',
  stages: '阶段名称列表，逗号分隔；按顺序创建',
  order: '排序值',
  text: '文本内容（也可作为位置参数）',
  close: '关闭第 N 条未关闭事项（从 1 开始）',
  append: '追加到现有内容之后，而不是覆盖',
  backfill: '补登记历史完成项：跳过 doing 校验，必须显式给 --version',
  container: '把任务显式标记为容器（未挂子任务时也不能开工）',
  role: 'container|task，设置任务角色',
  all: '包含管理类事件 / 已废弃条目',
  file: '文件路径',
  format: '导出格式：md|xlsx|json|html',
  scope: '导出范围：active|archive|all（默认 active）',
  source: '导入来源标识',
  'dry-run': '只预览，不写盘',
  'create-only': '不做 id 匹配，全部按新建导入（跨项目复制时用，原 id 存进 legacyId）',
  template: 'HTML 导出模板：内置名 report，或自定义 .html 文件路径',
  title: 'HTML 导出报告标题',
  cascade: '级联处理子任务',
  purge: '同时物理删除',
  ids: '任务 ID 列表，逗号分隔',
  confirm: '确认执行危险操作',
  'include-open': '批量归档时包含未完成任务',
  person: '人员名称',
  close_loop: '关闭指定序号的未关闭事项',
}

function doc(name) {
  return FLAG_DOCS[name] || ''
}

function action(name, summary, usage, flags = [], example = '') {
  return { name, summary, usage, flags: flags.map((flag) => ({ name: `--${flag}`, desc: doc(flag) })), example }
}

export const COMMANDS = [
  {
    name: 'task',
    summary: '任务域：查询、建单、状态流转、依赖',
    actions: [
      action('ready', '列出可立即开工的任务（未开始、无负责人、依赖已满足）', 'task ready [--limit N] [--stage S] [--milestone M]', ['limit', 'stage', 'milestone'], 'ptask task ready --limit 3'),
      action('start', '开始任务：置 doing 并占用负责人', 'task start <id>', [], 'ptask task start T-0007'),
      action('done', '完成任务：必须附证据，关闭里程碑时会提示归档', 'task done <id> --evidence "..." [--version v] [--force] [--backfill]', ['evidence', 'version', 'force', 'backfill'], 'ptask task done T-0007 --evidence "12/12 通过" --version v1.0.191'),
      action('release', '释放占用：open 与 doing 都可释放，不改变业务状态', 'task release <id> [--note "..."] [--force]', ['note', 'force'], 'ptask task release T-0007 --note "等客户确认"'),
      action('block', '标记阻塞，必须写原因', 'task block <id> --reason "..."', ['reason'], 'ptask task block T-0007 --reason "等 GPU 到货"'),
      action('unblock', '解除阻塞（不影响进行中状态）', 'task unblock <id>', [], 'ptask task unblock T-0007'),
      action('reopen', '把已完成/已取消任务重新打开', 'task reopen <id>', [], 'ptask task reopen T-0007'),
      action('create', '新建任务。登记≠认领：默认不占负责人，直接进 ready；给已完成父任务挂子任务会提示父任务回退', 'task create --title "..." [--parent id] [--priority P] [--urgency N] [--tags a,b] [--notes "..."] [--stage S] [--holder X | --claim] [--container] [--blocked-by id]', ['title', 'parent', 'priority', 'urgency', 'tags', 'notes', 'stage', 'holder', 'claim', 'container', 'blocked-by', 'dep-type'], 'ptask task create --title "PDF 解析接入" --parent T-0075 --priority P0 --urgency 3 --tags KB-PREP'),
      action('list', '按条件列任务，默认按里程碑/阶段分组', 'task list [--status S] [--tag T] [--stage S] [--milestone M] [--blocked] [--ready] [--flat] [--archived]', ['status', 'tag', 'stage', 'milestone', 'blocked', 'ready', 'flat', 'archived'], 'ptask task list --blocked'),
      action('get', '查看单条任务全貌（含历史、决策、依赖）', 'task get <id> [--no-history] [--full]', ['no-history', 'full'], 'ptask task get T-0007'),
      action('update', '修改字段；改 notes 是覆盖式', 'task update <id> [--title] [--priority] [--urgency] [--tags] [--notes] [--parent] [--stage] [--role] [--version] [--evidence] [--force]', ['title', 'priority', 'urgency', 'tags', 'notes', 'parent', 'stage', 'role', 'version', 'evidence', 'force'], 'ptask task update T-0007 --notes "做什么 + 验收标准"'),
      action('dep', '依赖管理：add/remove/list。方向是「前者依赖后者」', 'task dep add|remove <id> --blocked-by <id> [--type hard|soft] [--note "..."]\n  task dep list <id>', ['blocked-by', 'type', 'note'], 'ptask task dep add T-0091 --blocked-by T-0090'),
      action('status', '一句话总览 + 少量就绪建议', 'task status', [], 'ptask task status'),
      action('suggest', '只读推荐一条最该开工的任务，并给出排序理由与备选', 'task suggest', [], 'ptask task suggest --json'),
      action('sync-parents', '收口子任务已全部完成的父任务（含子任务已归档的场景），聚合版本与证据', 'task sync-parents [--dry-run]', ['dry-run'], 'ptask task sync-parents --dry-run'),
    ],
  },
  {
    name: 'context',
    summary: '任务上下文：目标、决策流水、进度快照、未关闭事项',
    actions: [
      action('get', '查看全部上下文', 'context get <id>', [], 'ptask context get T-0075'),
      action('decision', '追加一条决策（追加式，永不覆盖）', 'context decision <id> "文本"', [], 'ptask context decision T-0075 "PDF 用 pdfplumber 抽文本层"'),
      action('progress', '写进度快照。默认覆盖，--append 才是追加', 'context progress <id> "文本" [--append]', ['append'], 'ptask context progress T-0075 "已完成解析器" --append'),
      action('loop', '登记或关闭未关闭事项', 'context loop <id> "文本" | context loop <id> --close N', ['close'], 'ptask context loop T-0075 --close 1'),
    ],
  },
  {
    name: 'milestone',
    summary: '里程碑（含阶段树与进度汇总）',
    actions: [
      action('create', '新建里程碑，可同时建阶段', 'milestone create --name "..." [--description "..."] [--stages a,b]', ['name', 'description', 'stages'], 'ptask milestone create --name "Q4 交付" --stages 调研,实现'),
      action('list', '列出全部里程碑及进度', 'milestone list', [], 'ptask milestone list'),
      action('get', '查看单个里程碑及其阶段', 'milestone get <code>', [], 'ptask milestone get M-0002'),
      action('update', '修改名称/说明/状态', 'milestone update <code> [--name] [--description] [--status]', ['name', 'description', 'status'], ''),
      action('delete', '删除里程碑', 'milestone delete <code> [--force]', ['force'], ''),
      action('dep', '里程碑之间的前后置关系', 'milestone dep add|remove <code> --blocked-by <code>', ['blocked-by'], ''),
    ],
  },
  {
    name: 'stage',
    summary: '功能阶段（挂在里程碑下）',
    actions: [
      action('create', '新建阶段', 'stage create --name "..." [--milestone M] [--description "..."]', ['name', 'milestone', 'description'], ''),
      action('list', '列出阶段', 'stage list [--milestone M]', ['milestone'], ''),
      action('get', '查看单个阶段', 'stage get <code>', [], ''),
      action('update', '修改阶段', 'stage update <code> [--name] [--status] [--description]', ['name', 'status', 'description'], ''),
      action('reorder', '调整阶段顺序', 'stage reorder <code> --order N', ['order'], ''),
      action('delete', '删除阶段', 'stage delete <code> [--force]', ['force'], ''),
      action('dep', '阶段之间的前后置关系', 'stage dep add|remove <code> --blocked-by <code>', ['blocked-by'], ''),
    ],
  },
  {
    name: 'tag',
    summary: '标签词表（编码 ASCII，名称中文）',
    actions: [
      action('add', '新增标签', 'tag add --name "..." [--code X] [--description "..."] [--aliases a,b]', ['name', 'code', 'description', 'aliases'], ''),
      action('update', '修改标签', 'tag update <code> [--name] [--description] [--status]', ['name', 'description', 'status'], ''),
      action('deprecate', '标记标签为废弃', 'tag deprecate <code>', [], ''),
      action('list', '列出标签；默认只列 active，--all 含废弃', 'tag list [--all]', ['all'], 'ptask tag list'),
      action('todos', '列出带某标签的任务', 'tag todos <code>', [], 'ptask tag todos REQ'),
    ],
  },
  {
    name: 'res',
    summary: '资源：把外部产物（文档、脚本、URL）挂到任务上',
    actions: [
      action('add', '登记资源', 'res add <id> --name "..." [--path P | --url U]', ['name', 'path', 'url'], ''),
      action('approve', '确认资源已可用', 'res approve <id>', [], ''),
      action('supersede', '标记资源被取代', 'res supersede <id>', [], ''),
      action('list', '列出资源', 'res list <id>', [], ''),
    ],
  },
  {
    name: 'pre',
    summary: '前置条件：外部输入是否到位',
    actions: [
      action('add', '登记前置条件', 'pre add <id> --name "..." [--required]', ['name', 'required'], ''),
      action('confirm', '确认前置已满足', 'pre confirm <id>', [], ''),
      action('remove', '移除前置', 'pre remove <id>', [], ''),
      action('list', '列出前置', 'pre list <id>', [], ''),
    ],
  },
  {
    name: 'cause',
    summary: '因果关系：记录任务之间的影响因素',
    actions: [
      action('add', '登记原因', 'cause add <id> --cause <id> [--note "..."]', ['cause', 'note'], ''),
      action('remove', '移除原因', 'cause remove <id> --cause <id>', ['cause'], ''),
      action('list', '列出原因', 'cause list <id>', [], ''),
      action('chain', '查看因果链', 'cause chain <id>', [], ''),
    ],
  },
  {
    name: 'git',
    summary: 'Git 集成：把提交关联到任务',
    actions: [
      action('link', '把当前提交关联到任务', 'git link <id>', [], ''),
      action('hook', '安装/卸载提交钩子', 'git hook install|uninstall', [], ''),
    ],
  },
  {
    name: 'admin',
    summary: '管理操作：归档、导入导出、批量修正',
    actions: [
      action('archive', '归档已完成任务', 'admin archive <id>', [], ''),
      action('unarchive', '取消归档', 'admin unarchive <id>', [], ''),
      action('archive-batch', '按里程碑/阶段/ID 批量归档', 'admin archive-batch [--ids a,b] [--milestone M] [--stage S] [--include-open]', ['ids', 'milestone', 'stage', 'include-open'], ''),
      action('reopen', '重新打开（等价 task reopen）', 'admin reopen <id>', [], ''),
      action('unblock', '解除阻塞（等价 task unblock）', 'admin unblock <id>', [], ''),
      action('delete', '删除任务', 'admin delete <id> [--cascade] [--purge]', ['cascade', 'purge'], ''),
      action('claim-batch', '按标签批量领取', 'admin claim-batch [--tag T] [--limit N] [--force]', ['tag', 'limit', 'force'], ''),
      action('release-batch', '按标签批量释放', 'admin release-batch [--tag T]', ['tag'], ''),
      action('check', '校验看板一致性', 'admin check', [], 'ptask admin check'),
      action('people', '列出人员与在办数量', 'admin people', [], ''),
      action('repair-people', '修正无效的人员字段', 'admin repair-people [--person X] [--dry-run]', ['person', 'dry-run'], ''),
      action('timeline-clear', '清空时间轴（危险）', 'admin timeline-clear --confirm', ['confirm'], ''),
      action('timeline', '查看时间轴（等价 timeline）', 'admin timeline [--type T] [--task id]', ['type', 'task'], ''),
      action('export', '导出看板为 md / xlsx / json / html（单文件离线报告）', 'admin export [--format md|xlsx|json|html] [--scope active|archive|all] [--template NAME|PATH] [--title "..."]', ['format', 'scope', 'template', 'title'], 'ptask admin export --format html --scope all'),
      action('templates', '列出内置 HTML 模板及其绝对路径（复制出去即可自定义）', 'admin templates', [], 'ptask admin templates'),
      action(
        'import-file',
        '从文件导入任务。json 格式按 id 幂等合并（存在则更新，不存在则新建），逐条给结果',
        'admin import-file <file> [--format md|xlsx|json] [--dry-run] [--create-only]',
        ['format', 'dry-run', 'create-only'],
        'ptask admin import-file backlog.json --dry-run',
      ),
      action('import', '从内置目录导入', 'admin import [--source NAME] [--dry-run]', ['source', 'dry-run'], ''),
    ],
  },
  {
    name: 'timeline',
    summary: '时间轴：全部变更流水',
    actions: [
      { name: '(default)', summary: '按时间倒序列出变更；holder_fix 等管理类事件默认隐藏', usage: 'timeline [--type task|dependency|org|tag|context|resource|precondition|cause|admin] [--all] [--task id] [--limit N]', flags: [{ name: '--type', desc: '只看某一类事件；admin 只看管理类' }, { name: '--all', desc: '包含管理类事件' }, { name: '--task', desc: '只看某条任务' }, { name: '--limit', desc: '最多返回条数' }], example: 'ptask timeline --task T-0075 --all' },
    ],
  },
  {
    name: 'schema',
    summary: '输出命令与参数结构（Agent 自发现用）',
    actions: [
      { name: '(default)', summary: '打印全部命令的机器可读结构', usage: 'schema [command] [--json]', flags: [{ name: '--json', desc: 'JSON（默认就是 JSON）' }], example: 'ptask schema --json' },
    ],
  },
  {
    name: 'migrate',
    summary: '数据格式迁移',
    actions: [{ name: '(default)', summary: '把旧版本数据升级到当前 schema', usage: 'migrate [--dry-run]', flags: [{ name: '--dry-run', desc: '' }], example: '' }],
  },
  {
    name: 'doctor',
    summary: '环境自检：仓库、git 身份、数据完整性',
    actions: [{ name: '(default)', summary: '体检并给出修复建议', usage: 'doctor', flags: [], example: 'ptask doctor' }],
  },
  {
    name: 'skill',
    summary: '把使用规范安装到 agent 技能目录',
    actions: [{ name: '(default)', summary: 'install|status|remove', usage: 'skill install|status|remove [target]', flags: [], example: 'ptask skill install' }],
  },
  {
    name: 'init',
    summary: '初始化项目待办库',
    actions: [{ name: '(default)', summary: '创建 docs/ptask 与默认里程碑', usage: 'init [--template simple|standard]', flags: [{ name: '--template', desc: 'simple|standard' }], example: 'ptask init --template standard' }],
  },
  {
    name: 'whoami',
    summary: '查看当前解析出的 actor / person',
    actions: [{ name: '(default)', summary: '显示身份来源', usage: 'whoami', flags: [], example: 'ptask whoami --json' }],
  },
]

/** Compatibility aliases kept for old scripts; intentionally hidden from help. */
export const ALIASES = ['status', 'list', 'get', 'next', 'continue', 'create', 'claim', 'unclaim', 'release', 'block', 'done', 'update']

export function findCommand(name) {
  return COMMANDS.find((command) => command.name === name) || null
}

export function findAction(commandName, actionName) {
  const command = findCommand(commandName)
  if (!command) return null
  return command.actions.find((entry) => entry.name === actionName) || null
}

/** Machine-readable structure for `ptask schema --json`. */
export function schemaJson(version) {
  return {
    ok: true,
    action: 'schema',
    tool: 'ptask',
    version: version || null,
    globalFlags: GLOBAL_FLAGS,
    commands: COMMANDS.map((command) => ({
      name: command.name,
      summary: command.summary,
      actions: command.actions.map((entry) => ({
        name: entry.name,
        summary: entry.summary,
        usage: entry.usage,
        flags: entry.flags,
        example: entry.example || undefined,
      })),
    })),
    aliases: ALIASES,
  }
}
