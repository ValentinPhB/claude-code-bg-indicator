import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  clip,
  detaches,
  followCommand,
  followScript,
  isSafeId,
  isSafePath,
  kindOf,
  kindOfTool,
  LINUX_TERMINALS,
  outputPath,
  pickLanguage,
  projectKey,
  refreshTarget,
  scheduledLabel,
  scrollbar,
  scrollTop,
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

const TOGGLE = { plugin: 'bg-indicator', key: 'toggle', surface: 'terminal' } as const

/** A press needs the drawing that holds the button: mount it, press, and let go (the state stays). */
const toggle = async ($: Engine) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press(TOGGLE)
  await ui.unmount()
}

type Described = { type: string; text: string }

const stopWith = async ($: Engine, descriptions: Described[]) =>
  $.classic.Stop({
    stop_hook_active: false,
    background_tasks: descriptions.map((d, i) => ({
      id: `id${i}`,
      type: d.type,
      status: 'running',
      description: d.text,
    })),
  })

const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })

const session = (on: On) => {
  on('session.id', () => ({ value: 'sess1' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.root', () => ({ value: '/work/app' }))
}

const logFiles = (on: On, content: string, size = 400) => {
  on('fs.list', () => ({ value: [dir('claude-1000')] }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: content }))
}

const WORDS = ['Background Tasks']

/** What `$.process.run` answers when the command ran and ended with that exit code. */
const exited = (exitCode: number, stderr = '') => ({
  value: { exitCode, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

// ── The title ────────────────────────────────────────────────────────────────

test('the band is hidden while nothing runs in the background', async ($, on) => {
  on('classic.Stop', () => ({}))
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  for (const word of WORDS) expect(await ui.find({ type: 'Text', text: word })).toBeUndefined()
  await ui.unmount()
})

test('with one task the title is the same as with several: "Background Tasks (1)"', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [{ type: 'shell', text: 'Deploy the API' }])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Background Tasks/ }))?.text).toBe('Background Tasks ')
  expect((await ui.find({ type: 'Text', text: /^\(1\)/ }))?.text).toBe('(1) ')
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▾')
  await ui.unmount()
})

test('with several tasks the title is only "Background Tasks" and their number', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [
    { type: 'shell', text: 'Deploy the API' },
    { type: 'monitor', text: 'Watch the logs' },
    { type: 'subagent', text: 'Review the diff' },
  ])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Background Tasks/ }))?.text).toBe('Background Tasks ')
  expect((await ui.find({ type: 'Text', text: /\(3\)/ }))?.text).toBe('(3) ')
  expect(await ui.find({ type: 'Text', text: /Deploy the API/ })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▾')
  await ui.unmount()
})

test('the title follows the number of tasks as it changes', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [
    { type: 'shell', text: 'One' },
    { type: 'shell', text: 'Two' },
  ])
  await stopWith($, [{ type: 'shell', text: 'Only the last one' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^\(/ }))?.text).toBe('(1) ')
  expect((await ui.find({ type: 'Text', text: /Only the last one/ }))?.text).toBe('1. Only the last one ')
  await ui.unmount()
})

test('a tool call started in the background shows at once', async ($, on) => {
  on('classic.PostToolUse', () => ({}))
  await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: { command: 'sleep 600', run_in_background: true, description: 'Long job' },
    tool_response: {},
    tool_use_id: 't1',
  })

  await toggle($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Long job/ }))?.text).toBe('1. Long job ')
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
  for (const word of WORDS) expect(await ui.find({ type: 'Text', text: word })).toBeUndefined()
  await ui.unmount()
})

test('a wake-up scheduled for later keeps the band lit when control returns', async ($, on) => {
  on('classic.Stop', () => ({}))
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [],
    session_crons: [{ id: 'c1', schedule: '*/10 * * * *', recurring: true, prompt: 'Check the deployment' }],
  })

  await toggle($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Check the deployment/ }))?.text).toBe('1. ⏰ Check the deployment ')
  await ui.unmount()

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /Check the deployment/ })).toBeUndefined()
  await after.unmount()
})

