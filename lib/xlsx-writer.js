/**
 * Pure-JavaScript XLSX writer.
 *
 * The previous implementation shelled out to `tools/xlsx_helper.py` (Python +
 * openpyxl). That made the export depend on a file resolved from the module's
 * own location, so moving the plugin directory (or running an environment
 * without Python/openpyxl) killed the feature while every other panel action
 * kept working. This writer produces the workbook with `node:zlib` only:
 *
 *   - a ZIP container with deflated OOXML parts,
 *   - a real style sheet (fonts/fills/borders/alignments/number formats),
 *   - dashboard + detail sheets,
 *   - native bar / stacked-bar / doughnut charts with cached values,
 *   - print setup (margins, landscape, fit-to-width, repeated header, footer).
 *
 * Values are written as inline strings, never formulas, so text that starts
 * with `=` stays text (no formula injection) and illegal XML control characters
 * are stripped before they can corrupt the package.
 */
import { deflateRawSync } from 'node:zlib'
import { THEME_XML } from './xlsx-theme.js'

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const NS_DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
const NS_CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const FONT = 'Microsoft YaHei'

/* ------------------------------------------------------------------ escaping */

/** XML-escape one value and drop characters XML 1.0 cannot represent. */
export function xmlText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function attr(value) {
  return xmlText(value)
}

/* ----------------------------------------------------------------------- zip */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** Build a ZIP archive (deflate) from `{ name, data }` entries. */
export function zip(entries, now = new Date()) {
  const stamp = dosDateTime(now)
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    const deflated = deflateRawSync(raw, { level: 9 })
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 file name
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, deflated)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + deflated.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, ...centrals, end])
}

/* -------------------------------------------------------------------- styles */

function solidFill(argb) {
  return `<fill><patternFill patternType="solid"><fgColor rgb="${argb}"/><bgColor indexed="64"/></patternFill></fill>`
}

/**
 * Deduplicating style book. Every cell style is a combination of font, fill,
 * border, alignment and number format; `xf()` returns the index into cellXfs.
 */
export class StyleBook {
  constructor() {
    this.fonts = []
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>']
    this.xfs = []
    this.numFmts = []
    this.fontKeys = new Map()
    this.fillKeys = new Map()
    this.borderKeys = new Map()
    this.xfKeys = new Map()
    this.font({ size: 11, color: 'FF333333' })
    this.xf({})
  }

  font(spec = {}) {
    const key = JSON.stringify(spec)
    if (this.fontKeys.has(key)) return this.fontKeys.get(key)
    const parts = [`<sz val="${spec.size || 11}"/>`]
    if (spec.bold) parts.push('<b/>')
    if (spec.italic) parts.push('<i/>')
    if (spec.strike) parts.push('<strike/>')
    parts.push(`<color rgb="${spec.color || 'FF333333'}"/>`)
    parts.push(`<name val="${attr(spec.name || FONT)}"/>`)
    parts.push('<family val="2"/><charset val="134"/>')
    const index = this.fonts.length
    this.fonts.push(`<font>${parts.join('')}</font>`)
    this.fontKeys.set(key, index)
    return index
  }

  fill(argb) {
    if (!argb) return 0
    const key = String(argb)
    if (this.fillKeys.has(key)) return this.fillKeys.get(key)
    const index = this.fills.length
    this.fills.push(solidFill(key))
    this.fillKeys.set(key, index)
    return index
  }

  /** spec = { color, style: 'thin'|'medium', sides: ['left','right','top','bottom'] } */
  border(spec = {}) {
    if (!spec.color && !spec.style) return 0
    const key = JSON.stringify(spec)
    if (this.borderKeys.has(key)) return this.borderKeys.get(key)
    const style = spec.style || 'thin'
    const sides = spec.sides || ['left', 'right', 'top', 'bottom']
    const color = spec.color || 'FFD0D7E2'
    const build = (side) =>
      sides.includes(side) ? `<${side} style="${style}"><color rgb="${color}"/></${side}>` : `<${side}/>`
    const index = this.borders.length
    this.borders.push(`<border>${build('left')}${build('right')}${build('top')}${build('bottom')}<diagonal/></border>`)
    this.borderKeys.set(key, index)
    return index
  }

  numFmt(code) {
    if (!code) return 0
    const id = 164 + this.numFmts.length
    this.numFmts.push(`<numFmt numFmtId="${id}" formatCode="${attr(code)}"/>`)
    return id
  }

