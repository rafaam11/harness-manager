import { atom, read, update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, Register, SessionUsage, TextProps, Timer } from 'claude-code'

import type { HudBoard, HudConfig, HudToolStat } from '../types'
import { layoutBand, layoutPane, rowBudget } from './board'
import type { Line } from './cells'
import {
  emptyBoard,
  parseGitStatus,
  parseLastCommit,
  parsePr,
  parseRemote,
  parseWorktree,
  projectOfBrief,
  pushBounded,
  RECENT_LIMIT,
  toolTarget,
  TREND_LIMIT,
} from './model'
import { modelFamily } from './visual'

// claude-hud 대체 상황판: 입력창 위 밴드(AbovePrompt) + /hud 사이드 패널(Pane).
// transcript를 읽지 않고 엔진 이벤트로 모은 값을 $.state에 내보내고, 렌더 훅은 그것만 읽는다.
// 툴 호출은 관찰만 한다 — next(e)의 결과를 그대로 돌려준다.

type Task = { text: string; status: string }

type Hud = {
  board: HudBoard
  tasks: Map<string, Task>
  root: string | null
  lastJson: string
  frame: number
  idle: Timer | null
  fast: Timer | null
  gitTimer: Timer | null
  isPaneOpen: boolean
  prBranch: string | null
  prCheckedAt: number
}

const PANE = 'jinmin-hud'
// 안내 줄은 터미널 양옆에 여백을 두고 그려지므로 그만큼 좁게 잡는다.
const HINT_GUTTER = 2
const FAST_MS = 250
const IDLE_MS = 5_000
const GIT_DEBOUNCE_MS = 2_000
const GIT_TIMEOUT_MS = 3_000
const GIT_STAT_LIMIT = 30
const PR_INTERVAL_MS = 3 * 60_000
const PR_TIMEOUT_MS = 8_000
const GIT_TOUCHING_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'])
const DONE_AGENT_STATUSES = new Set(['completed', 'failed', 'killed', 'idle'])

const boardAtom = atom({ plugin: 'jinmin-hud', key: 'board' } as const, null)
const pulseAtom = atom({ plugin: 'jinmin-hud', key: 'pulse' } as const, { now: 0, frame: 0 })

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function isBusy(hud: Hud): boolean {
  return hud.board.turnStartedAt !== null || hud.board.running.length > 0 || hud.board.agents.some(agent => agent.endedAt === null)
}

async function publish($: EngineInterface, hud: Hud) {
  const json = JSON.stringify(hud.board)
  if (json !== hud.lastJson) {
    hud.lastJson = json
    await update($, boardAtom, () => JSON.parse(json) as HudBoard)
  }
}

async function pulse($: EngineInterface, hud: Hud) {
  hud.frame += 1
  const now = await $.clock.now()
  await update($, pulseAtom, () => ({ now, frame: hud.frame }))
}

// 바쁜 동안만 250ms 스피너, 한가해지면 스스로 멈춘다.
function ensureFast($: EngineInterface, hud: Hud) {
  if (hud.fast === null) {
    hud.fast = $.clock.every(FAST_MS, () => void fastTick($, hud))
  }
}

async function fastTick($: EngineInterface, hud: Hud) {
  if (!isBusy(hud)) {
    hud.fast?.cancel()
    hud.fast = null
  }
  await pulse($, hud)
}

async function idleTick($: EngineInterface, hud: Hud) {
  if (hud.board.agents.some(agent => agent.endedAt === null)) {
    const listed = await $.agent.list().catch(() => [])
    const now = await $.clock.now()
    for (const agent of hud.board.agents) {
      const status = listed.find(one => one.id === agent.id)?.status
      if (agent.endedAt === null && status && DONE_AGENT_STATUSES.has(status)) {
        agent.endedAt = now
      }
    }
    await publish($, hud)
  }
  if (hud.fast === null) {
    await pulse($, hud)
  }
}

