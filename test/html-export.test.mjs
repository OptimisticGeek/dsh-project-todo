import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { API_CHANNEL, registerConnectionRoutes } from '../lib/http.js'
import { normalizeConfig } from '../lib/config.js'

const BIN = fileURLToPath(new URL('../bin/ptodo.mjs', import.meta.url))
const CLIENT = fileURLToPath(new URL('../client.js', import.meta.url))

function run(root, args) {
  return spawnSync(process.execPath, [BIN, '--root', root, ...args], { encoding: 'utf8', windowsHide: true })
}

async function withRoot(runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-html-'))
  try {
    assert.equal(run(root, ['init']).status, 0)
    await runTest(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function fixture(root) {
  assert.equal(run(root, ['milestone', 'create', '--name', 'M1', '--stages', '阶段一,阶段二']).status, 0)
  assert.equal(run(root, ['task', 'create', '--title', 'A', '--stage', 'S-0001', '--priority', 'P0']).status, 0)
  assert.equal(run(root, ['task', 'create', '--title', 'B <script>alert(1)</script>', '--stage', 'S-0002']).status, 0)
  assert.equal(run(root, ['task', 'start', 'T-0001']).status, 0)
  assert.equal(run(root, ['task', 'done', 'T-0001', '--evidence', 'ok', '--version', 'v1.0.0']).status, 0)
  assert.equal(run(root, ['task', 'block', 'T-0002', '--reason', '等外部条件']).status, 0)
}

function exportHtml(root, extra = []) {
  const result = run(root, ['admin', 'export', '--format', 'html', '--scope', 'all', ...extra])
  assert.equal(result.status, 0, result.stderr)
  const file = result.stdout.trim().split(/\r?\n/).pop().trim()
  return { file, text: null, result }
}

function parseData(text) {
  const match = /<script id="ptodo-data" type="application\/json">([\s\S]*?)<\/script>/.exec(text)
  assert.ok(match, 'template must inject the data script')
  return JSON.parse(match[1])
}

test('HTML export is a self-contained offline report with a stable data contract', async () => {
  await withRoot(async (root) => {
    await fixture(root)
    const exported = exportHtml(root, ['--title', '汇报版'])
    const text = await readFile(exported.file, 'utf8')
    const data = parseData(text)

    assert.match(text, /^<!doctype html>/i)
    assert.match(text, /汇报版/)
    assert.equal(data.meta.title, '汇报版')
    assert.equal(data.kpi.total, 2)
    assert.equal(data.kpi.done, 1)
    assert.equal(data.kpi.blocked, 1)
    assert.equal(data.groups.length, 1)
    assert.equal(data.groups[0].stages.reduce((sum, stage) => sum + stage.tasks.length, 0), 2)
    assert.equal(data.blocked[0].reason, '等外部条件')
    assert.equal(data.tasks.length, 2)
    assert.equal(data.tasks[0].statusLabel, '已完成')
    assert.doesNotMatch(text, /\{\{PTODO_[A-Z_]+\}\}/, 'no unresolved tokens')
    assert.doesNotMatch(text, /<script>alert\(1\)<\/script>/, 'user text must not become a script tag')
    assert.doesNotMatch(text, /(?:src|href)="https?:\/\//, 'no external resources')
  })
})

test('custom template path replaces tokens and receives the same data', async () => {
  await withRoot(async (root) => {
    await fixture(root)
    const custom = `<!doctype html><html><head><meta charset="utf-8"><title>{{PTODO_TITLE}}</title></head>` +
      `<body><h1>{{PTODO_PROJECT}} / {{PTODO_TASK_COUNT}} / {{PTODO_TEMPLATE}} / {{PTODO_SCOPE}}</h1>` +
      `<script id="ptodo-data" type="application/json">{{PTODO_DATA}}</script></body></html>`
    const file = path.join(root, 'mine.html')
    await writeFile(file, custom, 'utf8')

    const exported = exportHtml(root, ['--template', 'mine.html', '--title', '自定义'])
    const text = await readFile(exported.file, 'utf8')
    assert.match(text, /自定义/)
    assert.match(text, /2 \/ mine \/ 活跃 \+ 归档/)
    assert.equal(parseData(text).kpi.total, 2)
  })
})

test('missing template and missing data token fail loudly', async () => {
  await withRoot(async (root) => {
    await fixture(root)
    const missing = run(root, ['admin', 'export', '--format', 'html', '--template', 'nope.html'])
    assert.equal(missing.status, 3)
    assert.match(missing.stderr, /模板不存在/)

    const bad = path.join(root, 'bad.html')
    await writeFile(bad, '<html><body>no data here</body></html>', 'utf8')
    const noToken = run(root, ['admin', 'export', '--format', 'html', '--template', 'bad.html'])
    assert.notEqual(noToken.status, 0)
    assert.match(noToken.stderr, /PTODO_DATA/)
  })
})

test('admin templates lists the built-in template and schema advertises html', async () => {
  await withRoot(async (root) => {
    const listed = run(root, ['admin', 'templates', '--json'])
    assert.equal(listed.status, 0, listed.stderr)
    const payload = JSON.parse(listed.stdout)
    assert.ok(payload.templates.some((entry) => entry.name === 'report' && entry.exists))

    const schema = JSON.parse(run(root, ['schema', '--json']).stdout)
    const admin = schema.data ? schema.data : schema
    const domain = admin.commands.find((entry) => entry.name === 'admin')
    assert.ok(domain.actions.some((entry) => entry.name === 'templates'))
    assert.match(domain.actions.find((entry) => entry.name === 'export').usage, /html/)
  })
})

/** Mount the same Fetch route the dsh panel calls for `/export`. */
function mountExportRoute(root) {
  const routes = new Map()
  const agent = { id: 'session-x', session: { id: 'session-x', header: { cwd: root } } }
  const ctx = {
    get: (name) => (name === 'agents' ? { get: () => agent } : undefined),
    connection: {
      fetch: {
        register: (route) => {
          routes.set(route.path, route)
          return async () => {}
        },
      },
    },
  }
  registerConnectionRoutes(ctx, () => normalizeConfig({}), '/dsh-project-todo', 'tok')
  return routes.get(`${API_CHANNEL}/dsh-project-todo/export`)
}

test('Web 面板导出菜单提供 HTML 汇报页（活跃 / 含归档）', async () => {
  const source = await readFile(CLIENT, 'utf8')
  assert.match(source, /downloadExport\('html', 'active'\)/)
  assert.match(source, /downloadExport\('html', 'all'\)/)
  assert.match(source, /exportHtml: '导出 HTML 汇报页'/)
  assert.match(source, /exportHtml: 'Export HTML report'/)
})

test('面板 /export?format=html 返回单文件离线报告，并支持 title', async () => {
  await withRoot(async (root) => {
    await fixture(root)
    const route = mountExportRoute(root)
    assert.ok(route, '导出路由未注册')
    const response = await route.fetch(
      new Request('http://localhost/api/dsh-project-todo/export?sessionId=session-x&format=html&scope=all&title=%E6%B1%87%E6%8A%A5%E9%A1%B5'),
    )
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.match(response.headers.get('content-disposition'), /\.html/)
    const html = await response.text()
    assert.match(html, /<script id="ptodo-data" type="application\/json">/)
    assert.doesNotMatch(html, /\{\{PTODO_[A-Z_]+\}\}/)
    assert.match(html, /汇报页/)
    assert.equal(parseData(html).kpi.total, 2)
  })
})

test('面板只接受内置模板名，任意路径不会落到内置模板之外', async () => {
  await withRoot(async (root) => {
    await fixture(root)
    const route = mountExportRoute(root)
    const response = await route.fetch(
      new Request('http://localhost/api/dsh-project-todo/export?sessionId=session-x&format=html&template=..%2F..%2Fetc%2Fpasswd'),
    )
    assert.equal(response.status, 200)
    const html = await response.text()
    // An unknown name is ignored and the built-in report is used.
    assert.match(html, /<script id="ptodo-data" type="application\/json">/)
  })
})
