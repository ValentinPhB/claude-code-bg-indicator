import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LogView, Task, Where } from '../types'

const tasks = atom({ plugin: 'bg-indicator', key: 'tasks' } as const, [] as Task[])
const frame = atom({ plugin: 'bg-indicator', key: 'frame' } as const, 0)
const expanded = atom({ plugin: 'bg-indicator', key: 'expanded' } as const, false)
const viewing = atom({ plugin: 'bg-indicator', key: 'viewing' } as const, null as string | null)
const log = atom({ plugin: 'bg-indicator', key: 'log' } as const, null as LogView | null)
/** First visible line of the open log, or null while it follows the end (the live tail). */
const logTop = atom({ plugin: 'bg-indicator', key: 'logTop' } as const, null as number | null)

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
/** Longest title kept for a task: the band cuts it to fit, the hover shows it in full, so the text is never lost. */
const MAX_TITLE = 400
/** Rows of the unfolded list; the rest is summarised so a long list never pushes the prompt off the screen. */
const MAX_ROWS = 10
/** One task's log: how many of its last lines are kept, how many show at once, and how wide they may be. */
const LOG_KEEP = 300
const LOG_WINDOW = 10
const LOG_WIDTH = 100
const LOG_BYTES = 32768

// ── Languages ────────────────────────────────────────────────────────────────
// The only text the mod writes itself is a few short phrases. Task descriptions come from the
// session and are shown as they are, in any script. To add a language, add a line to
// MESSAGES (key = lowercase language code) and one to ALIASES.
export type Texts = {
  tasks: string
  noLog: string
  empty: string
  noTerminal: string
}

