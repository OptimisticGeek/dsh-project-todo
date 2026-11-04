/**
 * Small file-store primitives shared by all project-todo data files:
 * in-process queue, cross-process lock file, atomic write.
 *
 * Extracted from store.js so the board, milestones/stages and tags can use the
 * same guarantees without duplicating the tricky parts.
 */
import { open, rename, stat, unlink, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fail } from './model.js'

export const LOCK_STALE_MS = 10_000
export const LOCK_WAIT_MS = 2_000
export const LOCK_RETRY_MS = 50

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Write a file atomically inside its directory. */
export async function writeAtomic(target, content) {
  await mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, content, 'utf8')
  const handle = await open(temp, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rename(temp, target)
      return
    } catch (error) {
      if (attempt === 2) {
        try {
          await unlink(target)
          await rename(temp, target)
          return
        } catch {
          await unlink(temp).catch(() => {})
          throw error
        }
      }
      await sleep(20)
    }
  }
}

/** Create an exclusive lock file; returns an async release function. */
export async function acquireLock(lockFile) {
  const started = Date.now()
  await mkdir(path.dirname(lockFile), { recursive: true })
  for (;;) {
    try {
      const handle = await open(lockFile, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }))
      await handle.close()
      return async () => {
        await unlink(lockFile).catch(() => {})
      }
    } catch (error) {
      if (error.code !== 'EEXIST') fail('IO_ERROR', `无法创建锁文件：${error.message}`)
      try {
        const info = await stat(lockFile)
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await unlink(lockFile).catch(() => {})
          continue
        }
      } catch {
        continue
      }
      if (Date.now() - started > LOCK_WAIT_MS) fail('CONFLICT', '待办文件正被其他会话写入，请稍后重试')
      await sleep(LOCK_RETRY_MS)
    }
  }
}

/** Serializes async operations inside one process. */
export class FileQueue {
  constructor() {
    this.queue = Promise.resolve()
  }

  enqueue(operation) {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
