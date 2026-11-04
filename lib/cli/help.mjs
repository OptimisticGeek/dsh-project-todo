const CORE_HELP = `ptodo — 项目待办（唯一入口，数据 docs/ptodo/todos.json）

用法：
  ptodo <命令> [参数] [--root DIR] [--by ACTOR] [--json]

Agent 的六个抽象命令：
  task ready [--limit N] [--stage S] [--milestone M]
  task start <id>
  task done <id> [--evidence "..."] [--version v]
  task release <id> [--note "..."]
  task block <id> --reason "..."
  task create --title "..." [--stage S] [--priority P] [--urgency N] [--tags a,b] [--parent id]

管理命令：
  task list|get|update|dep add|remove|list
  milestone create|list|get|update|delete|dep add|remove|list
  stage     create|list|get|update|reorder|delete|dep add|remove|list
  tag       add|update|deprecate|list|todos
  context   get|decision|progress|loop
  res       add|approve|supersede|list
  pre       add|remove|list|confirm
  cause     add|remove|list|chain
  git       link | hook install|uninstall
  timeline [--type task|dependency|org|tag|context|resource|precondition|cause] [--task id]
  whoami | doctor | init [--template simple|standard] | migrate | skill install|status|remove

兼容别名（不展示在技能里）：status/list/get/next/continue/create/claim/release/block/done/update/admin

示例：
  ptodo task ready --limit 3
  ptodo task start T-0007
  ptodo task done T-0007 --evidence "301/302 通过"
  ptodo task release T-0007 --note "等客户确认"
  ptodo milestone create --name "Q4 交付" --stages 调研,实现
  ptodo tag todos REQ
  ptodo git link
`

export function printHelp(command) {
  const text = command === 'admin'
    ? CORE_HELP + `\nadmin 示例：\n  ptodo admin archive T-0007\n  ptodo admin export --format md\n`
    : CORE_HELP
  process.stdout.write(text)
}