// ── Languages ────────────────────────────────────────────────────────────────

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
  expect(wordFor('fr')).toBe('Tâches en arrière-plan')
  expect(wordFor('xx')).toBe('Background Tasks')
})

test('every language has every phrase', () => {
  for (const code of ['en', 'fr', 'es', 'de', 'pt', 'it', 'nl', 'pl', 'sv', 'tr', 'ru', 'uk', 'ja', 'zh', 'zh-tw', 'ko', 'vi', 'id']) {
    const texts = textsFor(code)
    for (const phrase of [texts.tasks, texts.noLog, texts.empty, texts.noTerminal]) {
      expect(phrase.length).toBeGreaterThan(0)
    }
  }
  expect(textsFor('xx').noLog).toBe('No log available')
  expect(textsFor('fr').tasks).toBe('Tâches en arrière-plan')
})

test('the band follows the language setting, with descriptions in any script', async ($, on) => {
  on('settings.read', () => ({ value: { language: 'French' } }))
  on('clock.every', () => ({ value: undefined }))
  on('env.get', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.Stop', () => ({}))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await stopWith($, [{ type: 'shell', text: '部署 API サーバー' }])
  await toggle($)
  const one = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await one.find({ type: 'Text', text: /Tâches en arrière-plan/ }))?.text).toBe('Tâches en arrière-plan ')
  expect((await one.find({ type: 'Text', text: /部署/ }))?.text).toBe('1. 部署 API サーバー ')
  await one.unmount()

  await stopWith($, [
    { type: 'shell', text: '部署 API サーバー' },
    { type: 'shell', text: 'Autre' },
  ])
  const many = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await many.find({ type: 'Text', text: /Tâches/ }))?.text).toBe('Tâches en arrière-plan ')
  await many.unmount()
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

test('a scheduled label is bounded, keeps the full prompt for the hover, and is never empty', () => {
  expect(scheduledLabel('')).toBe('⏰ scheduled')
  expect(Array.from(scheduledLabel('x'.repeat(200))).length).toBe(202)
  expect(Array.from(scheduledLabel('x'.repeat(1000))).length).toBeLessThanOrEqual(400)
})

test('the kind of a task started by a tool call follows the tool', () => {
  expect(kindOfTool('Monitor')).toBe('monitor')
  expect(kindOfTool('Agent')).toBe('subagent')
  expect(kindOfTool('Bash')).toBe('shell')
})

test('a task kept by an older version without a kind is shown as a plain task, never as "undefined"', () => {
  expect(kindOf({})).toBe('task')
  expect(kindOf({ kind: '' })).toBe('task')
  expect(kindOf({ kind: 'monitor' })).toBe('monitor')
})

// ── The list ─────────────────────────────────────────────────────────────────

test('pressing the button unfolds the whole list, with the kind of each task, and folds it back', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [
    { type: 'shell', text: 'Deploy the API' },
    { type: 'monitor', text: 'Watch the logs' },
    { type: 'subagent', text: 'Review the diff' },
  ])

  await toggle($)
  const open = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await open.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▴')
  const rows = (await open.findAll({ type: 'Text', text: /^\d+\. / })).map(t => t.text)
  expect(rows).toEqual(['1. Deploy the API ', '2. Watch the logs ', '3. Review the diff '])
  // The row is plain text: no kind in braces, and only the small buttons are clickable.
  expect(await open.find({ type: 'Text', text: /\[shell\]|\[monitor\]/ })).toBeUndefined()
  expect(await open.find({ type: 'Button', text: /Deploy the API/ })).toBeUndefined()
  expect((await open.find({ type: 'Button', key: 'task-id0' }))?.text).toBe('▾')
  expect((await open.find({ type: 'Button', key: 'term-id1' }))?.text).toBe('>_')
  // There is no VS Code window button any more: the terminal button is the only way to follow a log outside the band.
  expect(await open.find({ type: 'Button', key: 'open-id2' })).toBeUndefined()
  await $.ui.press(TOGGLE)
  await open.unmount()

  const folded = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await folded.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▾')
  expect(await folded.find({ type: 'Text', text: /Review the diff/ })).toBeUndefined()
  expect(await folded.find({ type: 'Button', key: 'task-id0' })).toBeUndefined()
  await folded.unmount()
})

