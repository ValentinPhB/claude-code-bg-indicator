import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  clip,
  kindOf,
  kindOfTool,
  outputPath,
  refreshTarget,
  scrollTop,
  pickLanguage,
  projectKey,
  scheduledLabel,
  tailLines,
  textsFor,
  visibleRange,
  wordFor,
} from '../hooks/register'

const BAND = {
  plugin: 'bg-indicator',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 3,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the band is hidden while nothing runs in the background', async ($, on) => {
  on('classic.Stop', () => ({}))
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Background/ })).toBeUndefined()
  await ui.unmount()
})

test('a task listed at the end of a turn shows its description, then clears', async ($, on) => {
  on('classic.Stop', () => ({}))
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'a', type: 'shell', status: 'running', description: 'Deploy the API', command: 'sh deploy.sh' },
      { id: 'b', type: 'monitor', status: 'running', description: 'Watch the logs' },
    ],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Deploy the API/ }))?.text).toBe('Deploy the API')
  expect((await ui.find({ type: 'Text', text: /\+1/ }))?.text).toBe(' (+1) ')
  await ui.unmount()

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /Deploy the API/ })).toBeUndefined()
  await after.unmount()
})

test('a tool call started in the background shows at once', async ($, on) => {
  on('classic.PostToolUse', () => ({}))
  await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: { command: 'sleep 600', run_in_background: true, description: 'Long job' },
    tool_response: {},
    tool_use_id: 't1',
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Long job/ }))?.text).toBe('Long job')
  await ui.unmount()
})

test('a foreground tool call does not light the band', async ($, on) => {
  on('classic.PostToolUse', () => ({}))
  await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    tool_response: {},
    tool_use_id: 't2',
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Background/ })).toBeUndefined()
  await ui.unmount()
})

test('the language comes from the Claude Code setting, then the locale variables', () => {
  expect(pickLanguage('French', 'de_DE.UTF-8')).toBe('fr')
  expect(pickLanguage('日本語')).toBe('ja')
  expect(pickLanguage('Español')).toBe('es')
  expect(pickLanguage('Traditional Chinese')).toBe('zh-tw')
  expect(pickLanguage('zh_TW.UTF-8')).toBe('zh-tw')
  expect(pickLanguage('zh_CN.UTF-8')).toBe('zh')
  expect(pickLanguage(undefined, 'C.UTF-8', 'pt_BR.UTF-8')).toBe('pt')
  expect(pickLanguage('Trad-nothing')).toBe('en')
  expect(pickLanguage(undefined, undefined)).toBe('en')
  expect(wordFor('fr')).toBe('Arrière-plan')
  expect(wordFor('xx')).toBe('Background')
})

test('long descriptions are clipped by terminal columns, in any script', () => {
  expect(clip('short', 60)).toBe('short')
  expect(clip('a'.repeat(100), 10)).toBe('a'.repeat(9) + '…')
  // CJK characters take two columns: 5 of them fit in 10 columns minus the ellipsis.
  expect(clip('バックグラウンドの作業を実行中です', 10)).toBe('バックグ…')
  // An emoji is never cut in half.
  const clipped = clip('🚀'.repeat(20), 9)
  expect(Array.from(clipped).every(ch => ch === '🚀' || ch === '…')).toBe(true)
})

test('the band word follows the language setting, with descriptions in any script', async ($, on) => {
  on('settings.read', () => ({ value: { language: 'French' } }))
  on('clock.every', () => ({ value: undefined }))
  on('env.get', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.Stop', () => ({}))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'z', type: 'shell', status: 'running', description: '部署 API サーバー' }],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Arrière-plan/ }))?.text).toBe('Arrière-plan ')
  expect((await ui.find({ type: 'Text', text: /部署/ }))?.text).toBe('部署 API サーバー')
  await ui.unmount()
})

test('a wake-up scheduled for later keeps the band lit when control returns', async ($, on) => {
  on('classic.Stop', () => ({}))
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [],
    session_crons: [{ id: 'c1', schedule: '*/10 * * * *', recurring: true, prompt: 'Check the deployment' }],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Check the deployment/ }))?.text).toBe('⏰ Check the deployment')
  await ui.unmount()

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /Check the deployment/ })).toBeUndefined()
  await after.unmount()
})

test('a scheduled label is clipped by columns and never empty', () => {
  expect(scheduledLabel('')).toBe('⏰ scheduled')
  expect(Array.from(scheduledLabel('x'.repeat(200))).length).toBeLessThanOrEqual(60)
})

