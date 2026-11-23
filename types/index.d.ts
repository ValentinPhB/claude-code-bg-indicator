export type Task = { id: string; label: string; kind: string; detail?: string }
/** Where the session runs: enough to find the output file of one of its tasks. */
export type Where = { session: string; cwd: string }
/** What the log area of one task shows: its last lines, or why there are none (and where the file was looked for). */
export type LogView = { id: string; lines: string[]; note: 'none' | 'empty' | null; tried: string | null }

declare module 'claude-code' {
  interface PluginState {
    'bg-indicator': {
      tasks: Task[]
      frame: number
      expanded: boolean
      viewing: string | null
      log: LogView | null
      logTop: number | null
    }
  }
}
