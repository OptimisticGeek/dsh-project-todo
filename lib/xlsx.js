/**
 * XLSX facade: turns a board snapshot into a styled workbook.
 *
 * Layout:
 *   - `总览`    KPI cards, status / priority / milestone / tag tables and four
 *               native charts (column, doughnut, stacked column, bar).
 *   - `任务明细` one row per task, colour-coded by status/priority/urgency,
 *               frozen header, auto-filter and a print-ready page setup.
 *
 * Everything is generated in-process with `node:zlib`; the export no longer
 * depends on a Python helper file next to the plugin (which broke whenever the
 * plugin directory was moved) or on openpyxl being installed.
 */
import { readFile } from 'node:fs/promises'
import {
  PALETTE,
  Sheet,
  StyleBook,
  chartXml,
  packageXml,
  rowHeightFor,
} from './xlsx-writer.js'
import { readXlsxRows } from './xlsx-reader.js'

const STATUS_KEY_BY_LABEL = { 已完成: 'done', 进行中: 'doing', 未开始: 'open', 阻塞: 'blocked', 已取消: 'cancelled' }
const URGENCY_LEVEL = { 非常紧急: 5, 紧急: 4, 普通: 3, 不紧急: 2, 可延后: 1 }
const SCOPE_LABEL = { active: '当前看板', archive: '归档', all: '当前看板 + 归档' }
const DEFAULT_DETAIL_WIDTHS = [11, 50, 10, 8, 8, 16, 14, 38, 10, 24, 26, 17, 17, 12, 55]
const DASHBOARD_WIDTHS = [26, 12, 12, 12, 12, 12, 12, 12, 12, { width: 8, hidden: true }]

function pad(value) {
  return String(value).padStart(2, '0')
}

export function formatDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

/** "2026-11-04T12:36:18.060Z" -> "2026-11-04 12:36" (kept as text for round-trip). */
function cellDate(value) {
  const text = String(value || '')
  if (!text) return ''
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return formatDateTime(date)
}

/* ------------------------------------------------------------------ styles */

function styleKit(book) {
  const font = (spec) => book.font(spec)
  const fill = (argb) => book.fill(argb)
  const border = (spec) => book.border(spec)
  const rowLine = border({ color: 'FFE3E8EF', sides: ['bottom'] })
  const grid = border({ color: PALETTE.line })
  const cardLine = border({ color: 'FFFFFFFF' })
  const body = font({ size: 10, color: PALETTE.text })
  const small = font({ size: 9, color: 'FF5F6B7A' })
  const muted = font({ size: 9, color: PALETTE.muted })
  const cell = (fontId, options = {}) =>
    book.xf({
      font: fontId,
      fill: options.alt ? fill(PALETTE.rowAlt) : 0,
      border: rowLine,
      numFmt: options.numFmt || 0,
      align: { vertical: 'center', horizontal: options.horizontal || 'left', wrap: options.wrap === true },
    })
  return {
    book,
    fill,
    border,
    body,
    small,
    muted,
    cell,
    grid,
    cardLine,
    header: book.xf({
      font: font({ size: 10, bold: true, color: PALETTE.headerText }),
      fill: fill(PALETTE.title),
      border: grid,
      align: { horizontal: 'center', vertical: 'center', wrap: true },
    }),
    titleBand: book.xf({
      font: font({ size: 20, bold: true, color: 'FFFFFFFF' }),
      fill: fill(PALETTE.title),
      align: { horizontal: 'left', vertical: 'center', indent: 1 },
    }),
    subtitle: book.xf({
      font: font({ size: 10, color: 'FF44546A' }),
      fill: fill(PALETTE.subtitle),
      align: { horizontal: 'left', vertical: 'center', indent: 1 },
    }),
    section: book.xf({
      font: font({ size: 12, bold: true, color: 'FFFFFFFF' }),
      fill: fill(PALETTE.section),
      align: { horizontal: 'left', vertical: 'center', indent: 1 },
    }),
    kpiLabel: (cardFill) =>
      book.xf({
        font: font({ size: 10, bold: true, color: 'FF44546A' }),
        fill: fill(cardFill),
        border: cardLine,
        align: { horizontal: 'center', vertical: 'center' },
      }),
    kpiValue: (cardFill, color) =>
      book.xf({
        font: font({ size: 22, bold: true, color }),
        fill: fill(cardFill),
        border: cardLine,
        align: { horizontal: 'center', vertical: 'center' },
      }),
    kpiRate: (cardFill, color) =>
      book.xf({
        font: font({ size: 20, bold: true, color }),
        fill: fill(cardFill),
        border: cardLine,
        numFmt: book.numFmt('0.0%'),
        align: { horizontal: 'center', vertical: 'center' },
      }),
    footer: book.xf({
      font: font({ size: 8, color: 'FF9AA5B1' }),
      align: { horizontal: 'left', vertical: 'center' },
    }),
  }
}