const TOGGLE = { plugin: 'bg-indicator', key: 'toggle', surface: 'terminal' } as const

/** A press needs the drawing that holds the button: mount it, press, and let go (the state stays). */
const toggle = async ($: Engine) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press(TOGGLE)
  await ui.unmount()
}

const stopWith = async (
  $: Engine,
  descriptions: { type: string; text: string }[],
) =>
  $.classic.Stop({
    stop_hook_active: false,
    background_tasks: descriptions.map((d, i) => ({
      id: `id${i}`,
      type: d.type,
      status: 'running',
      description: d.text,
    })),
  })

test('the band is folded by default and its button shows how many tasks run', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [
    { type: 'shell', text: 'Deploy the API' },
    { type: 'monitor', text: 'Watch the logs' },
  ])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▸ 2')
  expect(await ui.find({ type: 'Text', text: /Watch the logs/ })).toBeUndefined()
  await ui.unmount()
})

test('pressing the button unfolds the whole list, with the kind of each task, and folds it back', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [
    { type: 'shell', text: 'Deploy the API' },
    { type: 'monitor', text: 'Watch the logs' },
    { type: 'subagent', text: 'Review the diff' },
  ])

  await toggle($)
  const open = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await open.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▾')
  expect((await open.find({ type: 'Button', text: /1\. \[shell\]/ }))?.text).toBe('1. [shell] Deploy the API')
  expect((await open.find({ type: 'Button', text: /2\. \[monitor\]/ }))?.text).toBe('2. [monitor] Watch the logs')
  expect((await open.find({ type: 'Button', text: /3\. \[subagent\]/ }))?.text).toBe('3. [subagent] Review the diff')
  await open.unmount()

  await toggle($)
  const folded = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await folded.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▸ 3')
  expect(await folded.find({ type: 'Button', text: /Review the diff/ })).toBeUndefined()
  await folded.unmount()
})

test('a single task can be unfolded too', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [{ type: 'shell', text: 'Only one' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', text: /1\. \[shell\]/ }))?.text).toBe('1. [shell] Only one')
  await ui.unmount()
})

test('a long list is capped and the rest is summarised', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith(
    $,
    Array.from({ length: 14 }, (_, i) => ({ type: 'shell', text: `Job ${i + 1}` })),
  )
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Button', text: /\[shell\]/ })).toHaveLength(10)
  expect((await ui.find({ type: 'Text', text: /… \+4/ }))?.text).toBe('  … +4')
  await ui.unmount()
})

test('the list folds itself when nothing runs any more', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [{ type: 'shell', text: 'Job' }])
  await toggle($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  await stopWith($, [{ type: 'shell', text: 'Another job' }])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▸ 1')
  await ui.unmount()
})

test('a scheduled wake-up is listed with its own kind', async ($, on) => {
  on('classic.Stop', () => ({}))
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [],
    session_crons: [
      { id: 'w', schedule: '0 9 * * *', recurring: false, prompt: 'Resume the migration' },
      { id: 'r', schedule: '*/5 * * * *', recurring: true, prompt: 'Poll the queue' },
    ],
  })
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: /\[wake-up\]/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /\[recurring\]/ })).toBeDefined()
  await ui.unmount()
})

test('the kind of a task started by a tool call follows the tool', () => {
  expect(kindOfTool('Monitor')).toBe('monitor')
  expect(kindOfTool('Agent')).toBe('subagent')
  expect(kindOfTool('Bash')).toBe('shell')
})

// ── Logs ─────────────────────────────────────────────────────────────────────

test('the project folder is named after the directory, like Claude Code does', () => {
  expect(projectKey('/Users/ada/dev/my-app')).toBe('-Users-ada-dev-my-app')
  expect(projectKey('/home/bob/Mon Projet/été')).toBe('-home-bob-Mon-Projet--t-')
  expect(outputPath('/tmp', 'claude-1000', { session: 's1', cwd: '/home/bob/app' }, 'b1')).toBe(
    '/tmp/claude-1000/-home-bob-app/s1/tasks/b1.output',
  )
})

test('a log tail drops colours and control characters, keeps the last lines and clips the width', () => {
  const raw = '\u001b[32mstart\u001b[0m\r\nline 2\r\n\u0007line 3\n\n\n'
  expect(tailLines(raw, 10, 80)).toEqual(['start', 'line 2', 'line 3'])
  expect(tailLines('a\nb\nc\nd\ne', 2, 80)).toEqual(['d', 'e'])
  expect(tailLines('x'.repeat(300), 3, 20)).toEqual(['x'.repeat(19) + '…'])
  expect(tailLines('', 5, 20)).toEqual([])
})