test('a single task can be unfolded too', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [{ type: 'shell', text: 'Only one' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^1\. Only one/ }))?.text).toBe('1. Only one ')
  expect((await ui.find({ type: 'Button', key: 'task-id0' }))?.text).toBe('▾')
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
  expect(await ui.findAll({ type: 'Text', text: /^\d+\. Job/ })).toHaveLength(10)
  expect((await ui.find({ type: 'Text', text: /… \+4/ }))?.text).toBe('  … +4')
  expect((await ui.find({ type: 'Text', text: /\(14\)/ }))?.text).toBe('(14) ')
  await ui.unmount()
})

test('the list folds itself when nothing runs any more', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [{ type: 'shell', text: 'Job' }])
  await toggle($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  await stopWith($, [{ type: 'shell', text: 'Another job' }])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▾')
  await ui.unmount()
})

test('a scheduled wake-up is listed, with its own fold button and no terminal button', async ($, on) => {
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
  expect(await ui.find({ type: 'Text', text: /⏰ Resume the migration/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⏰ Poll the queue/ })).toBeDefined()
  // A wake-up can be unfolded to read its schedule, but has no log to follow in a terminal.
  expect(await ui.find({ type: 'Button', key: 'task-w' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: '>_' })).toBeUndefined()
  await ui.unmount()
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

type Finder = { findAll: (query: { type: string; text: RegExp }) => Promise<{ text?: string | undefined }[]> }

/** The text of the log lines on screen (the gutter and the scrollbar are drawn apart). */
const gutter = async (ui: Finder) =>
  (await ui.findAll({ type: 'Text', text: /^ (line|build|step|all|hello)/ })).map(t => t.text ?? '')

test('pressing a row shows the last lines of its log, and pressing it again hides them', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  logFiles(on, 'building…\nstep 2 done\n\u001b[32mall good\u001b[0m\n')
  await stopWith($, [{ type: 'shell', text: 'Build' }])
  await toggle($)

  const row = { plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' } as const
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press(row)
  expect(await gutter(ui)).toEqual([' building…', ' step 2 done', ' all good'])
  await $.ui.press(row)
  expect(await gutter(ui)).toEqual([])
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
  await stopWith($, [{ type: 'shell', text: 'Vanished' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Aucun journal/ }))?.text).toBe('   Aucun journal disponible')
  await ui.unmount()
})

test('a scheduled wake-up shows its schedule and its whole prompt instead of a log', async ($, on) => {
  on('classic.Stop', () => ({}))
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [],
    session_crons: [{ id: 'w1', schedule: '*/10 * * * *', recurring: true, prompt: 'Check the deployment' }],
  })
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-w1', surface: 'terminal' })
  const lines = (await ui.findAll({ type: 'Text', text: /^ (\*\/10|Check the)/ })).map(t => t.text)
  expect(lines).toEqual([' */10 * * * *', ' Check the deployment'])
  await ui.unmount()
})

