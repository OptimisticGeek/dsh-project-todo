import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { act, getState } from '../lib/service.js'
import { normalizeConfig } from '../lib/config.js'

const CLIENT = fileURLToPath(new URL('../client.js', import.meta.url))

function stubReact() {
  let cursor = 0
  let hooks = []
  let pending = []
  let dirty = false
  const changed = (left, right) =>
    !left || !right || left.length !== right.length || left.some((value, index) => value !== right[index])
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
          dirty = true
        },
      ]
    },
    useEffect(fn, deps) {
      const index = cursor++
      const previous = hooks[index]
      if (!previous || changed(previous.deps, deps)) {
        hooks[index] = { deps }
        pending.push(fn)
      }
    },
    useCallback(fn, deps) {
      const index = cursor++
      const previous = hooks[index]
      if (previous && !changed(previous.deps, deps)) return previous.fn
      hooks[index] = { deps, fn }
      return fn
    },
    useRef(value) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: value }
      return hooks[index]
    },
  }
  return {
    React,
    begin() {
      cursor = 0
      pending = []
      dirty = false
    },
    effects() {
      return pending
    },
    isDirty() {
      return dirty
    },
  }
}

async function renderClient(state, peoplePayload, options = {}) {
  const hooks = stubReact()
  const localStorage = { store: {}, getItem(key) { return this.store[key] ?? null }, setItem(key, value) { this.store[key] = String(value) } }
  const sandbox = {
    window: {
      __ModuleLoader__: { load(definition) { sandbox.module = definition } },
      localStorage,
      fetch: async (url) => ({
        ok: true,
        json: async () => {
          const text = String(url)
          if (text.includes('/people')) return peoplePayload || { ok: true, people: [] }
          if (text.includes('/task')) return options.taskPayload || state
          return state
        },
      }),
      addEventListener() {},
      removeEventListener() {},
      confirm: () => true,
      btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    },
    navigator: { language: 'zh-CN' },
    document: { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    console,
    setTimeout,
    clearTimeout,
    Buffer,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(readFileSync(CLIENT, 'utf8'), sandbox)
  const plugin = sandbox.module.factory((name) => {
    if (name === 'react') return hooks.React
    throw new Error(`unexpected require ${name}`)
  })
  let component = null
  plugin.apply({
    slots: { inject: (name, factory) => factory(), register: (options, fn) => { component = fn } },
    locale: { getLocale: () => ({ active: 'zh' }) },
  })
  assert.equal(typeof component, 'function')
  let tree = null
  const passes = async (limit) => {
    for (let pass = 0; pass < limit; pass += 1) {
      hooks.begin()
      tree = component({ sessionId: 'session-test' })
      await Promise.all(hooks.effects().map((effect) => effect()))
      // Let async effects (state fetch) settle before deciding the next pass.
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (!hooks.isDirty() && pass > 2) break
    }
  }
  await passes(30)
  if (options.interact) {
    await options.interact({ getTree: () => tree })
    await passes(30)
  }
  return tree
}

function findNode(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, predicate)
      if (hit) return hit
    }
    return null
  }
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const hit = findNode(child, predicate)
    if (hit) return hit
  }
  return null
}