const MESSAGES: Record<string, Texts> = {
  en: { tasks: 'Background Tasks', noLog: 'No log available', empty: 'Log is empty', noTerminal: 'No terminal found' },
  fr: { tasks: 'Tâches en arrière-plan', noLog: 'Aucun journal disponible', empty: 'Journal vide', noTerminal: 'Aucun terminal trouvé' },
  es: { tasks: 'Tareas en segundo plano', noLog: 'Sin registro disponible', empty: 'Registro vacío', noTerminal: 'No se encontró un terminal' },
  de: { tasks: 'Hintergrundaufgaben', noLog: 'Kein Protokoll verfügbar', empty: 'Protokoll ist leer', noTerminal: 'Kein Terminal gefunden' },
  pt: { tasks: 'Tarefas em segundo plano', noLog: 'Nenhum registro disponível', empty: 'Registro vazio', noTerminal: 'Nenhum terminal encontrado' },
  it: { tasks: 'Attività in background', noLog: 'Nessun log disponibile', empty: 'Log vuoto', noTerminal: 'Nessun terminale trovato' },
  nl: { tasks: 'Achtergrondtaken', noLog: 'Geen log beschikbaar', empty: 'Log is leeg', noTerminal: 'Geen terminal gevonden' },
  pl: { tasks: 'Zadania w tle', noLog: 'Brak dziennika', empty: 'Dziennik jest pusty', noTerminal: 'Nie znaleziono terminala' },
  sv: { tasks: 'Bakgrundsuppgifter', noLog: 'Ingen logg tillgänglig', empty: 'Loggen är tom', noTerminal: 'Ingen terminal hittades' },
  tr: { tasks: 'Arka plan görevleri', noLog: 'Günlük yok', empty: 'Günlük boş', noTerminal: 'Terminal bulunamadı' },
  ru: { tasks: 'Фоновые задачи', noLog: 'Журнал недоступен', empty: 'Журнал пуст', noTerminal: 'Терминал не найден' },
  uk: { tasks: 'Фонові завдання', noLog: 'Журнал недоступний', empty: 'Журнал порожній', noTerminal: 'Термінал не знайдено' },
  ja: { tasks: 'バックグラウンドタスク', noLog: 'ログはありません', empty: 'ログは空です', noTerminal: 'ターミナルが見つかりません' },
  zh: { tasks: '后台任务', noLog: '没有可用日志', empty: '日志为空', noTerminal: '未找到终端' },
  'zh-tw': { tasks: '背景任務', noLog: '沒有可用的記錄', empty: '記錄是空的', noTerminal: '找不到終端機' },
  ko: { tasks: '백그라운드 작업', noLog: '사용 가능한 로그가 없습니다', empty: '로그가 비어 있습니다', noTerminal: '터미널을 찾을 수 없습니다' },
  vi: { tasks: 'Tác vụ nền', noLog: 'Không có nhật ký', empty: 'Nhật ký trống', noTerminal: 'Không tìm thấy terminal' },
  id: { tasks: 'Tugas latar belakang', noLog: 'Log tidak tersedia', empty: 'Log kosong', noTerminal: 'Terminal tidak ditemukan' },
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

const FALLBACK: Texts = {
  tasks: 'Background Tasks',
  noLog: 'No log available',
  empty: 'Log is empty',
  noTerminal: 'No terminal found',
}

export const textsFor = (language: string): Texts => MESSAGES[language] ?? MESSAGES['en'] ?? FALLBACK

/** The label of the band, in the given language. */
export const wordFor = (language: string) => textsFor(language).tasks

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

/** A task kept by an older version of the mod may lack its kind: it is shown as a plain `task`, never as `undefined`. */
export const kindOf = (task: { kind?: string | undefined }) => task.kind || 'task'

export const labelOf = (item: Describable) =>
  clip((item.description || item.command || item.type || 'task').replace(/\s+/g, ' ').trim(), MAX_TITLE)

/** A wake-up that will resume the session later: shown with a clock and the prompt it will submit. */
export const scheduledLabel = (prompt: string) =>
  `⏰ ${clip((prompt || 'scheduled').replace(/\s+/g, ' ').trim(), MAX_TITLE - 3)}`

// ── Logs ─────────────────────────────────────────────────────────────────────
// Claude Code keeps the output of each background task in a file of its session's temporary folder. The mod
// looks for it there and shows its last lines. That layout belongs to Claude Code, not to a documented API,
// so the lookup is best effort: when the file is not found the row says so instead of failing.

/** Claude Code names a project's folder after its directory, every character that is not a letter or digit becoming `-`. */
export const projectKey = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-')

/** Where a task's output file is, given the temporary root and the entry (`claude-<uid>`) found under it. */
export const outputPath = (root: string, entry: string, where: Where, id: string) =>
  `${root}/${entry}/${projectKey(where.cwd)}/${where.session}/tasks/${id}.output`

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g

/** The last non-empty lines of a text, without colour codes or control characters, each clipped by columns. */
export const tailLines = (text: string, maxLines: number, maxWidth: number): string[] => {
  const lines = text
    .replace(ANSI, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .split('\n')
  while (lines.length > 0 && (lines.at(-1) ?? '').trim() === '') lines.pop()

  return lines.slice(-maxLines).map(line => clip(line, maxWidth))
}

/**
 * Where the log window starts after the wheel (or an arrow key) asks to move it by `by` lines. `null` means the end:
 * the window follows the live tail. Scrolling up leaves the end; scrolling back down to it rejoins the tail.
 */
export const scrollTop = (total: number, size: number, top: number | null, by: number): number | null => {
  const last = Math.max(0, total - size)
  const next = Math.min(last, Math.max(0, (top ?? last) + by))

  return next >= last ? null : next
}

/** The lines the window shows: from `start` (included) to `end` (excluded). */
export const visibleRange = (total: number, size: number, top: number | null) => {
  const last = Math.max(0, total - size)
  const start = top === null ? last : Math.min(top, last)

  return { start, end: Math.min(total, start + size) }
}

/** Which rows of the scrollbar are the thumb (where the window stands in the log); the rest is the track. */
export const scrollbar = (total: number, size: number, start: number, rows: number): boolean[] => {
  if (total <= size || rows <= 0) return Array.from({ length: Math.max(0, rows) }, () => false)
  const thumb = Math.min(rows, Math.max(1, Math.round((rows * size) / total)))
  const last = total - size
  const at = Math.round((Math.min(start, last) * (rows - thumb)) / last)

  return Array.from({ length: rows }, (_, i) => i >= at && i < at + thumb)
}

// ── Open a task's log in a terminal window ───────────────────────────────────
// A terminal window runs a fixed command that follows the log with `watch` (or `tail -f` where `watch` is not
// installed). Only a task id made of letters, digits, `_` and `-` and a file path made of letters, digits and `/._-`
// ever reach the command, and the command is fixed.

export const isSafeId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

export const isSafePath = (path: string) => /^\/[A-Za-z0-9/._-]{1,400}$/.test(path) && !path.includes('..')

const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

/** What the VS Code terminal runs to follow a log file. */
export const followCommand = (file: string) =>
  `if command -v watch >/dev/null 2>&1; then exec watch -n 1 -t tail -n 80 ${quote(file)}; else exec tail -n 200 -f ${quote(file)}; fi`

/** The script a terminal window runs to follow a log: it names the window, then follows the file. */
export const followScript = (title: string, file: string) =>
  `#!/bin/sh\nprintf '\\033]0;%s\\007' ${quote(title)}\n${followCommand(file)}\n`

/** Terminals of a Linux desktop and the arguments that make each one run a script, tried in this order. */
export const LINUX_TERMINALS: readonly { path: string; args: (script: string) => string[] }[] = [
  { path: '/usr/bin/x-terminal-emulator', args: script => ['-e', 'sh', script] },
  { path: '/usr/bin/gnome-terminal', args: script => ['--', 'sh', script] },
  { path: '/usr/bin/konsole', args: script => ['-e', 'sh', script] },
  { path: '/usr/bin/xfce4-terminal', args: script => ['-e', `sh ${script}`] },
  { path: '/usr/bin/xterm', args: script => ['-e', 'sh', script] },
]

/** The only task whose log is read on a tick: the one the user opened, and only while the list is unfolded. */
export const refreshTarget = (isOpen: boolean, viewingId: string | null, list: readonly Task[]) =>
  isOpen && viewingId !== null ? list.find(t => t.id === viewingId) : undefined

const ROOTS = ['/private/tmp', '/tmp'] as const

/** The output file of a task, or undefined; `tried` is the first path looked for. */
const findOutput = async ($: EngineInterface, places: Where[], id: string): Promise<{ file?: string; tried: string | null }> => {
  let tried: string | null = null
  for (const place of places) {
    for (const root of ROOTS) {
      const entries = await $.fs.list(root).catch(() => [])
      for (const entry of entries) {
        if (entry.kind !== 'dir' || !entry.name.startsWith('claude-')) continue
        const path = outputPath(root, entry.name, place, id)
        tried ??= path
        if (await $.fs.exists(path).catch(() => false)) return { file: path, tried }
      }
    }
  }

  return { tried }
}

/** The last lines of an output file, or undefined when it cannot be read. */
const readTail = async ($: EngineInterface, file: string): Promise<string[] | undefined> => {
  const size = (await $.fs.stat(file).catch(() => undefined))?.size ?? 0
  const offset = Math.max(0, size - LOG_BYTES)
  const text = await $.fs.read(file, { offset, length: LOG_BYTES }).catch(() => undefined)
  if (text === undefined) return undefined
  // A read that starts mid-file begins in the middle of a line: drop that partial line.
  const whole = offset > 0 ? text.slice(text.indexOf('\n') + 1) : text

  return tailLines(whole, LOG_KEEP, LOG_WIDTH)
}

/** The session as the engine knows it now: its id and its working directory (the folder name may follow either). */
const placesOf = async ($: EngineInterface): Promise<Where[]> => {
  const session = await $.session.id()
  const cwds = [await $.session.cwd(), await $.session.root()]

  return [...new Set(cwds)].map(cwd => ({ session, cwd }))
}

const logOf = async ($: EngineInterface, task: Task): Promise<LogView> => {
  if (task.detail !== undefined) {
    return { id: task.id, lines: tailLines(task.detail, LOG_KEEP, LOG_WIDTH), note: null, tried: null }
  }
  const { file, tried } = await findOutput($, await placesOf($), task.id)
  const lines = file === undefined ? undefined : await readTail($, file)
  if (lines === undefined) return { id: task.id, lines: [], note: 'none', tried }

  return { id: task.id, lines, note: lines.length === 0 ? 'empty' : null, tried }
}

/** Opens a terminal window that follows the task's log: Terminal on macOS, the first terminal found on Linux. */
const openTerminal = async ($: EngineInterface, task: Task, texts: Texts) => {
  if (!isSafeId(task.id) || task.detail !== undefined) {
    await $.ui.toast(texts.noLog)
    return
  }
  const { file } = await findOutput($, await placesOf($), task.id)
  if (file === undefined || !isSafePath(file)) {
    await $.ui.toast(texts.noLog)
    return
  }
  const root = (await $.fs.exists(ROOTS[0]).catch(() => false)) ? ROOTS[0] : ROOTS[1]
  const script = `${root}/bg-indicator/${task.id}/follow.command`
  await $.fs.write(script, followScript(task.label, file))
  if (await $.fs.exists('/usr/bin/open').catch(() => false)) {
    await $.process.run(['/bin/chmod', '755', script]).catch(() => undefined)
    const result = await $.process.run(['/usr/bin/open', '-a', 'Terminal', script], { timeoutMs: 20000 }).catch(() => undefined)
    if (result === undefined || result.exitCode !== 0) await $.ui.toast(texts.noTerminal)
    return
  }
  for (const terminal of LINUX_TERMINALS) {
    if (!(await $.fs.exists(terminal.path).catch(() => false))) continue
    // `sh -c` takes the terminal and its arguments as separate words: nothing is spliced into the shell text.
    const started = await $.process
      .run(['sh', '-c', 'nohup "$0" "$@" >/dev/null 2>&1 &', terminal.path, ...terminal.args(script)], { timeoutMs: 20000 })
      .catch(() => undefined)
    if (started !== undefined && started.exitCode === 0) return
  }
  await $.ui.toast(texts.noTerminal)
}

/** True for a shell command that detaches a process from Claude Code: nohup, setsid, disown or a trailing `&` (not `&&`, `>&`, `|&`). */
export const detaches = (command: string): boolean =>
  /\b(nohup|setsid|disown)\b/.test(command) || /(^|[^&>|])&\s*(\)|\}|;|$)/m.test(command)

