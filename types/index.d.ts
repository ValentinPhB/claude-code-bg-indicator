export type Task = { id: string; label: string; kind: string }

declare module 'claude-code' {
  interface PluginState {
    'bg-indicator': { tasks: Task[]; frame: number; expanded: boolean }
  }
}