/* ----------------------------------------------------------------- details */

function detailColumnWidths(headers) {
  if (headers.length === DEFAULT_DETAIL_WIDTHS.length && headers[0] === 'ID') return DEFAULT_DETAIL_WIDTHS
  return headers.map((header) => Math.max(12, Math.min(42, String(header).length * 2 + 8)))
}

function statusStyle(kit, key, alt) {
  const palette = PALETTE.status[key] || PALETTE.status.open
  return kit.book.xf({
    font: kit.book.font({ size: 10, bold: true, color: palette.font }),
    fill: kit.fill(palette.fill),
    border: kit.border({ color: 'FFE3E8EF', sides: ['bottom'] }),
    align: { horizontal: 'center', vertical: 'center', wrap: true },
  })
}

function priorityStyle(kit, priority, alt) {
  return kit.cell(kit.book.font({ size: 10, bold: true, color: PALETTE.priority[priority] || PALETTE.text }), {
    alt,
    horizontal: 'center',
  })
}

function urgencyStyle(kit, level, alt) {
  return kit.cell(kit.book.font({ size: 9, color: PALETTE.urgency[level] || PALETTE.muted }), {
    alt,
    horizontal: 'center',
  })
}

function buildDetailsSheet({ kit, headers, rows, name, tabSelected = false, print = true }) {
  const widths = detailColumnWidths(headers)
  const sheet = new Sheet({
    name,
    cols: widths,
    freeze: { ySplit: 1, topLeftCell: 'A2' },
    autoFilter: `A1:${columnLetter(headers.length)}${rows.length + 1}`,
    print: print ? { orientation: 'landscape', fitToWidth: 1 } : null,
    printTitleRows: print,
    defaultRowHeight: 20,
    tabSelected,
  })
  sheet.height(0, 32)
  headers.forEach((header, index) => sheet.set(0, index, header, kit.header))
  rows.forEach((row, rowIndex) => {
    const alt = rowIndex % 2 === 1
    const statusKey = STATUS_KEY_BY_LABEL[row['状态']] || (Object.keys(PALETTE.status).includes(row['状态']) ? row['状态'] : 'open')
    const titleFont =
      statusKey === 'done'
        ? kit.book.font({ size: 10, color: 'FF9AA5B1', strike: true })
        : statusKey === 'cancelled'
          ? kit.book.font({ size: 10, color: 'FF9AA5B1', italic: true })
          : kit.body
    const cells = [
      kit.cell(kit.book.font({ size: 10, bold: true, color: 'FF44546A' }), { alt, horizontal: 'center', wrap: true }),
      kit.cell(titleFont, { alt, wrap: true }),
      statusStyle(kit, statusKey, alt),
      priorityStyle(kit, row['优先级'], alt),
      urgencyStyle(kit, URGENCY_LEVEL[row['紧急度']] || 3, alt),
      kit.cell(kit.book.font({ size: 9, color: 'FF1565C0' }), { alt, wrap: true }),
      kit.cell(kit.body, { alt, wrap: true }),
      kit.cell(kit.small, { alt, wrap: true }),
      kit.cell(kit.muted, { alt, horizontal: 'center' }),
      kit.cell(kit.small, { alt }),
      kit.cell(kit.small, { alt }),
      kit.cell(kit.muted, { alt, horizontal: 'center' }),
      kit.cell(kit.muted, { alt, horizontal: 'center' }),
      kit.cell(kit.body, { alt, horizontal: 'center' }),
      kit.cell(kit.small, { alt, wrap: true }),
    ]
    headers.forEach((header, column) => {
      let value = row[header]
      if (header === '完成日' || header === '归档日') value = cellDate(value)
      sheet.set(rowIndex + 1, column, value, cells[column] || cells[1])
    })
    const height = rowHeightFor(
      [row['标题'], row['备注'], row['证据']],
      [widths[1] || 50, widths[7] || 38, widths[14] || 55],
      { min: 20, max: 96 },
    )
    sheet.height(rowIndex + 1, height)
  })
  return sheet
}

