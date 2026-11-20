import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Task } from '../types'

const tasks = atom({ plugin: 'bg-indicator', key: 'tasks' } as const, [] as Task[])
const frame = atom({ plugin: 'bg-indicator', key: 'frame' } as const, 0)

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const MAX_LABEL = 60

type Describable = { description?: string; command?: string; type?: string }

const clip = (text: string, max: number) =>
  text.length > max ? text.slice(0, max - 1) + '…' : text

export const labelOf = (item: Describable) =>
  clip((item.description || item.command || item.type || 'task').replace(/\s+/g, ' ').trim(), MAX_LABEL)

export const register: Register = on => {
  // Animate (and so redraw) only while something is running.
  on('session.start', ($, e, next) => {
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
        list.some(t => t.id === e.tool_use_id) ? list : [...list, { id: e.tool_use_id, label: labelOf(input) }],
      )
    }

    return next(e)
  })

  // Authoritative state: at the end of a turn the engine lists the work still in flight.
  on('classic.Stop', async ($, e, next) => {
    if (Array.isArray(e.background_tasks)) {
      const running = e.background_tasks.map(t => ({ id: t.id, label: labelOf(t) }))
      await update($, tasks, () => running)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, tasks)
    if (list.length === 0) {
      return next(e)
    }

    const f = await read($, frame)
    const first = list[0]
    if (!first) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const more = list.length > 1 ? ` (+${list.length - 1} more)` : ''

    return (
      <Box>
        <Text color="yellow">{FRAMES[f] ?? FRAMES[0]} </Text>
        <Text bold color="yellow">
          Background{' '}
        </Text>
        <Text>{first.label}</Text>
        <Text dimColor>{more}</Text>
      </Box>
    )
  })
}