  /** spec = { font, fill, border, align: {horizontal, vertical, wrap, indent}, numFmt } */
  xf(spec = {}) {
    const key = JSON.stringify(spec)
    if (this.xfKeys.has(key)) return this.xfKeys.get(key)
    const fontId = spec.font || 0
    const fillId = spec.fill || 0
    const borderId = spec.border || 0
    const numFmtId = spec.numFmt || 0
    const align = spec.align || {}
    let alignment = ''
    if (align.horizontal || align.vertical || align.wrap || align.indent || align.shrink) {
      const attrs = []
      if (align.horizontal) attrs.push(`horizontal="${align.horizontal}"`)
      if (align.vertical) attrs.push(`vertical="${align.vertical}"`)
      if (align.wrap) attrs.push('wrapText="1"')
      if (align.indent) attrs.push(`indent="${align.indent}"`)
      if (align.shrink) attrs.push('shrinkToFit="1"')
      alignment = `<alignment ${attrs.join(' ')}/>`
    }
    const apply = []
    if (fontId) apply.push('applyFont="1"')
    if (fillId) apply.push('applyFill="1"')
    if (borderId) apply.push('applyBorder="1"')
    if (numFmtId) apply.push('applyNumberFormat="1"')
    if (alignment) apply.push('applyAlignment="1"')
    const index = this.xfs.length
    this.xfs.push(
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${
        apply.length ? ` ${apply.join(' ')}` : ''
      }>${alignment}</xf>`,
    )
    this.xfKeys.set(key, index)
    return index
  }

  toXml() {
    return `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">${
      this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.join('')}</numFmts>` : ''
    }<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join(
      '',
    )}</fills><borders count="${this.borders.length}">${this.borders.join(
      '',
    )}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${
      this.xfs.length
    }">${this.xfs.join(
      '',
    )}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`
  }
}

/* --------------------------------------------------------------------- sheet */