function columnLetter(count) {
  let name = ''
  let n = count
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/* --------------------------------------------------------------- dashboard */

function buildDashboard(report, charts, kit) {
  const book = kit.book
  const sheet = new Sheet({
    name: '总览',
    cols: DASHBOARD_WIDTHS,
    print: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 2 },
    rowBreaks: [28],
    defaultRowHeight: 20,
    tabSelected: true,
    charts: charts.length ? new Array(charts.length).fill(null) : [],
  })

  const scopeLabel = SCOPE_LABEL[report.scope] || SCOPE_LABEL.active
  sheet.merge('A1:I1')
  sheet.set(0, 0, `待办看板 · ${report.project}`, kit.titleBand)
  sheet.height(0, 38)

  sheet.merge('A2:I2')
  sheet.set(
    1,
    0,
    `${scopeLabel} · revision ${report.revision == null ? '-' : report.revision} · 导出时间 ${formatDateTime(
      report.generatedAt,
    )} · 共 ${report.total} 条`,
    kit.subtitle,
  )
  sheet.height(1, 24)

  const cards = [
    { key: 'total', label: '任务总数', value: report.total, rate: false },
    { key: 'done', label: '已完成', value: report.done, rate: false },
    { key: 'doing', label: '进行中', value: report.doing, rate: false },
    { key: 'open', label: '未开始', value: report.open, rate: false },
    { key: 'blocked', label: '阻塞', value: report.blocked, rate: false },
    { key: 'cancelled', label: '已取消', value: report.cancelled, rate: false },
    { key: 'rate', label: '完成率', value: report.rate, rate: true },
  ]
  cards.forEach((card, index) => {
    const palette = PALETTE.kpi[card.key]
    sheet.set(3, index, card.label, kit.kpiLabel(palette.fill))
    sheet.set(4, index, card.value, card.rate ? kit.kpiRate(palette.fill, palette.font) : kit.kpiValue(palette.fill, palette.font), {
      number: true,
    })
  })
  sheet.height(3, 20)
  sheet.height(4, 38)

  // Status table (chart 1 lives to its right, rows 6..16).
  sheet.merge('A7:C7')
  sheet.set(6, 0, '任务状态分布', kit.section)
  sheet.height(6, 24)
  ;['状态', '任务数', '占比'].forEach((label, index) => sheet.set(7, index, label, kit.header))
  sheet.height(7, 24)
  report.statuses.forEach((status, index) => {
    const row = 8 + index
    const palette = PALETTE.status[status.key] || PALETTE.status.open
    sheet.set(row, 0, status.label, kit.cell(kit.book.font({ size: 10, bold: true, color: palette.font }), { alt: index % 2 === 1 }))
    sheet.set(row, 1, status.count, kit.cell(kit.body, { alt: index % 2 === 1, horizontal: 'center' }), { number: true })
    sheet.set(
      row,
      2,
      report.total ? status.count / report.total : 0,
      kit.cell(kit.body, { alt: index % 2 === 1, horizontal: 'center', numFmt: book.numFmt('0.0%') }),
      { number: true },
    )
    sheet.height(row, 20)
  })

  // Priority table (chart 2), rows 17..27.
  sheet.merge('A18:B18')
  sheet.set(17, 0, '优先级分布', kit.section)
  sheet.height(17, 24)
  ;['优先级', '任务数'].forEach((label, index) => sheet.set(18, index, label, kit.header))
  sheet.height(18, 24)
  report.priorities.forEach((priority, index) => {
    const row = 19 + index
    sheet.set(
      row,
      0,
      priority.key,
      kit.cell(kit.book.font({ size: 10, bold: true, color: PALETTE.priority[priority.key] || PALETTE.text }), {
        alt: index % 2 === 1,
        horizontal: 'center',
      }),
    )
    sheet.set(row, 1, priority.count, kit.cell(kit.body, { alt: index % 2 === 1, horizontal: 'center' }), { number: true })
    sheet.height(row, 20)
  })

  // Milestone table (chart 3), rows 28..38.
  sheet.merge('A29:E29')
  sheet.set(28, 0, '里程碑完成进度', kit.section)
  sheet.height(28, 24)
  ;['里程碑', '已完成', '总数', '完成率', '剩余'].forEach((label, index) => sheet.set(29, index, label, kit.header))
  sheet.height(29, 24)
  report.milestones.forEach((milestone, index) => {
    const row = 30 + index
    const alt = index % 2 === 1
    sheet.set(row, 0, `${milestone.code} ${milestone.name}`, kit.cell(kit.body, { alt, wrap: true }))
    sheet.set(row, 1, milestone.done, kit.cell(kit.body, { alt, horizontal: 'center' }), { number: true })
    sheet.set(row, 2, milestone.total, kit.cell(kit.body, { alt, horizontal: 'center' }), { number: true })
    sheet.set(
      row,
      3,
      milestone.percent,
      kit.cell(kit.body, { alt, horizontal: 'center', numFmt: book.numFmt('0.0%') }),
      { number: true },
    )
    sheet.set(row, 4, milestone.total - milestone.done, kit.cell(kit.body, { alt, horizontal: 'center' }), {
      number: true,
    })
    // Hidden helper column: the chart plots short milestone codes while the
    // table keeps the readable full name.
    sheet.set(row, 9, milestone.code, kit.cell(kit.muted))
    sheet.height(row, rowHeightFor([`${milestone.code} ${milestone.name}`], [26], { min: 22, max: 48 }))
  })

  // Tag table (chart 4) starts below the milestone block and its chart.
  const tagStart = Math.max(40, 30 + report.milestones.length + 2)
  sheet.merge(`A${tagStart + 1}:C${tagStart + 1}`)
  sheet.set(tagStart, 0, '标签使用 Top', kit.section)
  sheet.height(tagStart, 24)
  ;['标签', '任务数'].forEach((label, index) => sheet.set(tagStart + 1, index, label, kit.header))
  sheet.height(tagStart + 1, 24)
  if (report.tags.length) {
    report.tags.forEach((tag, index) => {
      const row = tagStart + 2 + index
      sheet.set(row, 0, tag.code, kit.cell(kit.book.font({ size: 9, color: 'FF1565C0' }), { alt: index % 2 === 1, wrap: true }))
      sheet.set(row, 1, tag.count, kit.cell(kit.body, { alt: index % 2 === 1, horizontal: 'center' }), { number: true })
      sheet.height(row, 20)
    })
  } else {
    sheet.set(tagStart + 2, 0, '（无标签）', kit.cell(kit.muted, { alt: false }))
    sheet.height(tagStart + 2, 20)
  }

  const footerRow = Math.max(tagStart + 2 + report.tags.length + 2, 30 + report.milestones.length + 3, 42)
  sheet.merge(`A${footerRow + 1}:I${footerRow + 1}`)
  sheet.set(
    footerRow,
    0,
    `由 ptodo 导出 · 数据源 docs/ptodo/todos.json · 生成时间 ${formatDateTime(report.generatedAt)} · 明细见「任务明细」工作表`,
    kit.footer,
  )
  sheet.height(footerRow, 18)
  return sheet
}