test('a missing file shows where it was looked for; an empty file says it is empty', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  on('fs.list', () => ({ value: [dir('claude-1000')] }))
  on('fs.exists', (_, e) => ({ value: e.path.endsWith('/id1.output') }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
  await stopWith($, [
    { type: 'shell', text: 'Vanished' },
    { type: 'shell', text: 'Silent' },
  ])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /→/ }))?.text).toBe(
    '   → /private/tmp/claude-1000/-work-app/sess1/tasks/id0.output',
  )
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id1', surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Log is empty/ }))?.text).toBe('   Log is empty')
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
  logFiles(on, 'hello\n', 10)
  await stopWith($, [{ type: 'shell', text: 'Job' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  expect(await gutter(ui)).toEqual([' hello'])
  await $.ui.press(TOGGLE)
  await $.ui.press(TOGGLE)
  expect(await gutter(ui)).toEqual([])
  await ui.unmount()
})

// ── Scrolling and the scrollbar ──────────────────────────────────────────────

test('the log window follows the end, leaves it when scrolled up and rejoins it at the bottom', () => {
  expect(visibleRange(40, 10, null)).toEqual({ start: 30, end: 40 })
  expect(scrollTop(40, 10, null, -5)).toBe(25)
  expect(scrollTop(40, 10, 25, -100)).toBe(0)
  expect(scrollTop(40, 10, 0, -1)).toBe(0)
  expect(scrollTop(40, 10, 25, 3)).toBe(28)
  expect(scrollTop(40, 10, 28, 2)).toBeNull()
  expect(scrollTop(40, 10, 28, 50)).toBeNull()
  expect(scrollTop(40, 10, null, 5)).toBeNull()
  expect(scrollTop(6, 10, null, -3)).toBeNull()
  expect(visibleRange(6, 10, null)).toEqual({ start: 0, end: 6 })
  expect(visibleRange(40, 10, 99)).toEqual({ start: 30, end: 40 })
})

test('the scrollbar thumb shows where the window is in the log, and its size', () => {
  const thumbRows = (bar: boolean[]) => bar.flatMap((on, i) => (on ? [i] : []))
  // 40 lines in a window of 10: the thumb is a quarter of the track (3 rows after rounding).
  expect(thumbRows(scrollbar(40, 10, 30, 10))).toEqual([7, 8, 9])
  expect(thumbRows(scrollbar(40, 10, 0, 10))).toEqual([0, 1, 2])
  expect(scrollbar(40, 10, 15, 10).filter(Boolean)).toHaveLength(3)
  // A huge log still gets a one-row thumb, never none.
  expect(thumbRows(scrollbar(5000, 10, 0, 10))).toEqual([0])
  expect(thumbRows(scrollbar(5000, 10, 4990, 10))).toEqual([9])
  // A log that fits has no thumb.
  expect(scrollbar(6, 10, 0, 6).some(Boolean)).toBe(false)
  expect(scrollbar(40, 10, 0, 0)).toEqual([])
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
  logFiles(on, longLog)
  await stopWith($, [{ type: 'shell', text: 'Long job' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  const first = async () => (await gutter(ui))[0]

  expect(await gutter(ui)).toEqual(Array.from({ length: 10 }, (_, i) => ` line ${31 + i}`))
  expect((await ui.find({ type: 'Text', text: /\/ 40/ }))?.text).toBe('   31–40 / 40 ')
  expect(await ui.find({ type: 'Button', key: 'follow' })).toBeUndefined()

  await wheel($, -5)
  expect(await first()).toBe(' line 26')
  expect((await ui.find({ type: 'Text', text: /\/ 40/ }))?.text).toBe('   26–35 / 40 ')
  expect(await ui.find({ type: 'Button', key: 'follow' })).toBeDefined()

  await wheel($, -100)
  expect(await first()).toBe(' line 1')
  await $.ui.press({ plugin: 'bg-indicator', key: 'follow', surface: 'terminal' })
  expect(await first()).toBe(' line 31')
  expect(await ui.find({ type: 'Button', key: 'follow' })).toBeUndefined()

  await wheel($, -3)
  await wheel($, 3)
  expect(await first()).toBe(' line 31')
  await ui.unmount()
})

test('each log has its own scrollbar: the thumb moves with the window', async ($, on) => {
  on('classic.Stop', () => ({}))
  on('ui.scroll', () => ({}))
  session(on)
  logFiles(on, longLog)
  await stopWith($, [{ type: 'shell', text: 'Long job' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  const bars = async () => ({
    thumb: (await ui.findAll({ type: 'Text', text: '┃' })).length,
    track: (await ui.findAll({ type: 'Text', text: '│' })).length,
  })

  // Following the end: a thumb of 3 rows and a track of 7.
  expect(await bars()).toEqual({ thumb: 3, track: 7 })
  await wheel($, -100)
  expect(await bars()).toEqual({ thumb: 3, track: 7 })
  await ui.unmount()
})

test('a log that fits in the window has a track and no thumb', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  logFiles(on, 'line 1\nline 2\nline 3\n', 20)
  await stopWith($, [{ type: 'shell', text: 'Short job' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: '┃' })).length).toBe(0)
  expect((await ui.findAll({ type: 'Text', text: '│' })).length).toBe(3)
  await ui.unmount()
})

test('the wheel does nothing while no log is open', async ($, on) => {
  on('classic.Stop', () => ({}))
  on('ui.scroll', () => ({}))
  await stopWith($, [{ type: 'shell', text: 'Job' }])
  await toggle($)
  await wheel($, -5)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: '│' })).length).toBe(0)
  await ui.unmount()
})

test('only safe ids and paths reach the command that follows a log', () => {
  expect(isSafeId('b2m2lndv3')).toBe(true)
  expect(isSafeId('task_1-a')).toBe(true)
  for (const bad of ['', 'a b', 'a;rm -rf /', '$(id)', '../x', 'a/b', "it's", 'x'.repeat(65)]) {
    expect(isSafeId(bad)).toBe(false)
  }
  expect(isSafePath('/private/tmp/claude-1000/-work-app/s1/tasks/b1.output')).toBe(true)
  for (const bad of ['relative/path', '/tmp/a b', '/tmp/../etc/passwd', "/tmp/a'b", '/tmp/$(id)', '/tmp/a;b', '']) {
    expect(isSafePath(bad)).toBe(false)
  }
})

test('the terminal follows the log with watch, or tail -f where watch is missing', () => {
  const command = followCommand('/tmp/x/tasks/b1.output')
  expect(command).toContain("command -v watch")
  expect(command).toContain("exec watch -n 1 -t tail -n 80 '/tmp/x/tasks/b1.output'")
  expect(command).toContain("exec tail -n 200 -f '/tmp/x/tasks/b1.output'")
})

// ── Open a task's log in a terminal window ───────────────────────────────────

test('the terminal script names the window, then follows the log', () => {
  const script = followScript('Deploy the API', '/tmp/x/tasks/b1.output')
  expect(script.startsWith('#!/bin/sh\n')).toBe(true)
  expect(script).toContain("printf '\\033]0;%s\\007' 'Deploy the API'")
  expect(script).toContain("exec watch -n 1 -t tail -n 80 '/tmp/x/tasks/b1.output'")
  // A title with a quote cannot break out of its quotes.
  expect(followScript("it's", '/tmp/a.output')).toContain("'it'\\''s'")
})

test('every Linux terminal is started with the script as a separate word', () => {
  for (const terminal of LINUX_TERMINALS) {
    expect(terminal.path.startsWith('/usr/bin/')).toBe(true)
    expect(terminal.args('/tmp/s.command').join(' ')).toContain('/tmp/s.command')
  }
})

const termRow = { plugin: 'bg-indicator', key: 'term-id0', surface: 'terminal' } as const

test('the terminal button opens a Terminal window that follows the log (macOS)', async ($, on) => {
  const written: { path: string; text: string }[] = []
  const ran: string[][] = []
  on('classic.Stop', () => ({}))
  session(on)
  logFiles(on, 'x\n')
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return exited(0)
  })
  await stopWith($, [{ type: 'shell', text: 'Deploy' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press(termRow)
  await ui.unmount()

  const script = '/private/tmp/bg-indicator/id0/follow.command'
  expect(written).toHaveLength(1)
  expect(written[0]?.path).toBe(script)
  expect(written[0]?.text).toContain("tail -n 80 '/private/tmp/claude-1000/-work-app/sess1/tasks/id0.output'")
  expect(ran).toEqual([
    ['/bin/chmod', '755', script],
    ['/usr/bin/open', '-a', 'Terminal', script],
  ])
})

test('on Linux the first terminal found is started without a shell string', async ($, on) => {
  const ran: string[][] = []
  on('classic.Stop', () => ({}))
  session(on)
  on('fs.list', () => ({ value: [dir('claude-1000')] }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 2, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: 'x\n' }))
  // No `open`; only gnome-terminal among the terminals; everything else exists.
  on('fs.exists', (_, e) => ({ value: e.path !== '/usr/bin/open' && !e.path.includes('/usr/bin/x-terminal-emulator') }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return exited(0)
  })
  await stopWith($, [{ type: 'shell', text: 'Deploy' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press(termRow)
  await ui.unmount()

  expect(ran).toEqual([
    [
      'sh',
      '-c',
      'nohup "$0" "$@" >/dev/null 2>&1 &',
      '/usr/bin/gnome-terminal',
      '--',
      'sh',
      '/private/tmp/bg-indicator/id0/follow.command',
    ],
  ])
})

test('when no terminal can be started the user is told, in their language', async ($, on) => {
  const toasts: string[] = []
  on('classic.Stop', () => ({}))
  session(on)
  on('fs.list', () => ({ value: [dir('claude-1000')] }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 2, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: 'x\n' }))
  on('fs.exists', (_, e) => ({ value: e.path.endsWith('.output') || e.path === '/private/tmp' }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => exited(1))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await stopWith($, [{ type: 'shell', text: 'Deploy' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press(termRow)
  await ui.unmount()
  expect(toasts).toEqual(['No terminal found'])
})

test('no terminal is started for a task without a log file or with an unsafe id', async ($, on) => {
  const ran: string[][] = []
  const written: string[] = []
  on('classic.Stop', () => ({}))
  session(on)
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_, e) => {
    written.push(e.path)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return exited(0)
  })
  on('ui.toast', () => ({ value: undefined }))
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'id0', type: 'shell', status: 'running', description: 'No file' },
      { id: 'x;touch pwned', type: 'shell', status: 'running', description: 'Evil' },
    ],
  })
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press(termRow)
  await $.ui.press({ plugin: 'bg-indicator', key: 'term-x;touch pwned', surface: 'terminal' })
  await ui.unmount()
  expect(ran).toEqual([])
  expect(written).toEqual([])
})

// ── Small type, narrow band, arrows ──────────────────────────────────────────

const narrow = (columns: number) => ({ ...BAND, props: { ...BAND.props, bodyColumns: columns } }) as const

test('the band is drawn in small type so it takes little room in the chat', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  logFiles(on, 'line 1\nline 2\n', 14)
  await stopWith($, [
    { type: 'shell', text: 'One' },
    { type: 'shell', text: 'Two' },
  ])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  const size = async (query: { type: string; text: RegExp }) => (await ui.find(query))?.props['size']
  expect(await size({ type: 'Text', text: /Background Tasks/ })).toBe('caption')
  expect(await size({ type: 'Text', text: /^1\. One/ })).toBe('footnote')
  expect(await size({ type: 'Text', text: /line 2/ })).toBe('caption')
  expect((await ui.find({ type: 'Text', text: /line 2/ }))?.props['mono']).toBe(true)
  await ui.unmount()
})

