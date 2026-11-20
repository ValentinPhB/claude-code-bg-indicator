import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { clip, kindOfTool, pickLanguage, scheduledLabel, wordFor } from '../hooks/register'

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
  expect((await open.find({ type: 'Text', text: /1\. \[shell\]/ }))?.text).toBe('  1. [shell] ')
  expect((await open.find({ type: 'Text', text: /2\. \[monitor\]/ }))?.text).toBe('  2. [monitor] ')
  expect((await open.find({ type: 'Text', text: /3\. \[subagent\]/ }))?.text).toBe('  3. [subagent] ')
  expect((await open.find({ type: 'Text', text: /Review the diff/ }))?.text).toBe('Review the diff')
  await open.unmount()

  await toggle($)
  const folded = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await folded.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▸ 3')
  expect(await folded.find({ type: 'Text', text: /Review the diff/ })).toBeUndefined()
  await folded.unmount()
})

test('a single task can be unfolded too', async ($, on) => {
  on('classic.Stop', () => ({}))
  await stopWith($, [{ type: 'shell', text: 'Only one' }])
  await toggle($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /1\. \[shell\]/ }))?.text).toBe('  1. [shell] ')
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
  expect(await ui.findAll({ type: 'Text', text: /\[shell\]/ })).toHaveLength(10)
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
  expect(await ui.find({ type: 'Text', text: /\[wake-up\]/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[recurring\]/ })).toBeDefined()
  await ui.unmount()
})

test('the kind of a task started by a tool call follows the tool', () => {
  expect(kindOfTool('Monitor')).toBe('monitor')
  expect(kindOfTool('Agent')).toBe('subagent')
  expect(kindOfTool('Bash')).toBe('shell')
})
