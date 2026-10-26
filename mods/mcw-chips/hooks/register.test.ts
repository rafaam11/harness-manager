import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { base64ToUtf8 } from './jk'

// 엔진 수준: 가짜 process.run으로 PowerShell 배치의 argv와 stdin(base64 JSON 줄)을 디코드해 본다.

const START = { cwd: 'C:/dev/app', surface: 'terminal', isInteractive: true } as const
const MCW_ENV = {
  MULTI_CLI_WORK_SESSION_ID: 'pane-1',
  JK_CODING_CLI_PIPE: 'jk-coding-cli-test',
  OS: 'Windows_NT',
  SystemRoot: 'C:\\Windows',
}
const T0 = 1_000_000

type Sent = { command: string; args: Record<string, unknown>; callerSessionId: string }
type Ran = { argv: readonly string[]; timeoutMs: number | undefined; requests: Sent[] }
type ToolAnswer = { result: unknown; text?: string; isError?: true }

const TODOS = [
  { content: '설계', status: 'completed', activeForm: '설계 중' },
  { content: '구현', status: 'in_progress', activeForm: '구현 중' },
  { content: '검증', status: 'pending', activeForm: '검증 중' },
  { content: '정리', status: 'pending', activeForm: '정리 중' },
] as const

const VITEST_FAIL = [' ❯ src/a.test.ts (41 tests | 3 failed)', ' Test Files  1 failed | 4 passed (5)', '      Tests  3 failed | 38 passed (41)', '   Duration  1.20s'].join('\n')

function decode(stdin: string): Sent[] {
  return stdin
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(base64ToUtf8(line)) as Sent)
}

function shell(stdout: string, extra: Record<string, unknown> = {}): ToolAnswer {
  return { result: { stdout, stderr: '', interrupted: false, ...extra }, text: stdout }
}

// 엔진 자리: 플러그인이 next(e)로 넘긴 이벤트에 엔진처럼 답한다.
function engine(on: On, runs: Ran[], tools: Record<string, (e: Record<string, unknown>) => ToolAnswer | Promise<ToolAnswer>> = {}, isProcessBroken = false) {
  let taskSeq = 0
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('prompt.submit', ($, e) => ({ text: e.text, origin: e.origin }))
  on('session.receive', ($, e) => ({ text: e.text }))
  on('classic.Stop', () => ({}))
  on('agent.spawn', ($, e) => ({ model: e.model ?? 'claude-haiku-4-5', agentId: `ag-${e.description}` }))
  on('agent.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', ($, e) => ({ deny: `ENOENT ${e.path}` }))
  on('ui.log', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    const requests = decode(e.init?.stdin ?? '')
    runs.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs, requests })
    if (isProcessBroken) {
      return { deny: 'spawn powershell.exe ENOENT' }
    }

    return { value: { exitCode: 0, stdout: requests.map((_, i) => `ok ${i}`).join('\r\n') + '\r\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const custom = tools[tool]
    if (custom) {
      return (await custom(input)) as never
    }
    if (tool === 'TodoWrite') {
      return { result: { oldTodos: [], newTodos: input['todos'] }, text: 'ok' } as never
    }
    if (tool === 'TaskCreate') {
      taskSeq += 1

      return { result: { task: { id: String(taskSeq), subject: String(input['subject']) } }, text: 'ok' } as never
    }
    if (tool === 'TaskUpdate') {
      return { result: { success: true, taskId: input['taskId'], updatedFields: ['status'] }, text: 'ok' } as never
    }

    return { result: {}, text: 'ok' } as never
  })
}

async function begin($: Engine, clock: ReturnType<typeof mock.clock>, runs: Ran[]) {
  await $.session.start(START)
  // 시작 때 한 번: sent를 모르니 우리 키를 먼저 리셋한다.
  await clock.advance(1000)
  runs.length = 0
}

function sets(runs: Ran[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const ran of runs) {
    for (const request of ran.requests) {
      if (request.command === 'status' && request.args['action'] === 'set') {
        out[String(request.args['key'])] = { text: request.args['text'], color: request.args['color'] }
      } else if (request.command === 'status' && request.args['action'] === 'clear') {
        out[String(request.args['key'])] = 'cleared'
      } else if (request.command === 'progress') {
        out['progress'] = request.args
      }
    }
  }

  return out
}

