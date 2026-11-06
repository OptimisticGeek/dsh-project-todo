/**
 * Help rendering, driven by the command registry in `schema.mjs`.
 *
 * Three levels:
 *   ptodo --help                 overview (all commands, one line each)
 *   ptodo task --help            every action of `task`
 *   ptodo task update --help     one action: usage, flags, example
 */
import { ALIASES, COMMANDS, GLOBAL_FLAGS, findAction, findCommand } from './schema.mjs'

const HEADER = `ptodo — 项目待办（唯一入口，数据 docs/ptodo/todos.json）`

function globalSection() {
  const lines = ['全局参数：']
  for (const flag of GLOBAL_FLAGS) {
    const head = flag.boolean ? flag.name : `${flag.name} ${flag.value}`
    lines.push(`  ${head.padEnd(18)} ${flag.desc}`)
  }
  return lines.join('\n')
}

function overview() {
  const lines = [
    HEADER,
    '',
    '用法：',
    '  ptodo <命令> [子命令] [参数] [--root DIR] [--by ACTOR] [--json]',
    '',
    'Agent 最常用的六个动作：',
    '  task ready [--limit N]                 # 可开工的队列',
    '  task start <id>                        # 开工并占用',
    '  task done <id> --evidence "..."        # 完成必须带证据',
    '  task release <id> [--note "..."]       # 释放（open/doing 都可）',
    '  task block <id> --reason "..."         # 标记阻塞',
    '  task create --title "..." [--parent id] [--priority P] [--urgency N]',
    '',
    '命令一览（详细用法：ptodo <命令> --help）：',
  ]
  for (const command of COMMANDS) {
    const names = command.actions.map((entry) => entry.name).filter((name) => name !== '(default)')
    const list = names.length ? names.join('|') : ''
    const head = list ? `${command.name} ${list}` : command.name
    lines.push(`  ${head}`)
    lines.push(`      ${command.summary}`)
  }
  lines.push('')
  lines.push(`兼容别名（不展示在技能里）：${ALIASES.join('/')}`)
  lines.push('')
  lines.push(globalSection())
  lines.push('')
  lines.push('示例：')
  lines.push('  ptodo task ready --limit 3')
  lines.push('  ptodo task create --title "PDF 解析接入" --parent T-0075 --priority P0')
  lines.push('  ptodo task done T-0007 --evidence "301/302 通过" --version v1.0.191')
  lines.push('  ptodo admin export --format json --scope all')
  lines.push('  ptodo schema --json')
  return lines.join('\n')
}

function commandHelp(command) {
  const lines = [`${HEADER}`, '', `ptodo ${command.name} — ${command.summary}`, '', '子命令：']
  for (const entry of command.actions) {
    lines.push(`  ${entry.usage}`)
    lines.push(`      ${entry.summary}`)
  }
  const examples = command.actions.filter((entry) => entry.example)
  if (examples.length) {
    lines.push('')
    lines.push('示例：')
    for (const entry of examples.slice(0, 3)) lines.push(`  ${entry.example}`)
  }
  lines.push('')
  lines.push('查看单个子命令的参数：ptodo ' + command.name + ' <子命令> --help')
  lines.push('')
  lines.push(globalSection())
  return lines.join('\n')
}

function actionHelp(command, entry) {
  const lines = [`ptodo ${entry.usage}`, '', entry.summary, '']
  const own = (entry.flags || []).filter((flag) => flag.name !== '--json')
  if (own.length) {
    lines.push('参数：')
    for (const flag of own) lines.push(`  ${flag.name.padEnd(16)} ${flag.desc || ''}`)
    lines.push('')
  }
  if (entry.example) {
    lines.push('示例：')
    lines.push(`  ${entry.example}`)
    lines.push('')
  }
  lines.push('通用：--json 输出单个 JSON 文档；--root/--by 为全局参数。')
  return lines.join('\n')
}

/**
 * @param {string} [command] first positional (`task`)
 * @param {string} [action] second positional (`update`)
 */
export function printHelp(command, action) {
  if (!command || command === 'help') {
    if (action) return printHelp(action, undefined)
    process.stdout.write(`${overview()}\n`)
    return
  }
  const found = findCommand(command)
  if (!found) {
    process.stdout.write(`${HEADER}\n\n未知命令：${command}。运行 ptodo --help 查看全部命令。\n`)
    process.exitCode = 2
    return
  }
  const entry = action ? findAction(command, action) : null
  if (action && entry) {
    process.stdout.write(`${actionHelp(found, entry)}\n`)
    return
  }
  if (action && !entry) {
    const names = found.actions.map((item) => item.name).filter((name) => name !== '(default)')
    process.stdout.write(
      `${HEADER}\n\nptodo ${command} 没有子命令「${action}」。可用：${names.join('/') || '（无）'}\n`,
    )
    process.exitCode = 2
    return
  }
  process.stdout.write(`${commandHelp(found)}\n`)
}
