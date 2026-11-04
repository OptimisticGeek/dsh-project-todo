/**
 * Project tag registry (`docs/ptodo/tags.json`).
 *
 * Tasks store tag codes. Unknown tags are auto-registered as `draft` unless
 * `tag.strict=true`; deprecating a tag records its replacement so later use can
 * be flagged. `usageCount` is derived from the board/archive, never stored.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { TAG_VERSION, fail, nowIso } from './model.js'
import { acquireLock, writeAtomic } from './fs-store.js'
import { appendHistory, historyFileOf } from './history.js'

export const TAG_STATUSES = ['active', 'draft', 'deprecated']
const CODE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,31}$/

export function emptyTags() {
  return { version: TAG_VERSION, revision: 0, updatedAt: nowIso(), tags: [] }
}

function normalizeTag(entry) {
  if (!entry || typeof entry !== 'object') return null
  const code = String(entry.code || '')
  if (!CODE_RE.test(code)) return null
  return {
    code,
    name: String(entry.name == null ? '' : entry.name).trim() || code,
    description: typeof entry.description === 'string' ? entry.description : '',
    aliases: Array.isArray(entry.aliases) ? [...new Set(entry.aliases.map((item) => String(item).trim()).filter(Boolean))] : [],
    status: TAG_STATUSES.includes(entry.status) ? entry.status : 'draft',
    deprecatedBy: entry.deprecatedBy ? String(entry.deprecatedBy) : null,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : nowIso(),
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : nowIso(),
  }
}

export function normalizeTagsFile(file) {
  if (!file || typeof file !== 'object') return emptyTags()
  const tags = (Array.isArray(file.tags) ? file.tags : []).map(normalizeTag).filter(Boolean)
  const seen = new Set()
  return {
    version: TAG_VERSION,
    revision: Number.isInteger(file.revision) && file.revision >= 0 ? file.revision : 0,
    updatedAt: typeof file.updatedAt === 'string' ? file.updatedAt : nowIso(),
    tags: tags.filter((tag) => {
      if (seen.has(tag.code)) return false
      seen.add(tag.code)
      return true
    }),
  }
}

export function validateTagsFile(file) {
  if (!file || typeof file !== 'object') fail('PARSE_ERROR', '标签文件不是对象')
  if (file.version !== TAG_VERSION) {
    fail('PARSE_ERROR', `不支持的标签文件版本 ${String(file.version)}（期望 ${TAG_VERSION}）`)
  }
  const codes = new Set()
  for (const tag of file.tags) {
    if (codes.has(tag.code)) fail('INVALID', `标签编码重复：${tag.code}`)
    codes.add(tag.code)
    if (tag.deprecatedBy && !CODE_RE.test(tag.deprecatedBy)) fail('INVALID', `标签 ${tag.code} 的替代编码非法`)
  }
  return file
}

/** Lowercase slug used when an input tag is not a valid code. */
export function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return /^[a-z]/.test(slug) ? slug : ''
}

function nextAutoCode(tags) {
  let index = 1
  const used = new Set(tags.map((tag) => tag.code))
  while (used.has(`tag-${String(index).padStart(4, '0')}`)) index += 1
  return `tag-${String(index).padStart(4, '0')}`
}

export class TagStore {
  constructor(root, config) {
    this.root = root
    this.config = config || {}
    this.file = path.join(root, this.config.tags?.path || 'docs/ptodo/tags.json')
    this.historyFile = historyFileOf(root, this.config)
    this.lockFile = `${this.file}.lock`
    this.queue = Promise.resolve()
  }

  async read() {
    if (!existsSync(this.file)) return validateTagsFile(emptyTags())
    let parsed
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (error) {
      fail('PARSE_ERROR', `标签文件不是合法 JSON：${error.message}`)
    }
    return validateTagsFile(normalizeTagsFile(parsed))
  }

  readSync() {
    try {
      if (!existsSync(this.file)) return emptyTags()
      return validateTagsFile(normalizeTagsFile(JSON.parse(readFileSync(this.file, 'utf8'))))
    } catch {
      return emptyTags()
    }
  }

  enqueue(operation) {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async mutate(action, by, mutator) {
    return this.enqueue(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const release = await acquireLock(this.lockFile)
      try {
        const raw = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : emptyTags()
        const file = normalizeTagsFile(raw)
        const result = (await mutator(file)) || {}
        file.revision += 1
        file.updatedAt = nowIso()
        validateTagsFile(file)
        await writeAtomic(this.file, `${JSON.stringify(file, null, 2)}\n`)
        await appendHistory(this.historyFile, {
          at: nowIso(),
          revision: file.revision,
          action,
          by: by || 'system',
          entity: 'tag',
          taskIds: [],
          changes: result.changed || [],
        }).catch(() => {})
        return { file, result }
      } finally {
        await release()
      }
    })
  }