test('every language has both phrases', () => {
  for (const code of ['en', 'fr', 'es', 'de', 'pt', 'it', 'nl', 'pl', 'sv', 'tr', 'ru', 'uk', 'ja', 'zh', 'zh-tw', 'ko', 'vi', 'id']) {
    expect(textsFor(code).background.length).toBeGreaterThan(0)
    expect(textsFor(code).noLog.length).toBeGreaterThan(0)
  }
  expect(textsFor('xx').noLog).toBe('No log available')
})

const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })

const LOG_FILE = '/private/tmp/claude-1000/-work-app/sess1/tasks/id0.output'

const session = (on: On) => {
  on('session.id', () => ({ value: 'sess1' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.root', () => ({ value: '/work/app' }))
}

test('pressing a row shows the last lines of its log, and pressing it again hides them', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  on('fs.list', () => ({ value: [dir('claude-1000'), dir('other')] }))
  on('fs.exists', (_, e) => ({ value: e.path === LOG_FILE }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 40, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: 'building…\nstep 2 done\n\u001b[32mall good\u001b[0m\n' }))

  await $.classic.Stop({
    session_id: 'sess1',
    cwd: '/work/app',
    stop_hook_active: false,
    background_tasks: [{ id: 'id0', type: 'shell', status: 'running', description: 'Build' }],
  })
  await toggle($)

  const row = { plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' } as const
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press(row)
  expect((await ui.find({ type: 'Text', text: /step 2 done/ }))?.text).toBe('     │ step 2 done')
  expect((await ui.find({ type: 'Text', text: /all good/ }))?.text).toBe('     │ all good')
  await $.ui.press(row)
  expect(await ui.find({ type: 'Text', text: /step 2 done/ })).toBeUndefined()
  await ui.unmount()
})

test('a task without a log file says so, in the language of the user', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  on('fs.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: { language: 'French' } }))
  on('env.get', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.classic.Stop({
    session_id: 'sess1',
    cwd: '/work/app',
    stop_hook_active: false,
    background_tasks: [{ id: 'gone', type: 'shell', status: 'running', description: 'Vanished' }],
  })
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-gone', surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Aucun journal/ }))?.text).toBe('     Aucun journal disponible')
  await ui.unmount()
})

test('a scheduled wake-up shows its schedule and its whole prompt instead of a log', async ($, on) => {
  on('classic.Stop', () => ({}))
  await $.classic.Stop({
    session_id: 'sess1',
    cwd: '/work/app',
    stop_hook_active: false,
    background_tasks: [],
    session_crons: [{ id: 'w1', schedule: '*/10 * * * *', recurring: true, prompt: 'Check the deployment' }],
  })
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-w1', surface: 'terminal' })
  const lines = (await ui.findAll({ type: 'Text', text: /│/ })).map(t => t.text)
  expect(lines).toEqual(['     │ */10 * * * *', '     │ Check the deployment'])
  await ui.unmount()
})

test('a task kept by an older version without a kind is shown as a plain task, never as "undefined"', () => {
  expect(kindOf({})).toBe('task')
  expect(kindOf({ kind: '' })).toBe('task')
  expect(kindOf({ kind: 'monitor' })).toBe('monitor')
})

test('a missing file shows where it was looked for; an empty file says it is empty', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  on('fs.list', () => ({ value: [dir('claude-1000')] }))
  on('fs.exists', (_, e) => ({ value: e.path.endsWith('/empty.output') }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '' }))

  await $.classic.Stop({
    session_id: 'sess1',
    cwd: '/work/app',
    stop_hook_active: false,
    background_tasks: [
      { id: 'gone', type: 'shell', status: 'running', description: 'Vanished' },
      { id: 'empty', type: 'shell', status: 'running', description: 'Silent' },
    ],
  })
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-gone', surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /→/ }))?.text).toBe(
    '     → /private/tmp/claude-1000/-work-app/sess1/tasks/gone.output',
  )
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-empty', surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Log is empty/ }))?.text).toBe('     Log is empty')
  expect(await ui.find({ type: 'Text', text: /→/ })).toBeUndefined()
  await ui.unmount()
})

test('only the task the user opened is refreshed, and only while the list is unfolded', () => {
  const list = [
    { id: 'a', label: 'A', kind: 'shell' },
    { id: 'b', label: 'B', kind: 'shell' },
  ]
  expect(refreshTarget(true, 'b', list)?.id).toBe('b')
  expect(refreshTarget(false, 'b', list)).toBeUndefined()
  expect(refreshTarget(true, null, list)).toBeUndefined()
  expect(refreshTarget(true, 'gone', list)).toBeUndefined()
})

