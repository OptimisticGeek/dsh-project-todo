/**
 * Help rendering, driven by the command registry in `schema.mjs`.
 *
 * Three levels:
 *   ptask --help                 overview (all commands, one line each)
 *   ptask task --help            every action of `task`
 *   ptask task update --help     one action: usage, flags, example
 */
import { ALIASES, COMMANDS, GLOBAL_FLAGS, findAction, findCommand } from './schema.mjs'

const HEADER = `ptask — 任务（项目任务台账，数据 docs/ptask/tasks.json）`

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
    '  ptask <命令> [参数] [--root DIR] [--by ACTOR] [--json]',
    '',
    'Agent 最常用的六个动作：',
    '  status                                 # 摘要',
    '  ready [--limit N]                      # 可开工的队列（默认 3 条）',
    '  show <id> [--context|--full]           # 摘要 / 关系 / 完整，默认摘要',
    '  start <id> [--full]                    # 开工并拿简报',
    '  done <id> --evidence "..."             # 完成必须带证据',
    '  note decision|progress|loop <id> "..."  # 写回上下文',
    '',
    '命令一览（详细用法：ptask <命令> --help）：',
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
  lines.push('  ptask ready --limit 3')
  lines.push('  ptask show T-0007')
  lines.push('  ptask show T-0007 --context')
  lines.push('  ptask done T-0007 --evidence "301/302 通过" --version v1.0.191')
  lines.push('  ptask admin export --format json --scope all')
  lines.push('  ptask schema --json')
  return lines.join('\n')
}

function commandHelp(command) {
  const lines = [`${HEADER}`, '', `ptask ${command.name} — ${command.summary}`, '', '子命令：']
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
  lines.push('查看单个子命令的参数：ptask ' + command.name + ' <子命令> --help')
  lines.push('')
  lines.push(globalSection())
  return lines.join('\n')
}

function actionHelp(command, entry) {
  const lines = [`ptask ${entry.usage}`, '', entry.summary, '']
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
    process.stdout.write(`${HEADER}\n\n未知命令：${command}。运行 ptask --help 查看全部命令。\n`)
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
      `${HEADER}\n\nptask ${command} 没有子命令「${action}」。可用：${names.join('/') || '（无）'}\n`,
    )
    process.exitCode = 2
    return
  }
  process.stdout.write(`${commandHelp(found)}\n`)
}
