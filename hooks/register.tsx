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
const MAX_WIDTH = 60
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
export type Texts = { background: string; tasks: string; noLog: string; empty: string; noCode: string }

const MESSAGES: Record<string, Texts> = {
  en: { background: 'Background', tasks: 'Background Tasks', noLog: 'No log available', empty: 'Log is empty', noCode: 'VS Code not found' },
  fr: { background: 'Arrière-plan', tasks: 'Tâches en arrière-plan', noLog: 'Aucun journal disponible', empty: 'Journal vide', noCode: 'VS Code introuvable' },
  es: { background: 'Segundo plano', tasks: 'Tareas en segundo plano', noLog: 'Sin registro disponible', empty: 'Registro vacío', noCode: 'VS Code no encontrado' },
  de: { background: 'Hintergrund', tasks: 'Hintergrundaufgaben', noLog: 'Kein Protokoll verfügbar', empty: 'Protokoll ist leer', noCode: 'VS Code nicht gefunden' },
  pt: { background: 'Segundo plano', tasks: 'Tarefas em segundo plano', noLog: 'Nenhum registro disponível', empty: 'Registro vazio', noCode: 'VS Code não encontrado' },
  it: { background: 'In background', tasks: 'Attività in background', noLog: 'Nessun log disponibile', empty: 'Log vuoto', noCode: 'VS Code non trovato' },
  nl: { background: 'Op de achtergrond', tasks: 'Achtergrondtaken', noLog: 'Geen log beschikbaar', empty: 'Log is leeg', noCode: 'VS Code niet gevonden' },
  pl: { background: 'W tle', tasks: 'Zadania w tle', noLog: 'Brak dziennika', empty: 'Dziennik jest pusty', noCode: 'Nie znaleziono VS Code' },
  sv: { background: 'Bakgrund', tasks: 'Bakgrundsuppgifter', noLog: 'Ingen logg tillgänglig', empty: 'Loggen är tom', noCode: 'VS Code hittades inte' },
  tr: { background: 'Arka plan', tasks: 'Arka plan görevleri', noLog: 'Günlük yok', empty: 'Günlük boş', noCode: 'VS Code bulunamadı' },
  ru: { background: 'Фон', tasks: 'Фоновые задачи', noLog: 'Журнал недоступен', empty: 'Журнал пуст', noCode: 'VS Code не найден' },
  uk: { background: 'Фон', tasks: 'Фонові завдання', noLog: 'Журнал недоступний', empty: 'Журнал порожній', noCode: 'VS Code не знайдено' },
  ja: { background: 'バックグラウンド', tasks: 'バックグラウンドタスク', noLog: 'ログはありません', empty: 'ログは空です', noCode: 'VS Code が見つかりません' },
  zh: { background: '后台', tasks: '后台任务', noLog: '没有可用日志', empty: '日志为空', noCode: '未找到 VS Code' },
  'zh-tw': { background: '背景', tasks: '背景任務', noLog: '沒有可用的記錄', empty: '記錄是空的', noCode: '找不到 VS Code' },
  ko: { background: '백그라운드', tasks: '백그라운드 작업', noLog: '사용 가능한 로그가 없습니다', empty: '로그가 비어 있습니다', noCode: 'VS Code를 찾을 수 없습니다' },
  vi: { background: 'Nền', tasks: 'Tác vụ nền', noLog: 'Không có nhật ký', empty: 'Nhật ký trống', noCode: 'Không tìm thấy VS Code' },
  id: { background: 'Latar belakang', tasks: 'Tugas latar belakang', noLog: 'Log tidak tersedia', empty: 'Log kosong', noCode: 'VS Code tidak ditemukan' },
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
  background: 'Background',
  tasks: 'Background Tasks',
  noLog: 'No log available',
  empty: 'Log is empty',
  noCode: 'VS Code not found',
}

export const textsFor = (language: string): Texts => MESSAGES[language] ?? MESSAGES['en'] ?? FALLBACK

/** The label of the band, in the given language. */
export const wordFor = (language: string) => textsFor(language).background

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
  clip((item.description || item.command || item.type || 'task').replace(/\s+/g, ' ').trim(), MAX_WIDTH)

/** A wake-up that will resume the session later: shown with a clock and the prompt it will submit. */
export const scheduledLabel = (prompt: string) =>
  `⏰ ${clip((prompt || 'scheduled').replace(/\s+/g, ' ').trim(), MAX_WIDTH - 3)}`

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

// ── Open a task's log in its own VS Code window ─────────────────────────────
// A throwaway folder holds one VS Code task that runs when the folder opens and follows the log with `watch`
// (or `tail -f` where `watch` is not installed). Only a task id made of letters, digits, `_` and `-` and a
// file path made of letters, digits and `/._-` ever reach the command, and the command is fixed.

export const isSafeId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id)

export const isSafePath = (path: string) => /^\/[A-Za-z0-9/._-]{1,400}$/.test(path) && !path.includes('..')

