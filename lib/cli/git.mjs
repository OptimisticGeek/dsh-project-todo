/**
 * `ptodo git ...` — link the project to a repository and manage the optional
 * prepare-commit-msg hook.
 */
import path from 'node:path'
import { installHook, linkRepo, uninstallHook } from '../git.js'
import { TodoError } from '../model.js'
import { bool, one } from './args.mjs'
import { write, writeJson } from './output.mjs'

export async function gitCommand(ctx, flags) {
  const action = (ctx.positional && ctx.positional[0]) || 'link'
  const dir = one(flags.dir) && one(flags.dir) !== true ? path.resolve(String(one(flags.dir))) : ctx.cwd
  if (action === 'link') {
    const result = await linkRepo(ctx.root, ctx.config, dir)
    if (bool(flags.json)) writeJson({ ok: true, action: 'git_link', ...result })
    else write(`已关联仓库：${result.value}\n配置：${result.file}`)
    return
  }
  if (action === 'hook') {
    const sub = (ctx.positional && ctx.positional[1]) || 'install'
    if (sub === 'install') {
      const result = await installHook(dir, { force: bool(flags.force) })
      if (bool(flags.json)) writeJson({ ok: true, action: 'git_hook_install', ...result })
      else write(`已安装 prepare-commit-msg 钩子：${result.path}`)
      return
    }
    if (sub === 'uninstall') {
      const result = await uninstallHook(dir, { force: bool(flags.force) })
      if (bool(flags.json)) writeJson({ ok: true, action: 'git_hook_uninstall', ...result })
      else write(result.removed ? `已移除钩子：${result.path}` : `没有钩子：${result.path}`)
      return
    }
    throw new TodoError('INVALID', `未知 git hook 子命令：${sub}（install/uninstall）`)
  }
  throw new TodoError('INVALID', `未知 git 子命令：${action}（link/hook）`)
}
