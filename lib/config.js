/**
 * Shared project-todo configuration.
 *
 * Defaults are the single source of truth for both the DSH plugin and the
 * global `ptodo` CLI. A project may override them with
 * `docs/ptodo/config.json`; a DSH loader row may override the file. The CLI
 * and the plugin therefore see the same paths and limits.
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fail } from './model.js'

export const DATA_DIR = 'docs/ptodo'
export const DEFAULT_STORE = `${DATA_DIR}/todos.json`
export const DEFAULT_ARCHIVE = `${DATA_DIR}/archive.json`
export const DEFAULT_HISTORY = `${DATA_DIR}/todos.history.jsonl`
export const DEFAULT_MILESTONES = `${DATA_DIR}/milestones.json`
export const DEFAULT_TAGS = `${DATA_DIR}/tags.json`
export const CONFIG_PATH = `${DATA_DIR}/config.json`

const configCache = new Map()

function number(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function stringList(value, fallback) {
  if (!Array.isArray(value)) return fallback
  const list = value.map((item) => String(item).trim()).filter(Boolean)
  return list.length ? list : fallback
}

const DEFAULT_SKILL_TARGETS = ['project', 'agents', 'dsh', 'zcode', 'workbuddy', 'claude', 'codex']

/** Merge row config over defaults; unknown values fall back without blocking. */
export function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const defaultTab = ['auto', 'all', 'ready', 'doing', 'blocked', 'done', 'archived'].includes(source.ui?.defaultTab)
    ? source.ui.defaultTab
    : 'auto'
  return {
    store: { path: typeof source.store?.path === 'string' && source.store.path ? source.store.path : DEFAULT_STORE },
    milestones: {
      path:
        typeof source.milestones?.path === 'string' && source.milestones.path
          ? source.milestones.path
          : DEFAULT_MILESTONES,
    },
    tags: { path: typeof source.tags?.path === 'string' && source.tags.path ? source.tags.path : DEFAULT_TAGS },
    markdown: {
      enabled: source.markdown?.enabled !== false,
      path: typeof source.markdown?.path === 'string' && source.markdown.path ? source.markdown.path : '.dsh/TODO.md',
      archivePath:
        typeof source.markdown?.archivePath === 'string' && source.markdown.archivePath
          ? source.markdown.archivePath
          : '.dsh/ARCHIVE.md',
      doneLimit: number(source.markdown?.doneLimit, 20, 0, 200),
    },
    archive: {
      afterDays: number(source.archive?.afterDays, 3, 0, 3650),
      path: typeof source.archive?.path === 'string' && source.archive.path ? source.archive.path : DEFAULT_ARCHIVE,
    },
    python: typeof source.python === 'string' ? source.python : '',
    import: {
      source:
        typeof source.import?.source === 'string' && source.import.source ? source.import.source : '开发计划/todo/TODO.md',
    },
    batch: { claimLimit: number(source.batch?.claimLimit, 3, 1, 20) },
    history: {
      enabled: source.history?.enabled !== false,
      path:
        typeof source.history?.path === 'string' && source.history.path
          ? source.history.path
          : DEFAULT_HISTORY,
    },
    version: {
      // Automatic git short hash; `require` refuses a completion when neither
      // the hash nor an explicit version is available.
      auto: source.version?.auto !== false,
      require: source.version?.require !== false,
      gitDir: typeof source.version?.gitDir === 'string' ? source.version.gitDir : '',
      // Optional version-note directory (relative to the project root). Empty
      // means doctor probes docs/version and utp/docs/version.
      docDir: typeof source.version?.docDir === 'string' ? source.version.docDir.trim() : '',
    },
    ui: { enabled: source.ui?.enabled !== false, defaultTab },
    tag: { strict: source.tag?.strict === true },
    dependency: { suggestOnCreate: source.dependency?.suggestOnCreate !== false },
    context: {
      maxDecisions: number(source.context?.maxDecisions, 50, 1, 500),
      maxOpenLoops: number(source.context?.maxOpenLoops, 20, 1, 200),
    },
    actor: { requirePrefix: source.actor?.requirePrefix === true },
    skill: { targets: stringList(source.skill?.targets, DEFAULT_SKILL_TARGETS) },
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (isObject(value)) {
      target[key] = deepMerge(isObject(target[key]) ? target[key] : {}, value)
    } else if (value !== undefined) {
      target[key] = value
    }
  }
  return target
}

/**
 * Read `docs/ptodo/config.json` for one project. Missing file means "{}".
 * A malformed file is a hard error so the CLI and the plugin never silently
 * disagree about the data location.
 */
export function readProjectConfigSync(root) {
  const file = path.join(root, CONFIG_PATH)
  let stat
  try {
    stat = statSync(file)
  } catch {
    configCache.delete(root)
    return {}
  }
  const cached = configCache.get(root)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value
  let value
  try {
    value = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail('PARSE_ERROR', `${CONFIG_PATH} 不是合法 JSON：${error.message}`)
  }
  if (!isObject(value)) fail('PARSE_ERROR', `${CONFIG_PATH} 必须是对象`)
  configCache.set(root, { mtimeMs: stat.mtimeMs, size: stat.size, value })
  return value
}

/** Effective config for one project: defaults < file < loader row. */
export function configFor(root, rowConfig) {
  const file = readProjectConfigSync(root)
  return normalizeConfig(deepMerge(deepMerge({}, file), rowConfig || {}))
}

/** Paths the store will use, for diagnostics. */
export function pathsOf(root, config) {
  return {
    root,
    dataDir: path.join(root, DATA_DIR),
    store: path.join(root, config.store.path),
    milestones: path.join(root, config.milestones?.path || DEFAULT_MILESTONES),
    tags: path.join(root, config.tags?.path || DEFAULT_TAGS),
    archive: path.join(root, config.archive.path),
    history: path.resolve(root, config.history.path),
    markdown: path.join(root, config.markdown.path),
    archiveMarkdown: path.join(root, config.markdown.archivePath),
    config: path.join(root, CONFIG_PATH),
  }
}
