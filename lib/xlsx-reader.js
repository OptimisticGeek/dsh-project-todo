/**
 * Pure-JavaScript XLSX reader used by `ptodo admin import-file`.
 *
 * The previous reader also delegated to Python/openpyxl. This implementation
 * only needs `node:zlib`: it walks the ZIP central directory, inflates the
 * worksheet parts and reads cells (shared strings, inline strings, numbers and
 * date-formatted serials). The first sheet whose header row contains `标题` /
 * `任务` / `title` / `task` is used, so a workbook with a dashboard sheet
 * before the data sheet still imports correctly.
 */
import { inflateRawSync } from 'node:zlib'

const STRONG_HEADERS = new Set(['标题', '任务标题', 'title', 'task title'])
const WEAK_HEADERS = new Set(['任务', 'task'])
const HEADER_HINTS = new Set([
  'id',
  '标题',
  '状态',
  '优先级',
  '紧急度',
  '标签',
  '持有',
  '备注',
  '父id',
  '阶段',
  '里程碑',
  '完成日',
  '归档日',
  '版本',
  '证据',
])

function isHeaderRow(cells) {
  const normalized = cells.map((cell) => String(cell == null ? '' : cell).trim().toLowerCase())
  if (normalized.some((cell) => STRONG_HEADERS.has(cell))) return true
  if (normalized.some((cell) => WEAK_HEADERS.has(cell))) {
    return normalized.filter((cell) => HEADER_HINTS.has(cell)).length >= 2
  }
  return false
}

/* ---------------------------------------------------------------- xml utils */

export function decodeXml(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function attributes(text) {
  const result = {}
  const re = /([\w:]+)\s*=\s*"([^"]*)"/g
  let match
  while ((match = re.exec(text))) result[match[1]] = decodeXml(match[2])
  return result
}

function textOf(xml) {
  const parts = []
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
  let match
  while ((match = re.exec(xml))) parts.push(decodeXml(match[1]))
  return parts.join('')
}

/* ---------------------------------------------------------------- zip read */

/** Minimal ZIP reader: central directory + local headers, deflate only. */
export function unzip(buffer) {
  let eocd = -1
  const floor = Math.max(0, buffer.length - 66_000)
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 XLSX（缺少 ZIP 目录）')
  const count = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  const files = new Map()
  let cursor = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return files
}

/* ------------------------------------------------------------------- dates */

function excelSerialToIso(serial) {
  const days = serial < 60 ? serial + 1 : serial
  const date = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function isDateFormat(code) {
  if (!code) return false
  const cleaned = String(code)
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
  return /[ymdhs]/i.test(cleaned) && !/general/i.test(cleaned)
}

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
])

/* --------------------------------------------------------------- worksheets */