async function refreshGit($: EngineInterface, hud: Hud) {
  if (!hud.root) {
    return
  }
  try {
    const ran = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd: hud.root, timeoutMs: GIT_TIMEOUT_MS })
    const git = ran.exitCode === 0 ? parseGitStatus(ran.stdout) : null
    if (git) {
      const log = await $.process.run(['git', 'log', '-1', '--format=%h%x1f%ct%x1f%s'], { cwd: hud.root, timeoutMs: GIT_TIMEOUT_MS })
      git.lastCommit = log.exitCode === 0 ? parseLastCommit(log.stdout) : null
      git.lastModified = await lastModified($, hud.root, git.files.map(file => file.path))
      const dirs = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'], {
        cwd: hud.root,
        timeoutMs: GIT_TIMEOUT_MS,
      })
      git.worktree = dirs.exitCode === 0 ? parseWorktree(dirs.stdout) : null
      const origin = await $.process.run(['git', 'remote', 'get-url', 'origin'], { cwd: hud.root, timeoutMs: GIT_TIMEOUT_MS })
      git.repo = origin.exitCode === 0 ? parseRemote(origin.stdout) : null
    }
    hud.board.git = git
  } catch {
    hud.board.git = null
  }
  await publish($, hud)
  // PR은 브랜치가 바뀌었거나 3분이 지났을 때만 gh로 다시 묻는다.
  const branch = hud.board.git?.branch ?? null
  const now = await $.clock.now()
  if (branch !== hud.prBranch || now - hud.prCheckedAt >= PR_INTERVAL_MS) {
    hud.prBranch = branch
    hud.prCheckedAt = now
    void refreshPr($, hud)
  }
}

async function refreshPr($: EngineInterface, hud: Hud) {
  if (!hud.root || !hud.board.git?.branch || hud.board.git.branch === 'detached' || !hud.board.git.repo) {
    hud.board.pr = null
    await publish($, hud)

    return
  }
  try {
    const ran = await $.process.run(['gh', 'pr', 'view', '--json', 'number,state,isDraft,title,url,reviewDecision,statusCheckRollup'], {
      cwd: hud.root,
      timeoutMs: PR_TIMEOUT_MS,
    })
    hud.board.pr = ran.exitCode === 0 ? parsePr(ran.stdout) : null
  } catch {
    hud.board.pr = null
  }
  await publish($, hud)
}

// 바뀐 파일 중 가장 최근에 손댄 것. 바뀐 파일이 없으면 null(마지막 커밋이 그 역할을 한다).
async function lastModified($: EngineInterface, root: string, paths: readonly string[]) {
  let latest: { path: string; at: number } | null = null
  for (const path of paths.slice(0, GIT_STAT_LIMIT)) {
    const stat = await $.fs.stat(`${root}/${path}`).catch(() => null)
    if (stat && (latest === null || stat.mtimeMs > latest.at)) {
      latest = { path, at: stat.mtimeMs }
    }
  }

  return latest
}

function scheduleGit($: EngineInterface, hud: Hud) {
  hud.gitTimer?.cancel()
  hud.gitTimer = $.clock.after(GIT_DEBOUNCE_MS, () => void refreshGit($, hud))
}

function applyUsage(hud: Hud, usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) {
  const ctx = usage.context
  if (ctx.percent !== undefined) {
    hud.board.context = { percent: ctx.percent, tokens: ctx.tokens ?? null, window: ctx.window }
    const last = hud.board.trend[hud.board.trend.length - 1]
    if (last !== ctx.percent) {
      hud.board.trend = pushBounded(hud.board.trend, ctx.percent, TREND_LIMIT)
    }
  }
  hud.board.limits = usage.rateLimits.map(limit => ({
    kind: limit.kind,
    percentUsed: limit.percentUsed,
    resetsAt: limit.resetsAt ? Date.parse(limit.resetsAt) : null,
  }))
  hud.board.costUsd = usage.cost?.usd ?? hud.board.costUsd
}

async function refreshBreakdown($: EngineInterface, hud: Hud) {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  if (usage) {
    applyUsage(hud, usage)
    const breakdown = usage.context.breakdown
    hud.board.breakdown =
      breakdown?.categories
        .filter(category => category.kind === 'used' && category.tokens > 0)
        .map(category => ({ name: category.name, tokens: category.tokens })) ?? null
    if (breakdown) {
      hud.board.compactAt = breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null
    }
    await publish($, hud)
  }
}

