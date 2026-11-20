# bg-indicator: see Claude Code background tasks at a glance

**A free, open-source Claude Code plugin (mod) that shows a live indicator above the prompt whenever background tasks
are running**: shell commands started with `run_in_background`, monitors and subagents. No more wondering *"is Claude
still working on something?"*

```
⠹ Background  Deploy the API (+1 more)
```

It appears the moment a tool call moves work to the background, shows the first task's description plus a `(+N more)`
counter, animates while anything runs, and disappears by itself when nothing is left.

- Zero configuration, zero dependency, no network, no file access of its own.
- Works with background Bash commands, `Monitor` tasks and background subagents.
- Install in one line, free, MIT licensed.

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

## License

[MIT](LICENSE). Issues and pull requests are welcome.