  async add(input, by) {
    return this.mutate('tag_add', by, (file) => {
      const name = String(input.name || '').trim()
      if (!name) fail('INVALID', '标签名称不能为空')
      const explicit = String(input.code || '').trim()
      const code = explicit || (CODE_RE.test(name) ? name : slugify(name) || nextAutoCode(file.tags))
      if (!CODE_RE.test(code)) fail('INVALID', `标签编码非法：${code}`)
      if (file.tags.some((tag) => tag.code === code)) fail('CONFLICT', `标签已存在：${code}`)
      const tag = {
        code,
        name,
        description: typeof input.description === 'string' ? input.description : '',
        aliases: Array.isArray(input.aliases) ? input.aliases.map((item) => String(item).trim()).filter(Boolean) : [],
        status: TAG_STATUSES.includes(input.status) ? input.status : 'active',
        deprecatedBy: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      file.tags.push(tag)
      return { changed: [{ code, action: 'created' }], tag }
    })
  }

  async update(code, patch, by) {
    return this.mutate('tag_update', by, (file) => {
      const tag = file.tags.find((entry) => entry.code === code)
      if (!tag) fail('TAG_NOT_FOUND', `没有标签 ${code}`)
      if (patch.name !== undefined) {
        const name = String(patch.name).trim()
        if (!name) fail('INVALID', '标签名称不能为空')
        tag.name = name
      }
      if (patch.description !== undefined) tag.description = String(patch.description)
      if (patch.aliases !== undefined) {
        tag.aliases = Array.isArray(patch.aliases) ? patch.aliases.map((item) => String(item).trim()).filter(Boolean) : []
      }
      if (patch.status !== undefined) {
        if (!TAG_STATUSES.includes(patch.status)) fail('INVALID', `标签状态非法：${patch.status}`)
        tag.status = patch.status
      }
      tag.updatedAt = nowIso()
      return { changed: [{ code, action: 'updated' }], tag }
    })
  }

  async deprecate(code, replacement, by) {
    return this.mutate('tag_deprecate', by, (file) => {
      const tag = file.tags.find((entry) => entry.code === code)
      if (!tag) fail('TAG_NOT_FOUND', `没有标签 ${code}`)
      const next = replacement ? String(replacement) : ''
      if (next && !file.tags.some((entry) => entry.code === next)) fail('TAG_NOT_FOUND', `替代标签不存在：${next}`)
      tag.status = 'deprecated'
      tag.deprecatedBy = next || null
      tag.updatedAt = nowIso()
      return { changed: [{ code, action: 'deprecated' }], tag }
    })
  }

  /**
   * Resolve input tags to registered codes, creating drafts when allowed.
   * @returns {Promise<{codes: string[], warnings: string[], created: string[]}>}
   */
  async ensure(inputs, by, options = {}) {
    const list = Array.isArray(inputs) ? inputs.map((item) => String(item).trim()).filter(Boolean) : []
    if (!list.length) return { codes: [], warnings: [], created: [] }
    return this.mutate('tag_ensure', by, (file) => {
      const codes = []
      const warnings = []
      const created = []
      for (const input of list) {
        const lower = input.toLowerCase()
        let tag = file.tags.find((entry) => entry.code === input)
        if (!tag) tag = file.tags.find((entry) => entry.name.toLowerCase() === lower)
        if (!tag) tag = file.tags.find((entry) => entry.aliases.some((alias) => alias.toLowerCase() === lower))
        if (!tag) {
          if (options.strict) fail('TAG_NOT_FOUND', `未注册标签：${input}`)
          const code = CODE_RE.test(input) ? input : slugify(input) || nextAutoCode(file.tags)
          if (!CODE_RE.test(code)) fail('INVALID', `无法生成标签编码：${input}`)
          let unique = code
          let suffix = 1
          while (file.tags.some((entry) => entry.code === unique)) {
            suffix += 1
            unique = `${code}-${suffix}`
          }
          tag = {
            code: unique,
            name: input,
            description: '',
            aliases: [],
            status: 'draft',
            deprecatedBy: null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          }
          file.tags.push(tag)
          created.push(unique)
          warnings.push(`标签 ${input} 未注册，已自动创建 draft ${unique}`)
        }
        if (tag.status === 'deprecated') {
          warnings.push(`标签 ${tag.code} 已废弃${tag.deprecatedBy ? `，建议改用 ${tag.deprecatedBy}` : ''}`)
        }
        if (!codes.includes(tag.code)) codes.push(tag.code)
      }
      return { changed: created.map((code) => ({ code, action: 'created' })), codes, warnings, created }
    }).then(({ result }) => ({ codes: result.codes, warnings: result.warnings, created: result.created }))
  }
}

const tagStores = new Map()
export function tagStoreFor(root, config) {
  const key = `${path.resolve(root)}|${JSON.stringify(config || {})}`
  let store = tagStores.get(key)
  if (!store) {
    store = new TagStore(path.resolve(root), config)
    tagStores.set(key, store)
  }
  return store
}

/** Write an empty registry during `ptodo init --template standard`. */
export async function initTags(root, config) {
  const store = tagStoreFor(root, config)
  const file = emptyTags()
  await writeAtomic(store.file, `${JSON.stringify(file, null, 2)}\n`)
  return file
}