function columnIndex(ref) {
  const letters = /^([A-Z]+)/i.exec(String(ref || ''))
  if (!letters) return 0
  let index = 0
  for (const char of letters[1].toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

function sharedStringsOf(files) {
  const entry = files.get('xl/sharedStrings.xml')
  if (!entry) return []
  const xml = entry.toString('utf8')
  const strings = []
  const re = /<si>([\s\S]*?)<\/si>/g
  let match
  while ((match = re.exec(xml))) strings.push(textOf(match[1]))
  return strings
}

function stylesOf(files) {
  const entry = files.get('xl/styles.xml')
  if (!entry) return { dateXfs: new Set() }
  const xml = entry.toString('utf8')
  const custom = new Map()
  const numFmtRe = /<numFmt\b([^>]*)\/>/g
  let match
  while ((match = numFmtRe.exec(xml))) {
    const attrs = attributes(match[1])
    custom.set(Number(attrs.numFmtId), attrs.formatCode || '')
  }
  const dateXfs = new Set()
  const xfBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)
  if (xfBlock) {
    const xfRe = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g
    let index = 0
    while ((match = xfRe.exec(xfBlock[1]))) {
      const attrs = attributes(match[1])
      const numFmtId = Number(attrs.numFmtId || 0)
      const customCode = custom.get(numFmtId)
      if (BUILTIN_DATE_FORMATS.has(numFmtId) || (customCode && isDateFormat(customCode))) dateXfs.add(index)
      index += 1
    }
  }
  return { dateXfs }
}

function sheetTargets(files) {
  const workbook = files.get('xl/workbook.xml')
  if (!workbook) throw new Error('不是有效的 XLSX（缺少 workbook.xml）')
  const rels = files.get('xl/_rels/workbook.xml.rels')
  const targets = new Map()
  if (rels) {
    const re = /<Relationship\b([^>]*)\/>/g
    let match
    while ((match = re.exec(rels.toString('utf8')))) {
      const attrs = attributes(match[1])
      if (!attrs.Id || !attrs.Target) continue
      let target = attrs.Target
      if (target.startsWith('/')) target = target.slice(1)
      else if (!target.startsWith('xl/')) target = `xl/${target}`
      target = target.replace(/^xl\/\.\.\//, '')
      targets.set(attrs.Id, target)
    }
  }
  const sheets = []
  const re = /<sheet\b([^>]*)\/>/g
  let match
  while ((match = re.exec(workbook.toString('utf8')))) {
    const attrs = attributes(match[1])
    const relId = attrs['r:id'] || attrs.id
    const target = targets.get(relId) || `xl/worksheets/sheet${sheets.length + 1}.xml`
    sheets.push({ name: attrs.name || `Sheet${sheets.length + 1}`, target })
  }
  return sheets
}

function parseSheetRows(xml, shared, dateXfs) {
  const rows = []
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
  let rowMatch
  while ((rowMatch = rowRe.exec(xml))) {
    const rowAttrs = attributes(rowMatch[1])
    const rowIndex = Number(rowAttrs.r || rows.length + 1) - 1
    const cells = []
    const body = rowMatch[2] || ''
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cellMatch
    while ((cellMatch = cellRe.exec(body))) {
      const attrs = attributes(cellMatch[1])
      const bodyXml = cellMatch[2] || ''
      const type = attrs.t || ''
      const styleIndex = Number(attrs.s || 0)
      const column = columnIndex(attrs.r)
      const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(bodyXml)
      const rawValue = valueMatch ? decodeXml(valueMatch[1]) : ''
      let value = ''
      if (type === 's') {
        value = shared[Number(rawValue)] || ''
      } else if (type === 'inlineStr') {
        value = textOf(bodyXml)
      } else if (type === 'str') {
        value = rawValue
      } else if (type === 'b') {
        value = rawValue === '1' ? 'true' : 'false'
      } else if (type === 'e') {
        value = ''
      } else if (rawValue !== '') {
        const number = Number(rawValue)
        value = Number.isFinite(number) && dateXfs.has(styleIndex) && number > 0 ? excelSerialToIso(number) : rawValue
      }
      cells[column] = value
    }
    rows[rowIndex] = cells
  }
  return rows
}

function headerIndex(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const cells = rows[index] || []
    if (isHeaderRow(cells)) return index
  }
  return -1
}

/**
 * Read a workbook buffer into header-keyed rows.
 *
 * @returns {object[]} one object per non-empty data row.
 */
export function readXlsxRows(buffer) {
  const files = unzip(buffer)
  const shared = sharedStringsOf(files)
  const { dateXfs } = stylesOf(files)
  const sheets = sheetTargets(files)
  for (const sheet of sheets) {
    const entry = files.get(sheet.target)
    if (!entry) continue
    const rows = parseSheetRows(entry.toString('utf8'), shared, dateXfs)
    const headerRow = headerIndex(rows)
    if (headerRow < 0) continue
    const headers = (rows[headerRow] || []).map((cell) => String(cell == null ? '' : cell).trim())
    const result = []
    for (let index = headerRow + 1; index < rows.length; index += 1) {
      const cells = rows[index]
      if (!cells || !cells.some((cell) => String(cell == null ? '' : cell).trim())) continue
      const record = {}
      headers.forEach((header, column) => {
        if (!header) return
        record[header] = cells[column] === undefined || cells[column] === null ? '' : String(cells[column])
      })
      result.push(record)
    }
    return result
  }
  throw Object.assign(new Error('没有找到表头（需要包含「标题」或「任务」列）'), { code: 'PARSE_ERROR' })
}