test('log lines are cut to the width of the band so none wraps', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  logFiles(on, `${'x'.repeat(90)}\n`, 92)
  await stopWith($, [{ type: 'shell', text: 'A very long description of a task that would wrap in a narrow band' }])
  await toggle($)

  // The band of the VS Code panel is about 49 columns wide.
  const ui = await $.ui.mount({ ...narrow(49), surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  const row = (await ui.find({ type: 'Text', text: /^1\. / }))?.text ?? ''
  // The title is drawn whole up to 120 columns and wraps inside its own box, so the buttons keep their place.
  expect(Array.from(row).length).toBeLessThanOrEqual(120 + 4)
  const log_ = (await ui.findAll({ type: 'Text', text: /^ x+/ })).map(t => t.text)
  expect(log_).toHaveLength(1)
  expect(Array.from(log_[0] ?? '').length).toBeLessThanOrEqual(1 + 41)
  expect(log_[0]?.endsWith('…')).toBe(true)
  await ui.unmount()
})

test('the arrow buttons move the open log by five lines, and the follow button returns to the end', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  logFiles(on, longLog)
  await stopWith($, [{ type: 'shell', text: 'Long job' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  const first = async () => (await gutter(ui))[0]
  const press = (key: string) => $.ui.press({ plugin: 'bg-indicator', key, surface: 'terminal' })

  expect(await first()).toBe(' line 31')
  expect(await ui.find({ type: 'Button', key: 'follow' })).toBeUndefined()
  await press('up')
  expect(await first()).toBe(' line 26')
  expect(await ui.find({ type: 'Button', key: 'follow' })).toBeDefined()
  await press('up')
  await press('up')
  expect(await first()).toBe(' line 16')
  await press('down')
  expect(await first()).toBe(' line 21')
  await press('follow')
  expect(await first()).toBe(' line 31')
  // Going down from the end changes nothing, and the arrows are offered only when the log is longer than the window.
  await press('down')
  expect(await first()).toBe(' line 31')
  await ui.unmount()
})

test('a log that fits in the window has no arrows', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  logFiles(on, 'line 1\nline 2\n', 14)
  await stopWith($, [{ type: 'shell', text: 'Short' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'up' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'down' })).toBeUndefined()
  await ui.unmount()
})

test('unfolding a row whose title is cut shows the full title, whatever the pointer does', async ($, on) => {
  on('classic.Stop', () => ({}))
  session(on)
  logFiles(on, 'line 1\n', 14)
  const long = 'Formater, restaurer les fichiers non liés et déployer API et interface sur le LAB puis relancer le test complet de bout en bout avec les nouveaux filtres de période et d auteur, vérifier les exports et nettoyer ensuite tous les documents de test'
  await stopWith($, [{ type: 'shell', text: long }])
  await toggle($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'bg-indicator', key: 'task-id0', surface: 'terminal' })
  const titles = await ui.findAll({ type: 'Text', text: /nettoyer ensuite tous les documents de test\s*$/ })
  expect(titles.some(x => x.text.trim() === long)).toBe(true)
  await ui.unmount()
})

test('a title is kept on one row: cut without an ellipsis, a "…" button after it', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [{ type: 'shell', text: 'a'.repeat(110) }, { type: 'shell', text: 'Short' }])
  await toggle($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const row = (await ui.find({ type: 'Text', text: /^1\. a+/ }))?.text ?? ''
  expect(row.includes('…')).toBe(false)
  expect(row).toBe(`1. ${'a'.repeat(45)} `)
  expect(await ui.find({ type: 'Button', key: 'more-id0' })).toBeDefined()
  // A title that fits has no such button.
  expect(await ui.find({ type: 'Button', key: 'more-id1' })).toBeUndefined()
  await ui.unmount()
})