test('folding the list closes the open log', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  on('fs.list', () => ({ value: [dir('claude-1000')] }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: 'hello\n' }))
  await $.classic.Stop({
    session_id: 'sess1',
    cwd: '/work/app',
    stop_hook_active: false,
    background_tasks: [{ id: 'id0', type: 'shell', status: 'running', description: 'Job' }],
  })
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /hello/ })).toBeDefined()
  await $.ui.press(TOGGLE)
  await $.ui.press(TOGGLE)
  expect(await ui.find({ type: 'Text', text: /hello/ })).toBeUndefined()
  await ui.unmount()
})

test('the log window follows the end, leaves it when scrolled up and rejoins it at the bottom', () => {
  // 40 lines, a window of 10: the end is line 30 (0-based start).
  expect(visibleRange(40, 10, null)).toEqual({ start: 30, end: 40 })
  expect(scrollTop(40, 10, null, -5)).toBe(25)
  expect(scrollTop(40, 10, 25, -100)).toBe(0)
  expect(scrollTop(40, 10, 0, -1)).toBe(0)
  expect(scrollTop(40, 10, 25, 3)).toBe(28)
  expect(scrollTop(40, 10, 28, 2)).toBeNull()
  expect(scrollTop(40, 10, 28, 50)).toBeNull()
  expect(scrollTop(40, 10, null, 5)).toBeNull()
  // A log shorter than the window never scrolls.
  expect(scrollTop(6, 10, null, -3)).toBeNull()
  expect(visibleRange(6, 10, null)).toEqual({ start: 0, end: 6 })
  expect(visibleRange(40, 10, 99)).toEqual({ start: 30, end: 40 })
})

const longLog = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')

const wheel = ($: Engine, by: number) =>
  $.ui.scroll({
    component: 'AbovePrompt',
    requestId: 'bg-indicator',
    offset: 0,
    by,
    bodyRows: 10,
    contentRows: 30,
    origin: { kind: 'person' },
  })

test('the mouse wheel scrolls the open log, the follow button returns to the live end', async ($, on) => {
  on('classic.Stop', () => ({}))
  on('ui.scroll', () => ({}))
  session(on)
  on('fs.list', () => ({ value: [dir('claude-1000')] }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 400, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: longLog }))
  await $.classic.Stop({
    session_id: 'sess1',
    cwd: '/work/app',
    stop_hook_active: false,
    background_tasks: [{ id: 'id0', type: 'shell', status: 'running', description: 'Long job' }],
  })
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  const shown = async () => (await ui.findAll({ type: 'Text', text: /│/ })).map(t => t.text)

  // Following the end: the last 10 of the 40 lines.
  expect(await shown()).toEqual(Array.from({ length: 10 }, (_, i) => `     │ line ${31 + i}`))
  expect((await ui.find({ type: 'Text', text: /\/ 40/ }))?.text).toBe('     31–40 / 40 ')
  expect(await ui.find({ type: 'Button', key: 'follow' })).toBeUndefined()

  // The wheel goes up by 5 lines: the window leaves the end and a follow button appears.
  await wheel($, -5)
  expect((await shown())[0]).toBe('     │ line 26')
  expect((await ui.find({ type: 'Text', text: /\/ 40/ }))?.text).toBe('     26–35 / 40 ')
  expect(await ui.find({ type: 'Button', key: 'follow' })).toBeDefined()

  // All the way up, then the follow button jumps back to the live end.
  await wheel($, -100)
  expect((await shown())[0]).toBe('     │ line 1')
  await $.ui.press({ plugin: 'bg-indicator', key: 'follow', surface: 'terminal' })
  expect((await shown())[0]).toBe('     │ line 31')
  expect(await ui.find({ type: 'Button', key: 'follow' })).toBeUndefined()

  // Scrolling down to the bottom rejoins the tail by itself.
  await wheel($, -3)
  await wheel($, 3)
  expect((await shown())[0]).toBe('     │ line 31')
  await ui.unmount()
})

test('the wheel does nothing while no log is open', async ($, on) => {
  on('classic.Stop', () => ({}))
  on('ui.scroll', () => ({}))
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'id0', type: 'shell', status: 'running', description: 'Job' }],
  })
  await toggle($)
  await wheel($, -5)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /│/ })).toBeUndefined()
  await ui.unmount()
})