async function countMcp($: EngineInterface): Promise<number> {
  const tools = await $.tool.list().catch(() => [])

  return new Set(tools.filter(tool => tool.mcp).map(tool => tool.name.split('__')[1])).size
}

async function countConfig($: EngineInterface, hud: Hud, home: string | null): Promise<HudConfig> {
  const exists = async (path: string) => $.fs.exists(path).catch(() => false)
  const mdFiles = [
    home ? `${home}/.claude/CLAUDE.md` : null,
    hud.root ? `${hud.root}/CLAUDE.md` : null,
    hud.root ? `${hud.root}/CLAUDE.local.md` : null,
    hud.root ? `${hud.root}/.claude/CLAUDE.md` : null,
  ].filter((path): path is string => path !== null)
  const claudeMd = (await Promise.all(mdFiles.map(exists))).filter(Boolean).length

  let rules = 0
  for (const dir of [home ? `${home}/.claude/rules` : null, hud.root ? `${hud.root}/.claude/rules` : null]) {
    if (dir) {
      const entries = await $.fs.list(dir).catch(() => [])
      rules += entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.md')).length
    }
  }

  let hooks = 0
  const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
  const byEvent = settings['hooks']
  if (byEvent && typeof byEvent === 'object') {
    for (const matchers of Object.values(byEvent)) {
      if (Array.isArray(matchers)) {
        for (const matcher of matchers) {
          const list = (matcher as { hooks?: unknown }).hooks
          hooks += Array.isArray(list) ? list.length : 0
        }
      }
    }
  }

  return { claudeMd, rules, mcp: await countMcp($), hooks }
}

async function warmUp($: EngineInterface, hud: Hud, home: string | null) {
  await refreshBreakdown($, hud)
  hud.board.config = await countConfig($, hud, home).catch(() => null)
  hud.board.version = (await $.session.version().catch(() => null))?.version ?? null
  await refreshGit($, hud)
}

// MCP 서버는 세션 시작 뒤에 연결되므로 메인 턴마다 다시 센다.
async function recountMcp($: EngineInterface, hud: Hud) {
  if (hud.board.config) {
    hud.board.config.mcp = await countMcp($)
    await publish($, hud)
  }
}

function syncTodosFromTasks(hud: Hud) {
  hud.board.todos = [...hud.tasks.values()].filter(task => task.status !== 'deleted').map(task => ({ ...task }))
}

function bumpStat(stats: Record<string, HudToolStat>, tool: string, isOk: boolean, ms: number) {
  const stat = stats[tool] ?? { count: 0, errors: 0, ms: 0 }
  stats[tool] = { count: stat.count + 1, errors: stat.errors + (isOk ? 0 : 1), ms: stat.ms + ms }
}

