# bg-indicator: see Claude Code background tasks at a glance

**A free, open-source Claude Code plugin (mod) that shows a live indicator above the prompt whenever background tasks
are running**: shell commands started with `run_in_background`, monitors and subagents. No more wondering *"is Claude
still working on something?"*

```
⠹ Background  Deploy the API (+1)
```

It appears the moment a tool call moves work to the background, shows the first task's description plus a `(+N)`
counter, animates while anything runs, and disappears by itself when nothing is left.

- Zero configuration, zero dependency, no network, no file access of its own.
- Works with background Bash commands, `Monitor` tasks and background subagents.
- Install in one line, free, MIT licensed.
- Speaks your language: the band is localized in 18 languages and shows task descriptions in any script.

## Is there a Claude Code plugin to see background tasks?

Yes, this one. If you searched for any of the following, you are in the right place:

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

The mod is a single hooks module, [`hooks/register.tsx`](hooks/register.tsx), with no dependency and no file or network
access of its own.

| Event | What the mod does |
| --- | --- |
| `classic.PostToolUse` | If the tool call started work in the background (`run_in_background: true`, or the `Monitor` tool), the task is added to the band right away. |
| `classic.Stop` | At the end of every turn the engine lists the background work still in flight (`background_tasks`). That list **replaces** what the band shows, so it is the source of truth and a finished task cannot linger. |
| `ui.render` on `AbovePrompt` | Draws the band when the list is not empty, or lets the default prompt area through when it is. |
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
- It shows what the engine reports. It does not start, stop or inspect tasks.

## Develop and test

The behaviour is covered by [`tests/band.test.tsx`](tests/band.test.tsx), which raises the real hook events and checks
what the band draws:

```
claude plugin validate .
claude plugin test .
```

Saving `hooks/register.tsx` reloads the module in a session that loads the folder (`--plugin-dir` or
`CLAUDE_CODE_PLUGIN_DIRS`).

## In other languages

- **Français**: plugin Claude Code pour voir les tâches en arrière-plan. Un bandeau animé au-dessus du prompt indique quand une commande shell, un moniteur ou un sous-agent tourne encore en arrière-plan. Gratuit et open source (MIT).
- **Español**: plugin de Claude Code para ver las tareas en segundo plano. Una barra animada sobre el prompt indica cuándo un comando de shell, un monitor o un subagente sigue ejecutándose en segundo plano. Gratis y de código abierto (MIT).
- **Deutsch**: Claude-Code-Plugin, das Hintergrundaufgaben anzeigt. Eine animierte Leiste über dem Prompt zeigt, wann ein Shell-Befehl, ein Monitor oder ein Subagent noch im Hintergrund läuft. Kostenlos und Open Source (MIT).
- **Português**: plugin do Claude Code para ver tarefas em segundo plano. Uma barra animada acima do prompt mostra quando um comando shell, um monitor ou um subagente ainda está em execução em segundo plano. Gratuito e de código aberto (MIT).
- **Italiano**: plugin di Claude Code per vedere le attività in background. Una barra animata sopra il prompt mostra quando un comando shell, un monitor o un subagente è ancora in esecuzione in background. Gratuito e open source (MIT).
- **日本語**: バックグラウンドタスクを表示する Claude Code プラグイン。シェルコマンド、モニター、サブエージェントがバックグラウンドで実行中のあいだ、プロンプトの上にアニメーション付きのバーを表示します。無料のオープンソース (MIT) です。
- **简体中文**: 用于查看后台任务的 Claude Code 插件。当 shell 命令、监视器或子代理仍在后台运行时，在提示符上方显示动画状态条。免费开源 (MIT)。
- **한국어**: 백그라운드 작업을 보여 주는 Claude Code 플러그인. 셸 명령, 모니터, 서브에이전트가 백그라운드에서 실행되는 동안 프롬프트 위에 애니메이션 표시줄을 보여 줍니다. 무료 오픈 소스 (MIT)입니다.
- **Русский**: плагин Claude Code для просмотра фоновых задач. Анимированная полоса над строкой ввода показывает, что shell-команда, монитор или субагент всё ещё работает в фоне. Бесплатно, с открытым исходным кодом (MIT).

The install line is the same in every language: `/plugin install bg-indicator --marketplace ValentinPhB/claude-code-bg-indicator`

## License

[MIT](LICENSE). Issues and pull requests are welcome.
