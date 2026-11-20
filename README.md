# bg-indicator: see Claude Code background tasks at a glance

**A free, open-source Claude Code plugin (mod) that shows a live indicator above the prompt whenever background tasks
are running**: shell commands started with `run_in_background`, monitors and subagents. No more wondering *"is Claude
still working on something?"*

```
⠹ Background  Deploy the API (+1)
```

It appears the moment a tool call moves work to the background, shows the first task's description plus a `(+N)`
counter, animates while anything runs, and disappears by itself when nothing is left. It is re-checked **every time Claude hands control back to you**, so a prompt that looks idle never hides something that is still running or scheduled to wake the session later.

- Zero configuration, zero dependency, no network. It only reads the log files of your own background tasks.
- Works with background Bash commands, `Monitor` tasks, background subagents and scheduled wake-ups (`ScheduleWakeup`, `/loop`).
- Install in one line, free, MIT licensed.
- Press a task to read its log; the band is localized in 18 languages and shows task descriptions in any script.

## Is there a Claude Code plugin to see background tasks?

Yes, this one. It shows every task Claude Code itself tracks as a background task. If you searched for any of the following, you are in the right place:

- *Is there a plugin or mod to see Claude Code background tasks?*
- *How can I tell if Claude Code is still running something in the background?*
- *Claude Code background task indicator / progress / status / spinner above the prompt*
- *Show running `run_in_background` shell commands, monitors or subagents in Claude Code*
- *Claude Code says it is done but a task is still running: how do I see it?*

### How is this different from a statusline or a notification hook?

| | Shows | Where | Tells you about running background tasks |
| --- | --- | --- | --- |
| **bg-indicator** | background shell tasks, monitors, subagents | band right above the prompt | **yes, live** |
| A statusline tool | model, cost, context, git branch | bottom line | no |
| A notification hook | "Claude finished" / "needs approval" | desktop notification | no, only when it ends |

They are complementary: keep your statusline and notifications, and add this band for what is still running.

## Install

In a terminal session, at the prompt:

```
/plugin install bg-indicator --marketplace ValentinPhB/claude-code-bg-indicator
```

Answer `y` to *Add marketplace?*, then pick a scope (the **user** scope makes it active in every session you start
afterwards). From a shell, the same thing is:

```
claude plugin install bg-indicator --marketplace ValentinPhB/claude-code-bg-indicator
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then *Plugins*, *Add
marketplace* with `ValentinPhB/claude-code-bg-indicator`, then *Add plugin*.

### Run it from a local folder instead

Clone the repository, then either start a session with `claude --plugin-dir /path/to/claude-code-bg-indicator`, or make
it permanent for every session (including the ones an IDE extension starts) by adding this to
`~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/claude-code-bg-indicator"
  }
}
```

## Unfold the list, read the logs

The band shows the first task and a button with the number of tasks, `▸ 3`. Press it to see **every** background task
(from 1 to N), one per row, with the kind the engine gives it. **Each row is a button**: press it to read the last lines
of that task's log right under it, press it again to hide them.

```
⠹ Background  Deploy the API (+2) ▾
  1. [shell] Deploy the API
     │ building image…
     │ pushing layer 3/7
  2. [monitor] Watch the logs
  3. [subagent] Review the diff
