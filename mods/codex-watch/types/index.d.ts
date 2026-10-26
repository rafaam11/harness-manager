export type CodexJob = {
  id: string
  kind: string
  status: string
  phase: string | null
  startedAt: number | null
  summary: string | null
  duration: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'codex-watch': {
      running: CodexJob[]
      recent: CodexJob[]
      frame: number
      now: number
    }
  }
}