/* ------------------------------------------------------------------- charts */

function chartSpecs(report, tagStart) {
  const charts = []
  const statusCats = report.statuses.map((status) => status.label)
  charts.push(
    chartXml('column', {
      title: '任务状态分布',
      categories: statusCats,
      catRef: "'总览'!$A$9:$A$13",
      series: [
        {
          nameRef: "'总览'!$B$8",
          name: '任务数',
          valRef: "'总览'!$B$9:$B$13",
          values: report.statuses.map((status) => status.count),
          color: 'FF1565C0',
          points: report.statuses.map((status) => (PALETTE.status[status.key] || PALETTE.status.open).chart),
          labels: true,
        },
      ],
    }),
  )
  const priorityCats = report.priorities.map((priority) => priority.key)
  const priorityLast = 20 + report.priorities.length - 1
  charts.push(
    chartXml('doughnut', {
      title: '优先级分布',
      categories: priorityCats,
      catRef: `'总览'!$A$20:$A$${priorityLast}`,
      valRef: `'总览'!$B$20:$B$${priorityLast}`,
      values: report.priorities.map((priority) => priority.count),
      colors: report.priorities.map((priority) => PALETTE.priority[priority.key] || PALETTE.priority.P3),
      seriesRef: "'总览'!$B$19",
      seriesName: '任务数',
    }),
  )
  if (report.milestones.length) {
    const first = 31
    const last = first + report.milestones.length - 1
    charts.push(
      chartXml('stacked', {
        title: '里程碑完成进度',
        categories: report.milestones.map((milestone) => milestone.code),
        catRef: `'总览'!$J$${first}:$J$${last}`,
        series: [
          {
            nameRef: "'总览'!$B$30",
            name: '已完成',
            valRef: `'总览'!$B$${first}:$B$${last}`,
            values: report.milestones.map((milestone) => milestone.done),
            color: 'FF2E7D32',
            labels: true,
          },
          {
            nameRef: "'总览'!$E$30",
            name: '剩余',
            valRef: `'总览'!$E$${first}:$E$${last}`,
            values: report.milestones.map((milestone) => milestone.total - milestone.done),
            color: 'FFE0E4EA',
          },
        ],
      }),
    )
  }
  if (report.tags.length) {
    const first = tagStart + 3
    const last = first + report.tags.length - 1
    charts.push(
      chartXml('bar', {
        title: '标签使用 Top',
        categories: report.tags.map((tag) => tag.code),
        catRef: `'总览'!$A$${first}:$A$${last}`,
        series: [
          {
            nameRef: `'总览'!$B$${tagStart + 2}`,
            name: '任务数',
            valRef: `'总览'!$B$${first}:$B$${last}`,
            values: report.tags.map((tag) => tag.count),
            color: 'FF1565C0',
            labels: true,
          },
        ],
      }),
    )
  }
  return charts
}

