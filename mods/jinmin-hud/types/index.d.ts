export type HudGit = {
  branch: string | null
  upstream: string | null
  lastCommit: { hash: string; subject: string; at: number } | null
  lastModified: { path: string; at: number } | null
  worktree: string | null
  repo: string | null
  isDirty: boolean
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  conflicted: number
  files: Array<{ code: string; path: string }>
}

export type HudPr = {
  number: number
  state: string
  isDraft: boolean
  title: string
  url: string
  review: string | null
  ci: 'pass' | 'fail' | 'pending' | null
}

export type HudLimit = { kind: string; percentUsed: number; resetsAt: number | null }

export type HudRunning = { id: string; tool: string; target: string | null; startedAt: number }

export type HudToolStat = { count: number; errors: number; ms: number }

export type HudRecent = { at: number; tool: string; target: string | null; isOk: boolean }

export type HudAgent = {
  id: string
  type: string
  model: string | null
  description: string
  startedAt: number
  endedAt: number | null
}

export type HudTodo = { text: string; status: string }

export type HudConfig = { claudeMd: number; rules: number; mcp: number; hooks: number }

export type HudCategory = { name: string; tokens: number }

export type HudBoard = {
  model: string | null
  effort: string | null
  mode: string | null
  version: string | null
  sessionId: string | null
  sessionName: string | null
  project: string | null
  mcwProject: string | null
  mcwSessionId: string | null
  git: HudGit | null
  context: { percent: number; tokens: number | null; window: number } | null
  compactAt: number | null
  compactions: number
  pr: HudPr | null
  trend: number[]
  limits: HudLimit[]
  costUsd: number | null
  startedAt: number | null
  turns: number
  turnStartedAt: number | null
  lastAnswerAt: number | null
  running: HudRunning[]
  turnTools: Record<string, HudToolStat>
  sessionTools: Record<string, HudToolStat>
  recent: HudRecent[]
  agents: HudAgent[]
  todos: HudTodo[]
  config: HudConfig | null
  breakdown: HudCategory[] | null
  cacheTtlMs: number
  sevenDayThreshold: number
  maxRows: number
}

export type HudPulse = { now: number; frame: number }

declare module 'claude-code' {
  interface PluginState {
    'jinmin-hud': {
      board: HudBoard | null
      pulse: HudPulse
    }
  }
}