test('the "…" button opens the cut title in full under its row, and closes it again', async ($, on) => {
  on('classic.Stop', () => ({}))
  const long = 'Formater, restaurer les fichiers non liés et déployer API et interface sur le LAB puis relancer le test complet de bout en bout avec les nouveaux filtres de période et d auteur, vérifier les exports et nettoyer ensuite tous les documents de test'
  await stopWith($, [{ type: 'shell', text: long }])
  await toggle($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const whole = /^ +Formater.*nettoyer ensuite tous les documents de test$/
  expect(await ui.find({ type: 'Text', text: whole })).toBeUndefined()
  await $.ui.press({ plugin: 'bg-indicator', key: 'more-id0', surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: whole }))?.text).toBe(`   ${long}`)
  await $.ui.press({ plugin: 'bg-indicator', key: 'more-id0', surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: whole })).toBeUndefined()
  await ui.unmount()
})

test('detaching commands are recognised, tracked ones are not', () => {
  for (const c of ['nohup sh run.sh > log &', 'sleep 5 &', '(server &)', 'setsid job', 'job & disown', 'a; b &']) expect(detaches(c)).toBe(true)
  for (const c of ['ls && echo ok', 'cmd 2>&1', 'a | b', 'echo "a & b"x', 'npm run build']) expect(detaches(c)).toBe(false)
})

test('block mode refuses a detaching command, and lets a tracked or plain one through', { options: { trackBackground: 'block' } }, async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran', text: 'ran' }))
  const refused = await $.tool.call({ tool: 'Bash', command: 'nohup sh tunnel.sh > log 2>&1 &' })
  expect(refused.deny).toContain('run_in_background')
  const tracked = await $.tool.call({ tool: 'Bash', command: 'sh tunnel.sh', run_in_background: true })
  expect(tracked.text).toBe('ran')
  const plain = await $.tool.call({ tool: 'Bash', command: 'echo ok' })
  expect(plain.text).toBe('ran')
})

test('the default mode never refuses a command', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran', text: 'ran' }))
  const result = await $.tool.call({ tool: 'Bash', command: 'sleep 1 &' })
  expect(result.text).toBe('ran')
})