function chartAnchors(report, tagStart) {
  const anchors = [
    { from: { col: 3, row: 6 }, to: { col: 8, row: 16 } },
    { from: { col: 3, row: 17 }, to: { col: 8, row: 27 } },
  ]
  if (report.milestones.length) anchors.push({ from: { col: 5, row: 28 }, to: { col: 8, row: 38 } })
  if (report.tags.length) anchors.push({ from: { col: 4, row: tagStart }, to: { col: 8, row: tagStart + 10 } })
  return anchors
}

/* ------------------------------------------------------------------ public */

/**
 * Build an XLSX buffer.
 *
 * @param {object} options
 * @param {string[]} options.headers - detail column headers.
 * @param {object[]} options.rows - one object per detail row.
 * @param {string} [options.sheet] - sheet name for the simple one-sheet mode.
 * @param {object} [options.report] - dashboard numbers; when present a 总览
 *   sheet with charts is emitted before 任务明细.
 */
export async function buildXlsx({ headers, rows, sheet, report } = {}) {
  const generatedAt = new Date()
  if (!report) {
    const book = new StyleBook()
    const kit = styleKit(book)
    const details = buildDetailsSheet({ kit, headers, rows, name: sheet || 'todos', print: false })
    return packageXml({
      sheets: [details],
      styles: book,
      charts: [],
      drawing: null,
      generatedAt,
      title: sheet || 'todos',
    })
  }

  const tagStart = Math.max(40, 30 + report.milestones.length + 2)
  const dashboardCharts = chartSpecs(report, tagStart)
  const book = new StyleBook()
  const kit = styleKit(book)
  const dashboard = buildDashboard(report, dashboardCharts, kit)
  const details = buildDetailsSheet({
    kit,
    headers,
    rows,
    name: '任务明细',
    print: true,
  })
  return packageXml({
    sheets: [dashboard, details],
    styles: book,
    charts: dashboardCharts,
    drawing: {
      sheetIndex: 0,
      anchors: chartAnchors(report, tagStart),
    },
    generatedAt,
    title: `待办看板 ${report.project}`,
  })
}

/** Parse an XLSX file into header-keyed row objects (pure JS). */
export async function parseXlsx(file) {
  const buffer = await readFile(file)
  return readXlsxRows(buffer)
}
