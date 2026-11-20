import { expect, test } from 'claude-code/testing'

import { clip, pickLanguage, wordFor } from '../hooks/register'

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
  on('classic.Stop', (_, e) => ({}))
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
  expect((await ui.find({ type: 'Text', text: /\+1/ }))?.text).toBe(' (+1)')
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
