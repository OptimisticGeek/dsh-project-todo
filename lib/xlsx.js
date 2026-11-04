/**
 * Excel bridge. XLSX creation/parsing is delegated to openpyxl through a small
 * Python helper because Node has no built-in workbook support; Markdown import
 * and export stay pure JavaScript.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { fail } from './model.js'

const run = promisify(execFile)
const HELPER = fileURLToPath(new URL('../tools/xlsx_helper.py', import.meta.url))

export function pythonExecutable(config = {}) {
  if (config.python) return String(config.python)
  if (process.env.DSH_TODO_PYTHON) return process.env.DSH_TODO_PYTHON
  const fixed = 'C:\\Python312\\python.exe'
  if (existsSync(fixed)) return fixed
  return 'python'
}

async function execute(args, config) {
  try {
    const result = await run(pythonExecutable(config), [HELPER, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    })
    return result
  } catch (error) {
    const detail = (error.stderr || error.stdout || error.message || '').toString().trim()
    fail('IO_ERROR', `Excel 处理失败（需要 Python + openpyxl）：${detail}`)
  }
}

/** Build an XLSX buffer from headers and row objects. */
export async function buildXlsx({ headers, rows, sheet }, config) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-ptodo-xlsx-'))
  const payload = path.join(dir, 'payload.json')
  const output = path.join(dir, 'out.xlsx')
  try {
    await writeFile(payload, JSON.stringify({ headers, rows, sheet }), 'utf8')
    await execute(['export', payload, output], config)
    return await readFile(output)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Parse an XLSX file path into row objects. */
export async function parseXlsx(file, config) {
  const result = await execute(['import', file], config)
  try {
    return JSON.parse(result.stdout || '[]')
  } catch (error) {
    fail('PARSE_ERROR', `Excel 解析失败：${error.message}`)
  }
}