function walk(node, visit) {
  if (node === null || node === undefined) return
  if (typeof node === 'string' || typeof node === 'number') {
    visit.text(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node === 'object') {
    if (typeof node.props?.className === 'string') visit.class(node.props.className)
    for (const child of node.children || []) walk(child, visit)
  }
}

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ptodo-client-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('client renders tabs and a flat list when only the default org exists', async () => {
  await withRoot(async (root) => {
    const config = normalizeConfig({ markdown: { enabled: false }, archive: { afterDays: 0 }, version: { auto: false, require: false } })
    await act(root, config, { action: 'create', title: 'UI 任务 A', tags: ['REQ'], by: 'tester' }, 'tester')
    await act(root, config, { action: 'create', title: 'UI 任务 B', by: 'tester' }, 'tester')
    const state = await getState(root, config, {})
    state.actor = { actor: 'tester', source: 'git', gitName: 'tester', hasPrefix: false }
    state.config.defaultTab = 'all'

    const tree = await renderClient(state)
    const classes = []
    const texts = []
    walk(tree, {
      class: (name) => classes.push(name),
      text: (text) => texts.push(text),
    })
    const count = (name) => classes.filter((value) => value.split(/\s+/).includes(name)).length
    assert.equal(tree.props.className, 'dsh-project-todo')
    assert.equal(count('dpt-tab'), 6)
    assert.equal(count('dpt-table--flat'), 1)
    assert.equal(count('dpt-table--grouped'), 0)
    assert.equal(count('dpt-group'), 0)
    assert.equal(count('dpt-stage-row'), 0)
    assert.equal(count('dpt-task'), 2)
    assert.ok(texts.includes('T-0001'))
    assert.ok(texts.includes('UI 任务 A'))
  })
})

test('client groups by milestone and stage once a real hierarchy exists', async () => {
  await withRoot(async (root) => {
    const config = normalizeConfig({ markdown: { enabled: false }, archive: { afterDays: 0 }, version: { auto: false, require: false } })
    await act(root, config, { action: 'create', title: 'UI 任务 A', by: 'tester' }, 'tester')
    await act(root, config, { action: 'create', title: 'UI 任务 B', by: 'tester' }, 'tester')
    const state = await getState(root, config, {})
    state.actor = { actor: 'tester', source: 'git', gitName: 'tester', hasPrefix: false }
    state.config.defaultTab = 'all'
    // Synthesize a second milestone/stage: the client only reads the state payload.
    const second = state.board.tasks.find((task) => task.title === 'UI 任务 B')
    second.stageCode = 'S-0002'
    second.milestoneCode = 'M-0002'
    state.milestones = [...(state.milestones || []), { code: 'M-0002', name: '里程碑二', status: 'active', effectiveStatus: 'active', order: 2 }]
    state.stages = [...(state.stages || []), { code: 'S-0002', name: '阶段二', milestoneCode: 'M-0002', status: 'active', effectiveStatus: 'active', order: 2 }]

    const tree = await renderClient(state)
    const classes = []
    const texts = []
    walk(tree, {
      class: (name) => classes.push(name),
      text: (text) => texts.push(text),
    })
    const count = (name) => classes.filter((value) => value.split(/\s+/).includes(name)).length
    assert.equal(count('dpt-table--grouped'), 1)
    assert.equal(count('dpt-table--flat'), 0)
    assert.equal(count('dpt-group'), 2)
    assert.equal(count('dpt-stage-row'), 2)
    assert.equal(count('dpt-task'), 2)
    assert.equal(count('dpt-task--grouped'), 2)
    assert.ok(texts.includes('M-0002'))
    assert.ok(texts.includes('S-0002'))
    assert.ok(texts.includes('里程碑二'))
    assert.ok(texts.includes('阶段二'))
  })
})

test('client defaults the people filter to me and hides other people tasks', async () => {
  await withRoot(async (root) => {
    const config = normalizeConfig({ markdown: { enabled: false }, archive: { afterDays: 0 }, version: { auto: false, require: false } })
    await act(root, config, { action: 'create', title: '我的任务', by: 'alice' }, 'alice')
    await act(root, config, { action: 'create', title: '别人的任务', by: 'bob' }, 'bob')
    const state = await getState(root, config, {})
    state.actor = { actor: 'dsh:alice', person: 'alice', source: 'git', gitName: 'alice', hasPrefix: true }
    state.config.defaultTab = 'all'
    // Give bob's task its own milestone so the grouped view must follow the filter too.
    const other = state.board.tasks.find((task) => task.title === '别人的任务')
    other.stageCode = 'S-0002'
    other.milestoneCode = 'M-0002'
    state.milestones = [...(state.milestones || []), { code: 'M-0002', name: '里程碑二', status: 'active', effectiveStatus: 'active', order: 2 }]
    state.stages = [...(state.stages || []), { code: 'S-0002', name: '阶段二', milestoneCode: 'M-0002', status: 'active', effectiveStatus: 'active', order: 2 }]

    const tree = await renderClient(state, { ok: true, person: 'alice', people: [{ name: 'alice' }, { name: 'bob' }] })
    const classes = []
    const texts = []
    walk(tree, { class: (name) => classes.push(name), text: (text) => texts.push(text) })
    const count = (name) => classes.filter((value) => value.split(/\s+/).includes(name)).length
    assert.ok(texts.includes('我的任务'))
    assert.ok(!texts.includes('别人的任务'))
    assert.ok(texts.includes('与我相关'))
    // Only alice's milestone group is visible; its count/progress use the filtered set.
    assert.equal(count('dpt-group'), 1)
    assert.ok(texts.includes('1 项'))
    assert.ok(texts.includes('0/1'))
  })
})

test('done tab offers single and batch archive for completed tasks', async () => {
  await withRoot(async (root) => {
    const config = normalizeConfig({ markdown: { enabled: false }, archive: { afterDays: 0 }, version: { auto: false, require: false } })
    const created = await act(root, config, { action: 'create', title: '已完成任务', by: 'tester' }, 'tester')
    const id = created.task.id
    await act(root, config, { action: 'start', id, by: 'tester' }, 'tester')
    await act(root, config, { action: 'done', id, by: 'tester', version: 'test1' }, 'tester')
    const state = await getState(root, config, {})
    state.actor = { actor: 'tester', source: 'git', gitName: 'tester', hasPrefix: false }
    state.config.defaultTab = 'done'

    const tree = await renderClient(state)
    const classes = []
    const texts = []
    walk(tree, { class: (name) => classes.push(name), text: (text) => texts.push(text) })
    const count = (name) => classes.filter((value) => value.split(/\s+/).includes(name)).length
    assert.equal(count('dpt-task'), 1)
    assert.ok(texts.includes('归档'))
    assert.ok(texts.some((text) => String(text).includes('批量归档')))
  })
})

test('task detail shows history as a status flow instead of a text list', async () => {
  await withRoot(async (root) => {
    const config = normalizeConfig({ markdown: { enabled: false }, archive: { afterDays: 0 }, version: { auto: false, require: false } })
    const created = await act(root, config, { action: 'create', title: '流程任务', by: 'tester' }, 'tester')
    const id = created.task.id
    await act(root, config, { action: 'start', id, by: 'tester' }, 'tester')
    const state = await getState(root, config, {})
    state.actor = { actor: 'tester', person: 'tester', source: 'git', gitName: 'tester', hasPrefix: false }
    state.config.defaultTab = 'all'
    const task = state.board.tasks.find((entry) => entry.id === id)
    const taskPayload = {
      ok: true,
      task,
      children: [],
      parent: null,
      archived: false,
      stage: null,
      milestone: null,
      preconditions: [],
      blocking: [],
      staleResources: [],
      relatedCommits: [],
      history: [
        { at: '2026-11-04T08:09:39.896Z', action: 'start', by: 'tester', taskIds: [id], transitions: [{ id, from: 'open', to: 'doing' }] },
        { at: '2026-11-04T08:09:18.863Z', action: 'create', by: 'tester', taskIds: [id], transitions: [{ id, from: null, to: 'open' }] },
      ],
    }

    const tree = await renderClient(state, { ok: true, person: 'tester', people: [{ name: 'tester' }] }, {
      taskPayload,
      interact: async ({ getTree }) => {
        const row = findNode(getTree(), (node) => {
          const className = node && node.props && node.props.className
          return typeof className === 'string' && className.split(/\s+/).includes('dpt-task') && typeof node.props.onClick === 'function'
        })
        assert.ok(row, 'task row missing')
        row.props.onClick()
      },
    })
    const classes = []
    const texts = []
    walk(tree, { class: (name) => classes.push(name), text: (text) => texts.push(text) })
    const count = (name) => classes.filter((value) => value.split(/\s+/).includes(name)).length
    assert.equal(count('dpt-flow'), 1)
    assert.equal(count('dpt-flow-step'), 2)
    assert.ok(texts.includes('开工'))
    assert.ok(texts.includes('新建'))
    assert.ok(texts.includes('进行中'))
    assert.ok(texts.includes('未开始'))
  })
})
