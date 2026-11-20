export type Task = { id: string; label: string; kind: string; detail?: string }
/** Where the session runs: enough to find the output file of one of its tasks. */
export type Where = { session: string; cwd: string }
/** The last lines of one task's output, or a note saying why there are none. */
export type LogView = { id: string; lines: string[]; note: boolean }

declare module 'claude-code' {
  interface PluginState {
    'bg-indicator': {
      tasks: Task[]
      frame: number
      expanded: boolean
      where: Where | null
      viewing: string | null
      log: LogView | null
    }
  }
}