const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

/** What the VS Code terminal runs to follow a log file. */
export const followCommand = (file: string) =>
  `if command -v watch >/dev/null 2>&1; then exec watch -n 1 -t tail -n 80 ${quote(file)}; else exec tail -n 200 -f ${quote(file)}; fi`

/** The `.vscode/tasks.json` of the throwaway folder: one terminal task that starts as the folder opens. */
export const tasksJson = (title: string, command: string) =>
  JSON.stringify(
    {
      version: '2.0.0',
      tasks: [
        {
          label: `bg-indicator: ${title}`,
          type: 'shell',
          command,
          isBackground: true,
          problemMatcher: [],
          presentation: { reveal: 'always', panel: 'dedicated', focus: false, clear: true, showReuseMessage: false },
          runOptions: { runOn: 'folderOpen' },
        },
      ],
    },
    null,
    2,
  )

/** Where the `code` command usually is; the bare name is tried last, for a `PATH` that has it. */
const CODE_CLIS = [
  '/opt/homebrew/bin/code',
  '/usr/local/bin/code',
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
  '/usr/bin/code',
  '/snap/bin/code',
] as const

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

/** Opens a new VS Code window whose terminal follows the task's log. */
const openWindow = async ($: EngineInterface, task: Task, texts: Texts) => {
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
  const dir = `${root}/bg-indicator/${task.id}`
  await $.fs.write(`${dir}/.vscode/tasks.json`, tasksJson(task.label, followCommand(file)))
  let code: string = 'code'
  for (const candidate of CODE_CLIS) {
    if (await $.fs.exists(candidate).catch(() => false)) {
      code = candidate
      break
    }
  }
  const result = await $.process.run([code, '--new-window', dir], { timeoutMs: 20000 }).catch(() => undefined)
  if (result === undefined || result.exitCode !== 0) await $.ui.toast(texts.noCode)
}

export const register: Register = on => {
  let texts = textsFor('en')

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
    const single = list.length === 1
    const shown = list.slice(0, MAX_ROWS)
    const hidden = list.length - shown.length

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
        <Text color="yellow">{FRAMES[f] ?? FRAMES[0]} </Text>
        {single
          ? <Text bold color="yellow">{texts.background}{' '}</Text>
          : <Text bold color="yellow">{texts.tasks}{' '}</Text>}
        {single ? <Text>{first.label}{' '}</Text> : <Text>{`(${list.length})`}{' '}</Text>}
        <Button key="toggle" label={isOpen ? '▾' : '▸'} onPress={() => flip(isOpen)} />
      </Box>
    )

    if (!isOpen) {
      return header
    }

    // Pressing a row shows (or hides) the last lines of its log right under it.
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

    return (
      <Box flexDirection="column">
        {header}
        {shown.map((t, i) => {
          const log_ = openId === t.id && view !== null && view.id === t.id ? view : null
          const range = log_ === null ? null : visibleRange(log_.lines.length, LOG_WINDOW, top)
          const thumb = log_ === null || range === null ? [] : scrollbar(log_.lines.length, LOG_WINDOW, range.start, range.end - range.start)

          return (
            <Box key={`row-${t.id}`} flexDirection="column">
              <Box>
                <Button key={`task-${t.id}`} label={`${i + 1}. [${kindOf(t)}] ${t.label}`} onPress={() => press(t)} />
                {t.detail === undefined ? <Text> </Text> : null}
                {t.detail === undefined ? <Button key={`open-${t.id}`} label="↗" onPress={() => openWindow($, t, texts)} /> : null}
              </Box>
              {log_ !== null && range !== null ? (
                <Box flexDirection="column">
                  {log_.note === null
                    ? log_.lines.slice(range.start, range.end).map((line, n) => (
                        <Box key={`log-${t.id}-${n}`}>
                          <Text dimColor>{'     '}</Text>
                          {thumb[n] === true ? <Text color="cyan">┃</Text> : <Text dimColor>│</Text>}
                          <Text dimColor>{` ${line}`}</Text>
                        </Box>
                      ))
                    : <Text dimColor>{`     ${log_.note === 'empty' ? texts.empty : texts.noLog}`}</Text>}
                  {log_.note === null && log_.lines.length > LOG_WINDOW ? (
                    <Box>
                      <Text dimColor>{`     ${range.start + 1}–${range.end} / ${log_.lines.length} `}</Text>
                      {top !== null ? <Button key="follow" label="⤓" onPress={() => update($, logTop, () => null)} /> : null}
                    </Box>
                  ) : null}
                  {log_.note === 'none' && log_.tried !== null ? <Text dimColor>{`     → ${clip(log_.tried, LOG_WIDTH)}`}</Text> : null}
                </Box>
              ) : null}
            </Box>
          )
        })}
        {hidden > 0 ? <Text dimColor>{`  … +${hidden}`}</Text> : null}
      </Box>
    )
  })
}