function columnName(index) {
  let name = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

export class Sheet {
  constructor(options = {}) {
    this.name = options.name || 'Sheet1'
    this.cols = options.cols || []
    this.cells = new Map()
    this.heights = new Map()
    this.merges = options.merges || []
    this.freeze = options.freeze || null
    this.autoFilter = options.autoFilter || null
    this.print = options.print || null
    this.printTitleRows = options.printTitleRows === true
    this.rowBreaks = options.rowBreaks || []
    this.charts = options.charts || []
    this.tabSelected = options.tabSelected === true
    this.defaultRowHeight = options.defaultRowHeight || 18
    this.maxRow = 0
    this.maxCol = 0
  }

  /** value: string/number/null; opts: { number, style } */
  set(row, col, value, style = 0, opts = {}) {
    const empty = value === null || value === undefined || value === ''
    if (empty && !style) return this
    let entry = this.cells.get(row)
    if (!entry) {
      entry = new Map()
      this.cells.set(row, entry)
    }
    entry.set(col, {
      value: empty ? '' : value,
      style,
      empty,
      number: !empty && (opts.number === true || typeof value === 'number'),
    })
    this.maxRow = Math.max(this.maxRow, row + 1)
    this.maxCol = Math.max(this.maxCol, col + 1)
    return this
  }

  merge(range) {
    this.merges.push(range)
    return this
  }

  height(row, height) {
    this.heights.set(row, height)
    return this
  }

  render() {
    const maxRow = Math.max(this.maxRow, 1)
    const maxCol = Math.max(this.maxCol, 1)
    const dimension = `A1:${columnName(maxCol - 1)}${maxRow}`
    const rows = [...this.cells.keys()].sort((a, b) => a - b).map((row) => {
      const cells = [...this.cells.get(row).entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([col, cell]) => {
          const ref = `${columnName(col)}${row + 1}`
          const style = cell.style ? ` s="${cell.style}"` : ''
          if (cell.empty) return `<c r="${ref}"${style}/>`
          if (cell.number) return `<c r="${ref}"${style}><v>${Number(cell.value)}</v></c>`
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlText(cell.value)}</t></is></c>`
        })
        .join('')
      const height = this.heights.get(row)
      const heightAttr = height ? ` ht="${height}" customHeight="1"` : ''
      return `<row r="${row + 1}"${heightAttr}>${cells}</row>`
    })

    const cols = this.cols.length
      ? `<cols>${this.cols
          .map((col, index) => {
            const spec = typeof col === 'number' ? { width: col } : col
            return `<col min="${index + 1}" max="${index + 1}" width="${spec.width}" customWidth="1"${
              spec.hidden ? ' hidden="1"' : ''
            }/>`
          })
          .join('')}</cols>`
      : ''

    const views = `<sheetViews><sheetView${this.tabSelected ? ' tabSelected="1"' : ''} workbookViewId="0">${
      this.freeze
        ? `<pane ySplit="${this.freeze.ySplit || 0}" xSplit="${this.freeze.xSplit || 0}" topLeftCell="${
            this.freeze.topLeftCell
          }" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${
            this.freeze.topLeftCell
          }" sqref="${this.freeze.topLeftCell}"/>`
        : '<selection activeCell="A1" sqref="A1"/>'
    }</sheetView></sheetViews>`

    const autoFilter = this.autoFilter ? `<autoFilter ref="${this.autoFilter}"/>` : ''
    const merges = this.merges.length
      ? `<mergeCells count="${this.merges.length}">${this.merges
          .map((range) => `<mergeCell ref="${range}"/>`)
          .join('')}</mergeCells>`
      : ''
    const printOptions = this.print ? '<printOptions horizontalCentered="1"/>' : ''
    const pageMargins = this.print
      ? '<pageMargins left="0.3" right="0.3" top="0.55" bottom="0.55" header="0.2" footer="0.2"/>'
      : ''
    const pageSetup = this.print
      ? `<pageSetup paperSize="9" orientation="${this.print.orientation || 'landscape'}" fitToWidth="${
          this.print.fitToWidth || 1
        }" fitToHeight="${this.print.fitToHeight == null ? 0 : this.print.fitToHeight}"/>`
      : ''
    const footer = this.print
      ? '<headerFooter><oddFooter>&amp;C第 &amp;P 页 / 共 &amp;N 页</oddFooter></headerFooter>'
      : ''
    const rowBreaks = this.rowBreaks.length
      ? `<rowBreaks count="${this.rowBreaks.length}" manualBreakCount="${this.rowBreaks.length}">${this.rowBreaks
          .map((id) => `<brk id="${id}" max="16383" man="1"/>`)
          .join('')}</rowBreaks>`
      : ''
    const drawing = this.charts.length ? '<drawing r:id="rId1"/>' : ''
    const sheetPr = this.print ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ''

    return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">${sheetPr}<dimension ref="${dimension}"/>${views}<sheetFormatPr defaultRowHeight="${
      this.defaultRowHeight
    }"/>${cols}<sheetData>${rows.join('')}</sheetData>${autoFilter}${merges}${printOptions}${pageMargins}${pageSetup}${footer}${rowBreaks}${drawing}</worksheet>`
  }
}

/* -------------------------------------------------------------------- charts */

function chartTitle(text) {
  if (!text) return ''
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:latin typeface="${FONT}"/></a:defRPr></a:pPr><a:r><a:rPr lang="zh-CN" sz="1200" b="1"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:latin typeface="${FONT}"/></a:rPr><a:t>${xmlText(
    text,
  )}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
}

function strCache(values) {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values
    .map((value, index) => `<c:pt idx="${index}"><c:v>${xmlText(value)}</c:v></c:pt>`)
    .join('')}</c:strCache>`
}

function numCache(values) {
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values
    .map((value, index) => `<c:pt idx="${index}"><c:v>${Number(value) || 0}</c:v></c:pt>`)
    .join('')}</c:numCache>`
}

function catRef(ref, values) {
  return `<c:cat><c:strRef><c:f>${xmlText(ref)}</c:f>${strCache(values)}</c:strRef></c:cat>`
}

function valRef(ref, values) {
  return `<c:val><c:numRef><c:f>${xmlText(ref)}</c:f>${numCache(values)}</c:numRef></c:val>`
}

function barSer({ index, name, color, points, catRefText, cats, valRefText, vals, labels }) {
  const dPts = (points || [])
    .map(
      (pointColor, pointIndex) =>
        `<c:dPt><c:idx val="${pointIndex}"/><c:invertIfNegative val="0"/><c:spPr><a:solidFill><a:srgbClr val="${pointColor}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`,
    )
    .join('')
  const labelsXml = labels
    ? '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>'
    : ''
  return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:strRef><c:f>${xmlText(
    name.ref,
  )}</c:f>${strCache([name.value])}</c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>${dPts}${labelsXml}${catRef(
    catRefText,
    cats,
  )}${valRef(valRefText, vals)}</c:ser>`
}

function catAxis(id, crossId) {
  return `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D0D7E2"/></a:solidFill></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="5F6B7A"/></a:solidFill><a:latin typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr><c:crossAx val="${crossId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
}

function valAxis(id, crossId, max) {
  const major = max > 0 ? `<c:majorUnit val="${Math.max(1, Math.ceil(max / 5))}"/>` : ''
  return `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="EDF1F7"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="0" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="5F6B7A"/></a:solidFill><a:latin typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr><c:crossAx val="${crossId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>${major}</c:valAx>`
}

function legend(position) {
  return `<c:legend><c:legendPos val="${position || 'b'}"/><c:overlay val="0"/></c:legend>`
}

/**
 * Native chart part.
 *
 * kind: 'column' | 'bar' | 'stacked' | 'doughnut'
 */
export function chartXml(kind, spec) {
  const idA = spec.axisA || 200000001
  const idB = spec.axisB || 200000002
  const title = chartTitle(spec.title)
  let plot
  let legendXml = ''
  if (kind === 'doughnut') {
    const labels = spec.values
    const dPts = spec.colors
      .map(
        (color, index) =>
          `<c:dPt><c:idx val="${index}"/><c:invertIfNegative val="0"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`,
      )
      .join('')
    plot = `<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>${xmlText(
      spec.seriesRef,
    )}</c:f>${strCache([spec.seriesName])}</c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="1565C0"/></a:solidFill></c:spPr>${dPts}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:separator> </c:separator></c:dLbls>${catRef(
      spec.catRef,
      spec.categories,
    )}${valRef(spec.valRef, labels)}</c:ser><c:firstSliceAng val="0"/><c:holeSize val="58"/></c:doughnutChart>`
    legendXml = legend('r')
  } else {
    const stacked = kind === 'stacked'
    const series = spec.series
      .map((serie, index) =>
        barSer({
          index,
          name: { ref: serie.nameRef, value: serie.name },
          color: serie.color,
          points: serie.points,
          catRefText: serie.catRef || spec.catRef,
          cats: spec.categories,
          valRefText: serie.valRef,
          vals: serie.values,
          labels: serie.labels,
        }),
      )
      .join('')
    const max = Math.max(...spec.series.flatMap((serie) => serie.values), 0)
    plot = `<c:barChart><c:barDir val="${kind === 'bar' ? 'bar' : 'col'}"/><c:grouping val="${
      stacked ? 'stacked' : 'clustered'
    }"/><c:varyColors val="0"/>${series}<c:gapWidth val="55"/>${
      stacked ? '<c:overlap val="100"/>' : ''
    }<c:axId val="${idA}"/><c:axId val="${idB}"/></c:barChart>${catAxis(idA, idB)}${valAxis(idB, idA, max)}`
    legendXml = spec.legend === false ? '' : legend('b')
  }
  return `${XML_HEAD}<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_A}" xmlns:r="${NS_REL}"><c:date1904 val="0"/><c:lang val="zh-CN"/><c:roundedCorners val="0"/><c:chart>${title}<c:autoTitleDeleted val="${
    title ? '0' : '1'
  }"/><c:plotArea><c:layout/>${plot}</c:plotArea>${legendXml}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`
}

function drawingXml(charts) {
  const anchors = charts.map((chart, index) => {
    const from = chart.from
    const to = chart.to
    return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${to.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${
      index + 2
    }" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_CHART}"><c:chart xmlns:c="${NS_CHART}" xmlns:r="${NS_REL}" r:id="rId${
      index + 1
    }"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
  })
  return `${XML_HEAD}<xdr:wsDr xmlns:xdr="${NS_DRAWING}" xmlns:a="${NS_A}" xmlns:r="${NS_REL}">${anchors.join('')}</xdr:wsDr>`
}

/* --------------------------------------------------------------- attributes */

export const PALETTE = {
  title: 'FF1F3864',
  section: 'FF2F5597',
  subtitle: 'FFD9E2F3',
  headerText: 'FFFFFFFF',
  text: 'FF333333',
  muted: 'FF7A869A',
  line: 'FFD0D7E2',
  rowAlt: 'FFF7F9FC',
  status: {
    done: { fill: 'FFE8F5E9', font: 'FF1B5E20', chart: 'FF2E7D32' },
    doing: { fill: 'FFE3F2FD', font: 'FF0D47A1', chart: 'FF1565C0' },
    open: { fill: 'FFF1F3F4', font: 'FF455A64', chart: 'FF78909C' },
    blocked: { fill: 'FFFDECEA', font: 'FFB71C1C', chart: 'FFC62828' },
    cancelled: { fill: 'FFF3E5F5', font: 'FF6A1B9A', chart: 'FF8E24AA' },
  },
  priority: {
    P0: 'FFB71C1C',
    P1: 'FFE65100',
    P2: 'FF1565C0',
    P3: 'FF607D8B',
    P4: 'FF00897B',
    P5: 'FF9E9E9E',
  },
  urgency: { 5: 'FFC62828', 4: 'FFE65100', 3: 'FF5F6B7A', 2: 'FF7A869A', 1: 'FF9AA5B1' },
  kpi: {
    total: { fill: 'FFDCE9F5', font: 'FF0F4C81' },
    done: { fill: 'FFE8F5E9', font: 'FF2E7D32' },
    doing: { fill: 'FFE3F2FD', font: 'FF1565C0' },
    open: { fill: 'FFF1F3F4', font: 'FF5F6368' },
    blocked: { fill: 'FFFDECEA', font: 'FFC62828' },
    cancelled: { fill: 'FFF3E5F5', font: 'FF6A1B9A' },
    rate: { fill: 'FFE0F7FA', font: 'FF00838F' },
  },
}

export const CONTENT_TYPES = (sheetCount, chartCount, hasDrawing) => {
  const overrides = []
  for (let i = 1; i <= sheetCount; i += 1) {
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
  }
  if (hasDrawing) {
    overrides.push('<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>')
  }
  for (let i = 1; i <= chartCount; i += 1) {
    overrides.push(
      `<Override PartName="/xl/charts/chart${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
    )
  }
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides.join(
    '',
  )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
}

export function packageXml({ sheets, styles, charts, drawing, generatedAt, title }) {
  const stamp = generatedAt.toISOString()
  const entries = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES(sheets.length, charts.length, Boolean(drawing)) },
    {
      name: '_rels/.rels',
      data: `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${NS_REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      name: 'docProps/core.xml',
      data: `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(
        title,
      )}</dc:title><dc:creator>ptodo</dc:creator><cp:lastModifiedBy>ptodo</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`,
    },
    {
      name: 'docProps/app.xml',
      data: `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ptodo</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27525"/><workbookPr defaultThemeVersion="166925"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15600" activeTab="0"/></bookViews><sheets>${sheets
        .map(
          (sheet, index) =>
            `<sheet name="${attr(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
        )
        .join('')}</sheets>${
        sheets.some((sheet) => sheet.printTitleRows)
          ? `<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="${sheets.findIndex(
              (sheet) => sheet.printTitleRows,
            )}">'${attr(sheets.find((sheet) => sheet.printTitleRows).name)}'!$1:$1</definedName></definedNames>`
          : ''
      }<calcPr calcId="191029"/></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${sheets
        .map(
          (sheet, index) =>
            `<Relationship Id="rId${index + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
        )
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/><Relationship Id="rId${
          sheets.length + 2
        }" Type="${NS_REL}/theme" Target="theme/theme1.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: styles.toXml() },
    { name: 'xl/theme/theme1.xml', data: THEME_XML },
  ]

  sheets.forEach((sheet, index) => entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheet.render() }))
  if (drawing) {
    entries.push({ name: 'xl/drawings/drawing1.xml', data: drawingXml(drawing.anchors) })
    entries.push({
      name: 'xl/drawings/_rels/drawing1.xml.rels',
      data: `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${drawing.anchors
        .map(
          (anchor, index) =>
            `<Relationship Id="rId${index + 1}" Type="${NS_REL}/chart" Target="../charts/chart${index + 1}.xml"/>`,
        )
        .join('')}</Relationships>`,
    })
    const sheetIndex = drawing.sheetIndex
    entries.push({
      name: `xl/worksheets/_rels/sheet${sheetIndex + 1}.xml.rels`,
      data: `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    })
  }
  charts.forEach((chart, index) => entries.push({ name: `xl/charts/chart${index + 1}.xml`, data: chart }))
  return zip(entries, generatedAt)
}

/* ------------------------------------------------------------- row helpers */

export function visualLines(text, widthUnits) {
  const value = String(text == null ? '' : text)
  if (!value) return 1
  const units = [...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0)
  return Math.max(1, Math.ceil(units / Math.max(1, widthUnits)))
}

export function rowHeightFor(texts, widths, options = {}) {
  let lines = 1
  texts.forEach((text, index) => {
    lines = Math.max(lines, visualLines(text, (widths[index] || 20) * 1.05))
  })
  return Math.min(options.max || 96, Math.max(options.min || 20, lines * 14 + 6))
}
