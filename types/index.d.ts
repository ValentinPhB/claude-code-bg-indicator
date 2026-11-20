export type Task = { id: string; label: string }

declare module 'claude-code' {
  interface PluginState {
    'bg-indicator': { tasks: Task[]; frame: number }
  }
}