function drawLines(Box: ElementConstructor<BoxProps>, Text: ElementConstructor<TextProps>, lines: readonly Line[]) {
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Box key={`r${i}`}>
          <Text wrap="truncate">
            {line.length === 0
              ? ' '
              : line.map(span => (
                  <Text color={span.color} dimColor={span.dim} bold={span.bold}>
                    {span.text}
                  </Text>
                ))}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const hud: Hud = {
    board: {
      ...emptyBoard(),
      cacheTtlMs: Number(options['promptCacheTtlSeconds'] ?? 300) * 1000,
      sevenDayThreshold: Number(options['sevenDayThreshold'] ?? 80),
      maxRows: Number(options['maxRows'] ?? 10),
    },
    tasks: new Map(),
    root: null,
    lastJson: '',
    frame: 0,
    idle: null,
    fast: null,
    gitTimer: null,
    isPaneOpen: false,
    prBranch: null,
    prCheckedAt: 0,
  }
  const board = hud.board
  const isAbove = options['placement'] === 'above'
  let callCount = 0

  on('session.start', async ($, e, next) => {
    hud.idle?.cancel()
    // v0.1이 입력창 아래에 고정해 둔 평문 상태줄이 남아 있으면 지운다.
    $.ui.status(undefined)
    await $.command
      .register({ name: 'hud', description: 'jinmin-hud 상황판을 사이드 패널로 열기 (/hud close로 닫기)', argumentHint: '[close]' })
      .catch(() => undefined)

    hud.root = await $.session.root().catch(() => e.cwd)
    board.project = basename(hud.root)
    board.model = await $.session.model().catch(() => null)
    board.sessionId = await $.session.id().catch(() => null)
    // 실제 턴의 추론 강도는 클래식 훅으로 오기 전까지 설정값으로 보여 준다.
    const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
    board.effort = typeof settings['effortLevel'] === 'string' ? settings['effortLevel'] : board.effort
    const usage = await $.session.usage().catch(() => null)
    if (usage) {
      board.startedAt = usage.startedAt
      applyUsage(hud, usage)
    }

    const mcwSessionId = await $.env.get('MULTI_CLI_WORK_SESSION_ID')
    if (mcwSessionId) {
      board.mcwSessionId = mcwSessionId
      const briefPath = await $.env.get('MULTI_CLI_WORK_PROJECT_BRIEF')
      const brief = briefPath ? await $.fs.read(briefPath).catch(() => null) : null
      board.mcwProject = brief ? projectOfBrief(brief) : null
    }

    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || null
    hud.idle = $.clock.every(IDLE_MS, () => void idleTick($, hud))
    await publish($, hud)
    await pulse($, hud)
    // git·설정 스캔은 첫 프롬프트를 붙잡지 않게 기다리지 않는다.
    void warmUp($, hud, home)

    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'close') {
      await $.ui.close({ id: PANE })
      hud.isPaneOpen = false

      return { text: 'HUD 패널을 닫았습니다.' }
    }
    hud.isPaneOpen = true
    await refreshBreakdown($, hud)
    const opened = await $.ui.open({ id: PANE, title: 'HUD 상황판' })

    return { text: opened.isPlaced ? 'HUD 패널을 열었습니다. (/hud close로 닫기)' : 'HUD 패널이 아직 자리를 못 잡았습니다(창이 좁음).' }
  })

  // /rename으로 붙인 세션 이름. 엔진이 제목을 주는 API가 없어 명령을 지켜본다.
  on('command.run', { command: 'rename' }, async ($, e, next) => {
    const ran = await next(e)
    const name = (e.args ?? '').trim()
    if (name !== '') {
      board.sessionName = name
      await publish($, hud)
    }

    return ran
  })

  // effort·권한 모드는 클래식 훅 입력에만 실려 온다.
  on('classic.PostToolUse', async ($, e, next) => {
    board.mode = e.permission_mode ?? board.mode
    board.effort = e.effort?.level ?? board.effort

    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    board.mode = e.permission_mode ?? board.mode

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      board.turnStartedAt = await $.clock.now()
      board.turnTools = {}
      board.agents = board.agents.filter(agent => agent.endedAt === null || board.agents.indexOf(agent) >= board.agents.length - 10)
      const model = await $.session.model().catch(() => board.model)
      if (model !== board.model) {
        board.model = model
        // 모델이 바뀌면 창 크기와 자동 압축 지점도 바뀐다.
        void refreshBreakdown($, hud)
      }
      board.turns = await $.session.turns().catch(() => board.turns + 1)
      ensureFast($, hud)
      await publish($, hud)
      void recountMcp($, hud)
    } else {
      const agent = board.agents.find(one => one.id === e.agentId)
      if (agent) {
        agent.endedAt = null
      }
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Readonly<Record<string, unknown>>
    // 플러그인이 $.tool.call로 부른 호출에는 tool_use_id가 없다.
    const id = e.tool_use_id || `${e.tool}#${++callCount}`
    const startedAt = await $.clock.now()
    const target = toolTarget(input)
    board.running.push({ id, tool: e.tool, target, startedAt })
    ensureFast($, hud)
    await publish($, hud)

    const ran = await next(e)

    const endedAt = await $.clock.now()
    const isOk = ran.deny === undefined && !ran.isError
    board.running = board.running.filter(one => one.id !== id)
    bumpStat(board.turnTools, e.tool, isOk, endedAt - startedAt)
    bumpStat(board.sessionTools, e.tool, isOk, endedAt - startedAt)
    board.recent = pushBounded(board.recent, { at: endedAt, tool: e.tool, target, isOk }, RECENT_LIMIT)
    if (isOk) {
      if (e.tool === 'TodoWrite' && hud.tasks.size === 0) {
        const todos = Array.isArray(input['todos']) ? (input['todos'] as Array<Record<string, unknown>>) : []
        board.todos = todos.map(todo => ({
          text: String((todo['status'] === 'in_progress' ? todo['activeForm'] : todo['content']) || todo['content'] || ''),
          status: String(todo['status'] ?? 'pending'),
        }))
      } else if (e.tool === 'TaskCreate') {
        const taskId = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
        if (taskId) {
          hud.tasks.set(taskId, { text: String(input['subject'] ?? ''), status: 'pending' })
          syncTodosFromTasks(hud)
        }
      } else if (e.tool === 'TaskUpdate') {
        const task = hud.tasks.get(String(input['taskId'] ?? ''))
        if (task) {
          task.status = typeof input['status'] === 'string' ? input['status'] : task.status
          task.text = typeof input['subject'] === 'string' ? input['subject'] : task.text
          syncTodosFromTasks(hud)
        }
      }
    }
    if (GIT_TOUCHING_TOOLS.has(e.tool)) {
      scheduleGit($, hud)
    }
    await publish($, hud)

    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId) {
      board.agents.push({
        id: spawned.agentId,
        type: e.subagentType || 'agent',
        model: spawned.model ? modelFamily(spawned.model) : null,
        description: e.description,
        startedAt: await $.clock.now(),
        endedAt: null,
      })
      ensureFast($, hud)
      await publish($, hud)
    }

    return spawned
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId === undefined) {
      board.running = []
      board.turnStartedAt = null
      board.lastAnswerAt = now
      scheduleGit($, hud)
      if (hud.isPaneOpen) {
        void refreshBreakdown($, hud)
      }
    } else {
      const agent = board.agents.find(one => one.id === e.agentId)
      if (agent) {
        agent.endedAt = now
      }
    }
    await publish($, hud)
    await pulse($, hud)

    return next(e)
  })

  // 실제로 대화를 줄인 압축만 센다(미리 계산하는 precompute·건너뛴 압축 제외).
  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    if (e.trigger !== 'precompute' && ran.skip === undefined) {
      board.compactions += 1
      await publish($, hud)
      void refreshBreakdown($, hud)
    }

    return ran
  })

  on('session.measure', async ($, e, next) => {
    applyUsage(hud, e)
    await publish($, hud)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    hud.idle?.cancel()
    hud.fast?.cancel()
    hud.gitTimer?.cancel()

    return next(e)
  })

  // 기본은 입력창 아래(안내 줄 자리). 엔진의 안내 줄(esc to interrupt 등)은 next(e)로 받아 맨 아래에 그대로 둔다.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const current = await read($, boardAtom)
    if (isAbove || current === null) {
      return next(e)
    }
    const engineLine = await next(e)
    const beat = await read($, pulseAtom)
    const terminalRows = e.viewport?.rows ?? 40
    const rows = rowBudget(terminalRows, terminalRows, current.maxRows)
    const columns = (e.viewport?.columns ?? 100) - HINT_GUTTER
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {drawLines(Box, Text, layoutBand(current, beat, { columns, rows }))}
        {engineLine}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, boardAtom)
    if (!isAbove || e.props.hasSurvey || current === null) {
      return next(e)
    }
    const beat = await read($, pulseAtom)
    const terminalRows = e.viewport?.rows ?? e.props.maxRows
    const rows = rowBudget(terminalRows, e.props.maxRows, current.maxRows)
    const { Box, Text } = $.ui.resolve(e)

    return drawLines(Box, Text, layoutBand(current, beat, { columns: e.props.bodyColumns, rows }))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, boardAtom)
    const beat = await read($, pulseAtom)
    const { Box, Text } = $.ui.resolve(e)

    return drawLines(Box, Text, current === null ? [[{ text: '아직 데이터가 없습니다.', dim: true }]] : layoutPane(current, beat, e.props.bodyColumns))
  })
}