test('multi-cli-work 밖이면 process.run 0회, 결과는 그대로', async ($, on) => {
  const runs: Ran[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, { MULTI_CLI_WORK_SESSION_ID: 'pane-1' })
  engine(on, runs)
  await $.session.start(START)
  const ran = await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
  expect(ran.text).toBe('ok')
  expect(ran.result).toEqual({ oldTodos: [], newTodos: TODOS })
  await $.session.measure({ context: { window: 200_000, tokens: 172_000, percent: 86 }, rateLimits: [], changed: ['context'] })
  await clock.advance(10_000)
  expect(runs).toHaveLength(0)
  const info = await $.command.run({ command: 'chips', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(info.text).toContain('꺼져 있습니다')
})

test('시작 리셋, TodoWrite → 창이 지난 뒤 PowerShell 배치 한 번(할 일 칩 + 진행선)', async ($, on) => {
  const runs: Ran[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, MCW_ENV)
  engine(on, runs)
  await $.session.start(START)
  await clock.advance(1000)
  // 첫 전송: 우리 6개 키 clear + 진행선 clear, 토큰 없이 callerSessionId만
  expect(runs).toHaveLength(1)
  expect(runs[0]?.requests.map(request => [request.command, request.args['action'] ?? null, request.args['key'] ?? null])).toEqual([
    ['status', 'clear', 'todo'],
    ['status', 'clear', 'ctx'],
    ['status', 'clear', 'agents'],
    ['status', 'clear', 'test'],
    ['status', 'clear', 'bg'],
    ['status', 'clear', 'bg-done'],
    ['progress', null, null],
  ])
  expect(runs[0]?.requests.every(request => request.callerSessionId === 'pane-1' && !('token' in request))).toBe(true)
  const argv = runs[0]?.argv ?? []
  expect(argv[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  expect(argv.slice(1, 5)).toEqual(['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand'])
  expect(runs[0]?.timeoutMs).toBe(4000)
  runs.length = 0

  const ran = await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
  expect(ran.text).toBe('ok')
  await clock.advance(500)
  expect(runs).toHaveLength(0)
  await clock.advance(300)
  expect(runs).toHaveLength(1)
  expect(runs[0]?.requests).toEqual([
    { callerSessionId: 'pane-1', command: 'status', args: { action: 'set', key: 'todo', text: '할 일 1/4', color: 'blue' } },
    { callerSessionId: 'pane-1', command: 'progress', args: { value: 25 } },
  ])

  const info = await $.command.run({ command: 'chips', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(info.text).toContain('할 일 1/4 [blue]')
  expect(info.text).toContain('배치 2회')
})

test('TaskCreate×2 + TaskUpdate → 1/2, 하위 에이전트의 TodoWrite는 무시', async ($, on) => {
  const runs: Ran[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, MCW_ENV)
  engine(on, runs)
  await begin($, clock, runs)

  await $.tool.call({ tool: 'TaskCreate', subject: '설계', description: 'd' })
  await $.tool.call({ tool: 'TaskCreate', subject: '구현', description: 'd' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await clock.advance(1000)
  expect(sets(runs)).toEqual({ todo: { text: '할 일 1/2', color: 'blue' }, progress: { value: 50 } })
  runs.length = 0

  // 하위 에이전트 루프의 호출(agentId는 ToolCallArgs 리터럴엔 없어 변수로 넘긴다)
  const fromSubagent = { tool: 'TodoWrite' as const, todos: [...TODOS], agentId: 'sub-1' }
  await $.tool.call(fromSubagent)
  await clock.advance(2000)
  expect(runs).toHaveLength(0)
})

test('컨텍스트 86% → 빨간 ctx 칩', async ($, on) => {
  const runs: Ran[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, MCW_ENV)
  engine(on, runs)
  await begin($, clock, runs)
  await $.session.measure({ context: { window: 200_000, tokens: 172_000, percent: 86 }, rateLimits: [], changed: ['context'] })
  await clock.advance(1000)
  expect(sets(runs)).toEqual({ ctx: { text: 'ctx 86%', color: 'red' } })
})

test('에이전트 시작 → 칩, 끝 → 지움', async ($, on) => {
  const runs: Ran[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, MCW_ENV)
  engine(on, runs)
  await begin($, clock, runs)
  const spawned = await $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'find',
    description: 'explore',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    model: 'haiku',
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
  expect(spawned.agentId).toBe('ag-explore')
  await clock.advance(1000)
  expect(sets(runs)).toEqual({ agents: { text: '에이전트 1 · haiku', color: 'blue' } })
  runs.length = 0
  await $.turn.complete({ answer: 'done', durationMs: 5000, isAborted: false, turnId: 's1', agentId: 'ag-explore', reason: 'answer' })
  await clock.advance(1000)
  expect(sets(runs)).toEqual({ agents: 'cleared' })
})

test('vitest 실패 → 테스트 실행 중, 그다음 `테스트 3 실패` 빨강', async ($, on) => {
  const runs: Ran[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, MCW_ENV)
  engine(on, runs, {
    // 테스트 명령은 2초 걸린다(가짜 시계).
    Bash: async input => {
      if (!String(input['command']).startsWith('npx vitest')) {
        return shell('fine')
      }
      await clock.sleep(2000)

      return { isError: true, result: `Exit code 1
${VITEST_FAIL}`, text: `Exit code 1
${VITEST_FAIL}` }
    },
  })
  await begin($, clock, runs)
  const pending = $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
  await clock.advance(1000)
  expect(sets(runs)).toEqual({ test: { text: '테스트 실행 중', color: 'blue' } })
  runs.length = 0
  await clock.advance(1500)
  const ran = await pending
  expect(ran.isError).toBe(true)
  expect(ran.text).toContain('Tests  3 failed')
  await clock.advance(1000)
  expect(sets(runs)).toEqual({ test: { text: '테스트 3 실패', color: 'red' } })
  runs.length = 0
  // 테스트가 아닌 명령은 칩을 건드리지 않는다
  await $.tool.call({ tool: 'Bash', command: 'cat vitest.config.ts' })
  await clock.advance(1000)
  expect(runs).toHaveLength(0)
})

test('백그라운드 빌드: bg 칩 + busy → 알림 → ✓ build → linger 뒤 지움', async ($, on) => {
  const runs: Ran[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, MCW_ENV)
  engine(on, runs, { Bash: () => shell('Command running in background with ID: bx1', { backgroundTaskId: 'bx1' }) })
  await begin($, clock, runs)

  await $.tool.call({ tool: 'Bash', command: 'cd C:/dev/app && npm run build', run_in_background: true })
  await clock.advance(1000)
  expect(sets(runs)).toEqual({ bg: { text: 'bg 1 · npm run build <1m', color: 'amber' }, progress: { state: 'indeterminate' } })
  runs.length = 0

  // 분 단위로만 바뀐다
  await clock.advance(60_000)
  expect(sets(runs)).toEqual({ bg: { text: 'bg 1 · npm run build 1m', color: 'amber' } })
  runs.length = 0

  await clock.advance(62_000)
  runs.length = 0
  const text = '<task-notification>\n<task-id>bx1</task-id>\n<status>completed</status>\n<summary>Background command "npm run build" completed (exit code 0)</summary>\n</task-notification>'
  const submitted = await $.prompt.submit({ text, wait: false, isMeta: true, origin: { kind: 'task-notification' } })
  expect(submitted.text).toBe(text)
  // 같은 알림이 delivery로도 오면 한 번만 처리
  await $.session.receive({ origin: { kind: 'task-notification' }, text })
  await clock.advance(1000)
  expect(sets(runs)).toEqual({ bg: 'cleared', 'bg-done': { text: '✓ build 2m03s', color: 'green' }, progress: { clear: true } })
  runs.length = 0

  await clock.advance(60_000)
  expect(sets(runs)).toEqual({ 'bg-done': 'cleared' })
})

test('Stop의 background_tasks로 놓친 작업을 더하고 사라진 작업을 뺀다', async ($, on) => {
  const runs: Ran[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, MCW_ENV)
  engine(on, runs, { Bash: () => shell('started', { backgroundTaskId: 'gone' }) })
  await begin($, clock, runs)
  await $.tool.call({ tool: 'Bash', command: 'npm run lint', run_in_background: true })
  await clock.advance(5000)
  runs.length = 0

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'w1', type: 'workflow', status: 'running', description: 'review', name: 'code-review' }] })
  await clock.advance(1000)
  expect(sets(runs)).toEqual({ bg: { text: 'bg 1 · code-review <1m', color: 'amber' } })
})

test('/clear면 우리 칩과 진행선을 바로 지운다', async ($, on) => {
  const runs: Ran[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, MCW_ENV)
  engine(on, runs)
  await begin($, clock, runs)
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
  await $.session.measure({ context: { window: 200_000, tokens: 100_000, percent: 50 }, rateLimits: [], changed: ['context'] })
  await clock.advance(1000)
  runs.length = 0

  await $.session.end({ reason: 'clear', sessionId: 's-old', resume: { id: 's-old' } })
  await clock.settle()
  expect(sets(runs)).toEqual({ todo: 'cleared', ctx: 'cleared', progress: { clear: true } })
})

test('process.run이 거부돼도 훅은 던지지 않고 결과는 그대로', async ($, on) => {
  const runs: Ran[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, MCW_ENV)
  engine(on, runs, {}, true)
  await $.session.start(START)
  await clock.advance(1000)
  const ran = await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
  expect(ran.result).toEqual({ oldTodos: [], newTodos: TODOS })
  await clock.advance(1000)
  expect(runs.length).toBeGreaterThan(0)
  const info = await $.command.run({ command: 'chips', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(info.text).toContain('마지막 오류')
})