const TRACK_RULE =
  'Background work: start any long-running or detached process (servers, tunnels, watchers, long builds or tests) with the Bash tool\'s run_in_background option, never with `&`, `nohup`, `setsid` or `disown`: only a process started that way is tracked by Claude Code, shown in the background tasks band and reported when it ends. Say what runs in the background each time you hand control back.'

export const register: Register = (on, options) => {
  let texts = textsFor('en')
  const track = typeof options['trackBackground'] === 'string' ? options['trackBackground'] : 'remind'

  // remind (default) and block: tell the model to use run_in_background so every background task is tracked and shown.
  if (track !== 'off') {
    on('prompt.compose', async (_$, e, next) => {
      const composed = await next(e)
      return { sections: [...composed.sections, { id: 'bg-indicator:track', text: TRACK_RULE, scope: 'session' as const }] }
    })
  }
  // block: also refuse a Bash command that detaches a process, with the reason, so it is retried tracked.
  if (track === 'block') {
    on('tool.call', { tool: 'Bash' }, (_$, e, next) =>
      e.run_in_background !== true && detaches(e.command)
        ? { deny: 'bg-indicator: this command detaches a process Claude Code cannot track. Run it again with run_in_background set to true instead of `&`, `nohup`, `setsid` or `disown`.' }
        : next(e),
    ).catch((_$, e, next) => (next.called ? next(e) : { deny: 'bg-indicator: its guard failed.' }))
  }

  on('session.start', async ($, e, next) => {
    try {
      const setting = await $.settings.read({ key: 'language' })
      texts = textsFor(
        pickLanguage(
          typeof setting === 'string' ? setting : undefined,
          await $.env.get('LC_ALL'),
          await $.env.get('LC_MESSAGES'),
          await $.env.get('LANG'),
        ),
      )
    } catch {
      texts = textsFor('en')
    }

    // Animate (and so redraw) only while something is running; keep an open log fresh.
    $.clock.every(900, async () => {
      const list = await read($, tasks)
      if (list.length === 0) return
      await update($, frame, f => (f + 1) % FRAMES.length)
      // Nothing is read unless the list is open on a row the user pressed: that one file, nothing else.
      const task = refreshTarget(await read($, expanded), await read($, viewing), list)
      if (task) {
        const view = await logOf($, task)
        await update($, log, () => view)
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
        detail: `${c.schedule}\n${c.prompt}`,
      }))
      const all = [...running, ...scheduled]
      await update($, tasks, () => all)
      if (all.length === 0) await update($, expanded, () => false)
      const id = await read($, viewing)
      if (id !== null && !all.some(t => t.id === id)) {
        await update($, viewing, () => null)
        await update($, log, () => null)
        await update($, logTop, () => null)
      }
    }

    return next(e)
  })

  // The wheel (or an arrow key while the band is focused) scrolls the open log, not the whole band.
  on('ui.scroll', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, log)
    if (view !== null && view.note === null && view.lines.length > LOG_WINDOW && e.by !== 0) {
      await update($, logTop, top => scrollTop(view.lines.length, LOG_WINDOW, top, e.by))
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
    const openId = await read($, viewing)
    const view = await read($, log)
    const top = await read($, logTop)
    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = list.slice(0, MAX_ROWS)
    const hidden = list.length - shown.length
    // The band is narrow (about 50 columns in VS Code): every line is cut to fit, so none wraps and the rows stay aligned.
    const columns = e.props.bodyColumns
    const titleBox = Math.max(16, columns - 14)
    const lineWidth = Math.max(16, columns - 8)
    // A title that does not fit on its one line is cut with an ellipsis; hover or unfold shows it whole.
    const isCut = (label: string) => label.length + 4 > titleBox

    // Folding the list closes the open log too, so nothing keeps being read behind a folded band.
    const flip = async (wasOpen: boolean) => {
      if (wasOpen) {
        await update($, viewing, () => null)
        await update($, log, () => null)
        await update($, logTop, () => null)
      }
      await update($, expanded, () => !wasOpen)
    }

    // One task: its own description. Several: just their number, the list is one press away.
    const header = (
      <Box>
        <Text color="yellow" size="caption">{FRAMES[f] ?? FRAMES[0]} </Text>
        <Text bold color="yellow" size="caption">{texts.tasks}{' '}</Text>
        <Text size="caption">{`(${list.length})`}{' '}</Text>
        <Button key="toggle" label={isOpen ? '▴' : '▾'} onPress={() => flip(isOpen)}>
          <Text size="caption">{isOpen ? '▴' : '▾'}</Text>
        </Button>
      </Box>
    )

    if (!isOpen) {
      return header
    }

    // Pressing the fold button of a row shows (or hides) the last lines of its log right under it.
    const press = async (task: Task) => {
      await update($, logTop, () => null)
      if ((await read($, viewing)) === task.id) {
        await update($, viewing, () => null)
        await update($, log, () => null)
        return
      }
      await update($, viewing, () => task.id)
      const loaded = await logOf($, task)
      await update($, log, () => loaded)
    }

    // The two arrows move the open log by a few lines, like the wheel does where the host sends it.
    const move = async (by: number, total: number) => {
      await update($, logTop, current => scrollTop(total, LOG_WINDOW, current, by))
    }

    return (
      <Box flexDirection="column">
        {header}
        {shown.map((t, i) => {
          const log_ = openId === t.id && view !== null && view.id === t.id ? view : null
          const range = log_ === null ? null : visibleRange(log_.lines.length, LOG_WINDOW, top)
          const thumb = log_ === null || range === null ? [] : scrollbar(log_.lines.length, LOG_WINDOW, range.start, range.end - range.start)
          const marker = log_ !== null && range !== null && log_.note === null && log_.lines.length > LOG_WINDOW

          return (
            <Box key={`row-${t.id}`} flexDirection="column">
              <Box>
                <Box width={titleBox}>
                  <Text size="footnote" wrap="truncate-end">{`${i + 1}. ${t.label} `}</Text>
                </Box>
                {isCut(t.label) ? (
                  // The title is cut to fit the band: the full text appears over the row while the pointer is on it.
                  <Box position="absolute" top={1} left={2} display="none" hover={{ display: 'flex' }} borderStyle="round" paddingX={1} width={Math.max(20, columns - 4)}>
                    <Text size="footnote">{t.label}</Text>
                  </Box>
                ) : null}
                <Button key={`task-${t.id}`} label={openId === t.id ? '▴' : '▾'} onPress={() => press(t)}>
                  <Text size="footnote">{openId === t.id ? '▴' : '▾'}</Text>
                </Button>
                {t.detail === undefined ? <Text size="footnote"> </Text> : null}
                {t.detail === undefined ? (
                  <Button key={`term-${t.id}`} label=">_" onPress={() => openTerminal($, t, texts)}>
                    <Text size="footnote">{'>_'}</Text>
                  </Button>
                ) : null}
              </Box>
              {openId === t.id && isCut(t.label) ? (
                // Always readable, whatever the pointer does: the unfolded row carries the full title.
                <Text dimColor size="caption">{`   ${t.label}`}</Text>
              ) : null}
              {log_ !== null && range !== null ? (
                <Box flexDirection="column">
                  {log_.note === null
                    ? log_.lines.slice(range.start, range.end).map((line, n) => (
                        <Box key={`log-${t.id}-${n}`}>
                          <Text dimColor size="caption" mono>{'   '}</Text>
                          {thumb[n] === true ? <Text color="cyan" size="caption" mono>┃</Text> : <Text dimColor size="caption" mono>│</Text>}
                          <Text dimColor size="caption" mono>{` ${clip(line, lineWidth)}`}</Text>
                        </Box>
                      ))
                    : <Text dimColor size="caption">{`   ${log_.note === 'empty' ? texts.empty : texts.noLog}`}</Text>}
                  {marker && range !== null ? (
                    <Box>
                      <Text dimColor size="caption">{`   ${range.start + 1}–${range.end} / ${log_.lines.length} `}</Text>
                      <Button key="up" label="↑" onPress={() => move(-5, log_.lines.length)}>
                        <Text size="caption">↑</Text>
                      </Button>
                      <Text size="caption"> </Text>
                      <Button key="down" label="↓" onPress={() => move(5, log_.lines.length)}>
                        <Text size="caption">↓</Text>
                      </Button>
                      {top !== null ? <Text size="caption"> </Text> : null}
                      {top !== null ? (
                        <Button key="follow" label="⤓" onPress={() => update($, logTop, () => null)}>
                          <Text size="caption">⤓</Text>
                        </Button>
                      ) : null}
                    </Box>
                  ) : null}
                  {log_.note === 'none' && log_.tried !== null ? <Text dimColor size="caption">{`   → ${clip(log_.tried, lineWidth)}`}</Text> : null}
                </Box>
              ) : null}
            </Box>
          )
        })}
        {hidden > 0 ? <Text dimColor size="caption">{`  … +${hidden}`}</Text> : null}
      </Box>
    )
  })
}
