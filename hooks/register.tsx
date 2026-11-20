import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Task } from '../types'

const tasks = atom({ plugin: 'bg-indicator', key: 'tasks' } as const, [] as Task[])
const frame = atom({ plugin: 'bg-indicator', key: 'frame' } as const, 0)
const expanded = atom({ plugin: 'bg-indicator', key: 'expanded' } as const, false)

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const MAX_WIDTH = 60
/** Rows of the unfolded list; the rest is summarised so a long list never pushes the prompt off the screen. */
const MAX_ROWS = 10

// ── Languages ────────────────────────────────────────────────────────────────
// The only text the mod writes itself is one word. Task descriptions come from the
// session and are shown as they are, in any script. To add a language, add a line to
// MESSAGES (key = lowercase language code) and one to ALIASES.
const MESSAGES: Record<string, string> = {
  en: 'Background',
  fr: 'Arrière-plan',
  es: 'Segundo plano',
  de: 'Hintergrund',
  pt: 'Segundo plano',
  it: 'In background',
  nl: 'Op de achtergrond',
  pl: 'W tle',
  sv: 'Bakgrund',
  tr: 'Arka plan',
  ru: 'Фон',
  uk: 'Фон',
  ja: 'バックグラウンド',
  zh: '后台',
  'zh-tw': '背景',
  ko: '백그라운드',
  vi: 'Nền',
  id: 'Latar belakang',
}

// A code matches alone or followed by a separator (fr, fr_FR.UTF-8, fr-CA); a name matches as a prefix.
const alias = (code: string, names: string[]) => ({
  code,
  re: new RegExp(`^(?:${code}(?:[-_.@:]|$)|(?:${names.join('|')}))`, 'i'),
})
const ALIASES = [
  alias('zh[-_]?(?:tw|hk|hant)', ['traditional chinese', '繁體中文', '繁体中文']),
  alias('en', ['english']),
  alias('fr', ['fran[cç]ais', 'french']),
  alias('es', ['espa[nñ]ol', 'spanish', 'castellano']),
  alias('de', ['deutsch', 'german']),
  alias('pt', ['portugu[eê]s', 'portuguese']),
  alias('it', ['italiano', 'italian']),
  alias('nl', ['nederlands', 'dutch']),
  alias('pl', ['polski', 'polish']),
  alias('sv', ['svenska', 'swedish']),
  alias('tr', ['t[üu]rk[cç]e', 'turkish']),
  alias('ru', ['русский', 'russian']),
  alias('uk', ['українська', 'ukrainian']),
  alias('ja', ['日本語', 'japanese']),
  alias('zh', ['中文', '简体中文', 'chinese']),
  alias('ko', ['한국어', 'korean']),
  alias('vi', ['vietnamese', 'ti.ng vi.t']),
  alias('id', ['bahasa indonesia', 'indonesian']),
].map(({ code, re }) => ({ code: code.startsWith('zh[') ? 'zh-tw' : code, re }))

/** First candidate that names a known language (Claude Code's `language` setting, then the locale variables). */
export const pickLanguage = (...candidates: (string | undefined)[]): string => {
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (!value) continue
    const hit = ALIASES.find(a => a.re.test(value))
    if (hit) return hit.code
  }
  return 'en'
}

export const wordFor = (language: string) => MESSAGES[language] ?? MESSAGES['en'] ?? 'Background'

// ── Text width ───────────────────────────────────────────────────────────────
// CJK characters and emoji take two terminal columns; clipping by columns, and by whole characters
// (never half of a surrogate pair), keeps the band on one line in every script.
const isWide = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe6f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1faff) ||
  (cp >= 0x20000 && cp <= 0x3fffd)

const widthOf = (ch: string) => (isWide(ch.codePointAt(0) ?? 0) ? 2 : 1)

export const clip = (text: string, max: number) => {
  const chars = Array.from(text)
  if (chars.reduce((sum, ch) => sum + widthOf(ch), 0) <= max) return text
  let used = 0
  let out = ''
  for (const ch of chars) {
    if (used + widthOf(ch) > max - 1) break
    used += widthOf(ch)
    out += ch
  }
  return out + '…'
}