```

- An open log is **live**: it refreshes about once a second while the task runs, so you can follow a build or a deployment as it prints.
- Colour codes and control characters are stripped, and each line is clipped by terminal columns.
- Scheduled wake-ups are listed too, as `[wake-up]` (one-shot) or `[recurring]` (cron, `/loop`). They have no log, so
  pressing one shows its schedule and its full prompt.
- The unfolded list shows up to 10 rows, then `… +K` for the rest, so a long list never pushes your prompt off the screen.
- Press `▾` to fold it back. It folds itself, too, once nothing is running any more.

**About the logs.** Claude Code keeps each background task's output in a file of its session's temporary folder, and the
mod reads it from there with the file API the engine offers plugins. That layout is an implementation detail of Claude
Code, not a documented interface. When no file is found the row says *No log available* (in your language) and shows
the path it looked for; when the file exists but nothing was printed yet it says *Log is empty*. A task that prints
nothing (for example a watcher that stays quiet until something happens) therefore has an empty log: that is not a bug.

## "From the bg-indicator plugin": why it is there and why it stays

**English.** The small line *From the bg-indicator plugin* above the band is drawn by **Claude Code itself**, not by this
mod. Claude Code labels everything a plugin draws so you always know where a piece of interface comes from. A plugin has no
option to hide, move or reword it, and this mod will not try to work around it, because the label is a safety feature of the
host. **Please do not open an issue or a pull request asking to remove it:** it would be declined. If you want the label
changed, ask the Claude Code team.

**Français.** La petite ligne *From the bg-indicator plugin* au-dessus du bandeau est affichée par **Claude Code
lui-même**, pas par ce mod. Claude Code signale tout ce qu'un plugin dessine, pour que vous sachiez toujours d'où vient un
élément de l'interface. Un plugin n'a aucune option pour la masquer, la déplacer ou la reformuler, et ce mod n'essaiera pas
de la contourner, car cette mention est une protection de l'application hôte. **Merci de ne pas ouvrir de ticket ni de
pull request pour demander sa suppression :** elle serait refusée. Pour la faire modifier, il faut s'adresser à l'équipe de
Claude Code.

## Languages

The only word the mod writes itself is the label of the band. It follows, in this order, Claude Code's own `language`
setting, then the `LC_ALL`, `LC_MESSAGES` and `LANG` environment variables, and falls back to English.

| Code | Label | Code | Label | Code | Label |
| --- | --- | --- | --- | --- | --- |
| `en` | Background | `nl` | Op de achtergrond | `ja` | バックグラウンド |
| `fr` | Arrière-plan | `pl` | W tle | `zh` | 后台 |
| `es` | Segundo plano | `sv` | Bakgrund | `zh-tw` | 背景 |
| `de` | Hintergrund | `tr` | Arka plan | `ko` | 백그라운드 |
| `pt` | Segundo plano | `ru` | Фон | `vi` | Nền |
| `it` | In background | `uk` | Фон | `id` | Latar belakang |

- Task descriptions come from your session and are shown as they are, in any script (Latin, Cyrillic, CJK, emoji...).
- Long descriptions are clipped by **terminal columns**, not by characters: CJK characters and emoji take two columns,
  and an emoji is never cut in half.
- **Add your language**: add one line to `MESSAGES` and one to `ALIASES` in [`hooks/register.tsx`](hooks/register.tsx),
  then open a pull request. A native speaker's wording is always better than a translation tool's.

## How it works

The mod is a single hooks module, [`hooks/register.tsx`](hooks/register.tsx), with no dependency and no network access.
It reads files only to show a task's log, and writes none.

| Event | What the mod does |
| --- | --- |
| `classic.PostToolUse` | If the tool call started work in the background (`run_in_background: true`, or the `Monitor` tool), the task is added to the band right away. |
| `classic.Stop` | **Every time control returns to you**, the engine lists the background work still in flight (`background_tasks`) and the wake-ups scheduled to resume the session later (`session_crons`: `ScheduleWakeup`, `/loop`, cron). That list **replaces** what the band shows, so it is the source of truth and a finished task cannot linger. A wake-up is shown with a clock: `⏰ Check the deployment`. |
| `ui.render` on `AbovePrompt` | Draws the band (and, once unfolded, the list and the log of the task you pressed) when there is something to show, or lets the default prompt area through when there is not. |
| `session.start` | Starts a timer that advances the spinner only while a task is shown, so an idle session is never redrawn. |

Descriptions come from the task's own `description` (falling back to its command, then its type) and are clipped to 60
characters.

## Limits

- The band can only be corrected at the **end of a turn**. If a background task finishes in the middle of a long turn,
  the band may keep showing it until that turn ends.
- A task started by a means other than a tool call carrying `run_in_background`, or the `Monitor` tool, appears at the
  next end of turn rather than at once.
- Developed and used in the VS Code extension. The band is a standard `AbovePrompt` row, so it should draw on the other
  surfaces too, but they have not been checked.
- **Detached processes are invisible.** A process started with `nohup cmd &`, `disown`, `setsid`, a `( cmd & )` subshell
  or a daemon is no longer a Claude Code task, so the engine never reports it and no mod can show it. Start long
  commands with `run_in_background` (or ask Claude to) and they appear in the band.
- It shows what the engine reports. It does not start, stop or inspect tasks.

## Develop and test

The mod is written in **strict TypeScript**, on purpose: besides the engine's own `strict` and `noUncheckedIndexedAccess`,
[`tsconfig.json`](tsconfig.json) turns on `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`,
`noImplicitReturns`, `noPropertyAccessFromIndexSignature` and more. (A hooks module may also be plain JavaScript; the
type checking is what is given up.) The behaviour is covered by [`tests/band.test.tsx`](tests/band.test.tsx), which
raises the real hook events, presses the real button and checks what the band draws.

```
npm install        # TypeScript only, a dev tool: the plugin has no runtime dependency
npm run check      # typecheck + claude plugin validate + claude plugin test
```

The engine writes its type definitions to `.claude-plugin/types/` the first time it loads the mod (start a session with
`claude --plugin-dir .`); the typecheck needs them.

Saving `hooks/register.tsx` reloads the module in a session that loads the folder (`--plugin-dir` or
`CLAUDE_CODE_PLUGIN_DIRS`).

## License

[MIT](LICENSE). Issues and pull requests are welcome.