type Describable = { description?: string; command?: string; type?: string }

/** What the engine calls the task (`shell`, `subagent`, `monitor`, `workflow`), or a guess from the tool that started it. */
export const kindOfTool = (tool: string) =>
  tool === 'Monitor' ? 'monitor' : tool === 'Agent' || tool === 'Task' ? 'subagent' : 'shell'

export const labelOf = (item: Describable) =>
  clip((item.description || item.command || item.type || 'task').replace(/\s+/g, ' ').trim(), MAX_WIDTH)

/** A wake-up that will resume the session later: shown with a clock and the prompt it will submit. */
export const scheduledLabel = (prompt: string) =>
  `⏰ ${clip((prompt || 'scheduled').replace(/\s+/g, ' ').trim(), MAX_WIDTH - 3)}`

export const register: Register = on => {
  let word = wordFor('en')

  on('session.start', async ($, e, next) => {
    try {
      const setting = await $.settings.read({ key: 'language' })
      word = wordFor(
        pickLanguage(
          typeof setting === 'string' ? setting : undefined,
          await $.env.get('LC_ALL'),
          await $.env.get('LC_MESSAGES'),
          await $.env.get('LANG'),
        ),
      )
    } catch {
      word = wordFor('en')
    }

    // Animate (and so redraw) only while something is running.
    $.clock.every(900, async () => {
      if ((await read($, tasks)).length > 0) {
        await update($, frame, f => (f + 1) % FRAMES.length)
      }
    })

    return next(e)
  })

  // Optimistic start: a tool call that moves work to the background shows up at once.
  on('classic.PostToolUse', async ($, e, next) => {
    const input = e.tool_input as (Describable & { run_in_background?: boolean }) | null
    if (input && (input.run_in_background === true || e.tool_name === 'Monitor')) {
      await update($, tasks, list =>
        list.some(t => t.id === e.tool_use_id)
          ? list
          : [...list, { id: e.tool_use_id, label: labelOf(input), kind: kindOfTool(e.tool_name) }],
      )
    }

    return next(e)
  })

  // Authoritative state, read every time control returns to the user: the engine lists the background work
  // still in flight and the wake-ups scheduled to resume the session later (ScheduleWakeup, /loop, cron).
  // Either one means "something is still going on", even though the prompt looks idle.
  on('classic.Stop', async ($, e, next) => {
    if (Array.isArray(e.background_tasks) || Array.isArray(e.session_crons)) {
      const running = (e.background_tasks ?? []).map(t => ({ id: t.id, label: labelOf(t), kind: t.type || 'task' }))
      const scheduled = (e.session_crons ?? []).map(c => ({
        id: c.id,
        label: scheduledLabel(c.prompt),
        kind: c.recurring ? 'recurring' : 'wake-up',
      }))
      const all = [...running, ...scheduled]
      await update($, tasks, () => all)
      if (all.length === 0) await update($, expanded, () => false)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, tasks)
    const first = list[0]
    if (!first) {
      return next(e)
    }

    const f = await read($, frame)
    const isOpen = await read($, expanded)
    const { Box, Button, Text } = $.ui.resolve(e)
    const more = list.length > 1 ? ` (+${list.length - 1})` : ''
    const shown = list.slice(0, MAX_ROWS)
    const hidden = list.length - shown.length

    const header = (
      <Box>
        <Text color="yellow">{FRAMES[f] ?? FRAMES[0]} </Text>
        <Text bold color="yellow">
          {word}{' '}
        </Text>
        <Text>{first.label}</Text>
        <Text dimColor>{more} </Text>
        <Button key="toggle" label={isOpen ? '▾' : `▸ ${list.length}`} onPress={() => update($, expanded, v => !v)} />
      </Box>
    )

    if (!isOpen) {
      return header
    }

    return (
      <Box flexDirection="column">
        {header}
        {shown.map((t, i) => (
          <Box key={t.id}>
            <Text dimColor>{`  ${i + 1}. [${t.kind}] `}</Text>
            <Text>{t.label}</Text>
          </Box>
        ))}
        {hidden > 0 ? <Text dimColor>{`  … +${hidden}`}</Text> : null}
      </Box>
    )
  })
}
