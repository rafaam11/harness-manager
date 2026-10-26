import { describe, expect, test } from 'claude-code/testing'

import type { ChipsWire } from '../types'
import {
  base64ToUtf8,
  BACKOFF_MS,
  cliArgs,
  cliTransport,
  diff,
  encodeBatch,
  encodeCommand,
  Flusher,
  JkFatal,
  type JkOp,
  makeTransport,
  type OpResult,
  parseBatchOutput,
  PIPE_SCRIPT,
  requestFor,
  type Run,
  type Transport,
  utf8ToBase64,
} from './jk'

const EMPTY: ChipsWire = { chips: {}, progress: null }

function wire(chips: ChipsWire['chips'], progress: ChipsWire['progress'] = null): ChipsWire {
  return { chips, progress }
}

describe('diff', () => {
  test('모르는 상태(sent=null)면 우리 키를 지우고 진행선도 보낸다', async () => {
    const ops = diff(null, wire({ todo: { text: '할 일 1/2', color: 'blue' } }, { kind: 'value', value: 50 }))
    expect(ops).toEqual([
      { kind: 'clear', key: 'ctx' },
      { kind: 'clear', key: 'agents' },
      { kind: 'clear', key: 'test' },
      { kind: 'clear', key: 'bg' },
      { kind: 'clear', key: 'bg-done' },
      { kind: 'set', key: 'todo', text: '할 일 1/2', color: 'blue' },
      { kind: 'progress', progress: { kind: 'value', value: 50 } },
    ])
  })

  test('바뀐 것만 clear → set → progress 순서', async () => {
    const sent = wire({ todo: { text: '할 일 1/2', color: 'blue' }, ctx: { text: 'ctx 40%', color: 'green' } }, { kind: 'value', value: 50 })
    const want = wire({ ctx: { text: 'ctx 61%', color: 'amber' }, bg: { text: 'bg 1 · npm run build <1m', color: 'amber' } }, { kind: 'busy' })
    expect(diff(sent, want)).toEqual([
      { kind: 'clear', key: 'todo' },
      { kind: 'set', key: 'ctx', text: 'ctx 61%', color: 'amber' },
      { kind: 'set', key: 'bg', text: 'bg 1 · npm run build <1m', color: 'amber' },
      { kind: 'progress', progress: { kind: 'busy' } },
    ])
    expect(diff(want, want)).toEqual([])
    // 막힌 키는 set하지 않는다
    expect(diff(sent, want, new Set(['bg'])).some(op => op.kind === 'set' && op.key === 'bg')).toBe(false)
  })

  test('요청 형식은 jk-coding-cli ps1과 같다', async () => {
    expect(requestFor({ kind: 'set', key: 'todo', text: 't', color: 'blue' }, 'S')).toEqual({ callerSessionId: 'S', command: 'status', args: { action: 'set', key: 'todo', text: 't', color: 'blue' } })
    expect(requestFor({ kind: 'clear', key: 'bg' }, 'S').args).toEqual({ action: 'clear', key: 'bg' })
    expect(requestFor({ kind: 'progress', progress: { kind: 'value', value: 30 } }, 'S')).toEqual({ callerSessionId: 'S', command: 'progress', args: { value: 30 } })
    expect(requestFor({ kind: 'progress', progress: { kind: 'busy' } }, 'S').args).toEqual({ state: 'indeterminate' })
    expect(requestFor({ kind: 'progress', progress: null }, 'S').args).toEqual({ clear: true })
    expect(cliArgs({ kind: 'set', key: 'ctx', text: 'ctx 61%', color: 'amber' })).toEqual(['status', 'set', 'ctx', 'ctx 61%', '--color', 'amber'])
    expect(cliArgs({ kind: 'progress', progress: { kind: 'busy' } })).toEqual(['progress', 'busy'])
    expect(cliArgs({ kind: 'progress', progress: null })).toEqual(['progress', 'clear'])
  })
})

describe('인코딩과 출력 파싱', () => {
  test('base64 UTF-8 왕복(한글·기호)', async () => {
    for (const text of ['', 'a', 'ab', 'abc', '할 일 3/7 · ✓ build 2m03s', '{"x":"\\u0000"}']) {
      expect(base64ToUtf8(utf8ToBase64(text))).toBe(text)
    }
    expect(utf8ToBase64('hello')).toBe('aGVsbG8=')
  })

  test('배치 stdin: 줄마다 토큰 없는 JSON 하나', async () => {
    const stdin = encodeBatch([requestFor({ kind: 'set', key: 'todo', text: '할 일 1/2', color: 'blue' }, 'S'), requestFor({ kind: 'progress', progress: null }, 'S')])
    const lines = stdin.trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(base64ToUtf8(lines[0] ?? '')) as Record<string, unknown>
    expect(first).toEqual({ callerSessionId: 'S', command: 'status', args: { action: 'set', key: 'todo', text: '할 일 1/2', color: 'blue' } })
    expect('token' in first).toBe(false)
    expect(lines.every(line => /^[A-Za-z0-9+/=]+$/.test(line))).toBe(true)
  })

  test('-EncodedCommand는 UTF-16LE base64', async () => {
    expect(encodeCommand('ab')).toBe('YQBiAA==')
    expect(encodeCommand(PIPE_SCRIPT)).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(PIPE_SCRIPT).toContain('$env:JK_CODING_CLI_TOKEN')
    expect(PIPE_SCRIPT).toContain('NamedPipeClientStream')
  })

  test('parseBatchOutput: ok/err, 빠진 줄, fatal, 해석 불가', async () => {
    const out = `ok 0\r\nerr 1 ${utf8ToBase64('칩은 세션마다 8개까지입니다. jk status clear로 정리하세요.')}\r\n`
    expect(parseBatchOutput(out, 3)).toEqual([{ ok: true }, { ok: false, error: '칩은 세션마다 8개까지입니다. jk status clear로 정리하세요.' }, { ok: false, error: 'no result' }])
    expect(() => parseBatchOutput('fatal no-token\n', 2)).toThrow('no-token')
    expect(() => parseBatchOutput('garbage', 2)).toThrow(JkFatal)
  })
})

describe('transport', () => {
  const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  const CLI = 'C:\\app\\bin\\jk-coding-cli.ps1'
  const env = (findCli: () => Promise<string | null>) => ({ callerSessionId: 'S', isWindows: true, powershell: PS, pipeEnv: undefined, findCli })

  test('cli: powershell -File로 op마다, 성공 줄이 있어야 ok', async () => {
    const argvs: Array<readonly string[]> = []
    const run: Run = async argv => {
      argvs.push(argv)
      const isSet = argv.includes('set')

      return isSet ? { exitCode: 0, stdout: '상태 칩 -> S\r\n', stderr: '' } : { exitCode: 0, stdout: '', stderr: "The argument 'x' to the -File parameter does not exist." }
    }
    const results = await cliTransport(run, env(async () => CLI)).send([
      { kind: 'set', key: 'bg', text: 'bg 1 · echo "hi" <1m', color: 'amber' },
      { kind: 'clear', key: 'todo' },
    ])
    expect(results[0]).toEqual({ ok: true })
    expect(results[1]?.ok).toBe(false)
    expect(argvs[0]).toEqual([PS, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', CLI, 'status', 'set', 'bg', "bg 1 · echo 'hi' <1m", '--color', 'amber'])
  })

  test('cli: 앱 오류는 접두를 떼고 넘긴다', async () => {
    const run: Run = async () => ({ exitCode: 1, stdout: '', stderr: 'jk-coding-cli: 칩은 세션마다 8개까지입니다. jk status clear로 정리하세요.\r\n' })
    expect(await cliTransport(run, env(async () => CLI)).send([{ kind: 'set', key: 'bg', text: 'x', color: 'amber' }])).toEqual([{ ok: false, error: '칩은 세션마다 8개까지입니다. jk status clear로 정리하세요.' }])
  })

  test('auto: pipe가 두 번 치명적으로 실패하면 cli로 내려간다', async () => {
    const seen: string[] = []
    const run: Run = async argv => {
      if (argv.includes('-EncodedCommand')) {
        seen.push('pipe')

        return { exitCode: 0, stdout: 'garbage', stderr: '' }
      }
      seen.push('cli')

      return { exitCode: 0, stdout: '진행률 -> S', stderr: '' }
    }
    const auto = makeTransport('auto', run, env(async () => CLI))
    const op: JkOp = { kind: 'progress', progress: null }
    await expect(auto.send([op])).rejects.toThrow(JkFatal)
    await expect(auto.send([op])).rejects.toThrow(JkFatal)
    expect(auto.name()).toBe('auto:cli')
    expect(await auto.send([op])).toEqual([{ ok: true }])
    expect(seen).toEqual(['pipe', 'pipe', 'cli'])
  })
})

// ---- Flusher: 가짜 시계와 transport ----

type Deferred = { resolve: (results: OpResult[]) => void; reject: (error: Error) => void; ops: readonly JkOp[] }

function fakeClock() {
  let now = 0
  let timers: Array<{ at: number; fn: () => void; isCancelled: boolean }> = []
  const settle = async () => {
    for (let i = 0; i < 30; i += 1) {
      await Promise.resolve()
    }
  }

  return {
    clock: {
      now: async () => now,
      after: (ms: number, fn: () => void) => {
        const timer = { at: now + ms, fn, isCancelled: false }
        timers.push(timer)

        return { cancel: () => void (timer.isCancelled = true) }
      },
    },
    pending: () => timers.filter(timer => !timer.isCancelled).length,
    settle,
    advance: async (ms: number) => {
      const target = now + ms
      for (;;) {
        await settle()
        const due = timers.filter(timer => !timer.isCancelled && timer.at <= target).sort((a, b) => a.at - b.at)[0]
        if (!due) {
          break
        }
        now = due.at
        due.isCancelled = true
        timers = timers.filter(timer => !timer.isCancelled)
        due.fn()
      }
      now = target
      await settle()
    },
  }
}

function setup(answer: (ops: readonly JkOp[], call: number) => OpResult[] | Error | 'hold') {
  const time = fakeClock()
  const calls: Array<readonly JkOp[]> = []
  const held: Deferred[] = []
  const logs: string[] = []
  let current: ChipsWire = EMPTY
  const transport: Transport = {
    name: () => 'fake',
    send: ops => {
      calls.push(ops)
      const answered = answer(ops, calls.length)
      if (answered === 'hold') {
        return new Promise((resolve, reject) => held.push({ resolve, reject, ops }))
      }

      return answered instanceof Error ? Promise.reject(answered) : Promise.resolve(answered)
    },
  }
  const flusher = new Flusher({ clock: time.clock, transport, debounceMs: 750, sent: EMPTY, desired: () => current, log: text => logs.push(text) })

  return { ...time, calls, held, logs, flusher, setDesired: (next: ChipsWire) => void (current = next) }
}

const okAll = (ops: readonly JkOp[]) => ops.map((): OpResult => ({ ok: true }))
const TODO = (text: string) => wire({ todo: { text, color: 'blue' } })

describe('Flusher', () => {
  test('고정 창: 750ms 안의 변경은 한 번에, 최종 값만', async () => {
    const t = setup(okAll)
    t.setDesired(TODO('할 일 1/3'))
    t.flusher.request()
    await t.advance(300)
    t.setDesired(TODO('할 일 2/3'))
    t.flusher.request()
    await t.advance(300)
    expect(t.calls).toHaveLength(0)
    await t.advance(200)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0]).toEqual([{ kind: 'set', key: 'todo', text: '할 일 2/3', color: 'blue' }])
    expect(t.flusher.sent).toEqual(TODO('할 일 2/3'))
    expect(t.flusher.health.latencies).toHaveLength(1)
  })

  test('보내는 중 바뀌면 끝난 뒤 딱 한 번 더', async () => {
    const t = setup((ops, call) => (call === 1 ? 'hold' : okAll(ops)))
    t.setDesired(TODO('할 일 1/3'))
    t.flusher.request()
    await t.advance(750)
    expect(t.calls).toHaveLength(1)
    for (const text of ['할 일 2/3', '할 일 3/4', '할 일 3/5']) {
      t.setDesired(TODO(text))
      t.flusher.request()
    }
    await t.advance(5000)
    expect(t.calls).toHaveLength(1)
    t.held[0]?.resolve(okAll(t.held[0].ops))
    await t.advance(750)
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1]).toEqual([{ kind: 'set', key: 'todo', text: '할 일 3/5', color: 'blue' }])
    await t.advance(5000)
    expect(t.calls).toHaveLength(2)
  })

  test('부분 실패: 성공한 op만 sent에 반영하고 실패한 것만 다시 보낸다', async () => {
    const t = setup((ops, call) => (call === 1 ? ops.map((op): OpResult => (op.kind === 'set' && op.key === 'ctx' ? { ok: false, error: 'pipe busy' } : { ok: true })) : okAll(ops)))
    t.setDesired(wire({ todo: { text: '할 일 1/2', color: 'blue' }, ctx: { text: 'ctx 40%', color: 'green' } }))
    t.flusher.request()
    await t.advance(750)
    expect(t.flusher.sent?.chips['todo']).toBeDefined()
    expect(t.flusher.sent?.chips['ctx']).toBeUndefined()
    await t.advance(750)
    expect(t.calls[1]).toEqual([{ kind: 'set', key: 'ctx', text: 'ctx 40%', color: 'green' }])
    expect(t.flusher.health.consecutive).toBe(0)
  })

  test('연속 3번 실패하면 60초 쉬고, 6번이면 끈다(debug 로그 1줄)', async () => {
    const t = setup(() => new Error('timeout'))
    t.setDesired(TODO('할 일 1/2'))
    t.flusher.request()
    await t.advance(750 * 3)
    expect(t.calls).toHaveLength(3)
    expect(t.flusher.health.backoffUntil).toBeGreaterThan(0)
    await t.advance(30_000)
    expect(t.calls).toHaveLength(3)
    await t.advance(BACKOFF_MS)
    expect(t.calls).toHaveLength(4)
    await t.advance(BACKOFF_MS * 3)
    expect(t.calls).toHaveLength(6)
    expect(t.flusher.health.disabled).toContain('연속 6번')
    expect(t.logs).toHaveLength(1)
    t.flusher.request()
    await t.advance(BACKOFF_MS * 2)
    expect(t.calls).toHaveLength(6)
    expect(t.pending()).toBe(0)
  })

  test('칩 8개 한도에 걸린 키는 막아 두고, 다른 키가 비면 다시 시도', async () => {
    const limit = '칩은 세션마다 8개까지입니다. jk status clear로 정리하세요.'
    const t = setup((ops, call) => ops.map((op): OpResult => (call <= 2 && op.kind === 'set' && op.key === 'bg' ? { ok: false, error: limit } : { ok: true })))
    t.setDesired(wire({ todo: { text: '할 일 1/2', color: 'blue' }, bg: { text: 'bg 1 · npm run build <1m', color: 'amber' } }))
    t.flusher.request()
    await t.advance(750)
    expect(t.flusher.health.consecutive).toBe(0)
    // 같은 값이면 막힌 키는 다시 보내지 않는다
    t.flusher.request()
    await t.advance(750)
    expect(t.calls).toHaveLength(1)
    // todo가 비면(clear 성공) bg를 다시 시도한다
    t.setDesired(wire({ bg: { text: 'bg 1 · npm run build <1m', color: 'amber' } }))
    t.flusher.request()
    await t.advance(750)
    expect(t.calls[1]).toEqual([{ kind: 'clear', key: 'todo' }])
    t.flusher.request()
    await t.advance(750)
    expect(t.calls[2]).toEqual([{ kind: 'set', key: 'bg', text: 'bg 1 · npm run build <1m', color: 'amber' }])
    expect(t.flusher.sent?.chips['bg']).toBeDefined()
  })

  test('세션이 실행 중이 아님·인증 실패면 이 세션 동안 끈다', async () => {
    const t = setup(ops => ops.map((): OpResult => ({ ok: false, error: '인증 실패: 이 앱 인스턴스가 발급한 토큰이 아닙니다.' })))
    t.setDesired(TODO('할 일 1/2'))
    t.flusher.request()
    await t.advance(750)
    expect(t.flusher.health.disabled).toContain('인증 실패')
    t.setDesired(TODO('할 일 2/2'))
    t.flusher.request()
    await t.advance(5000)
    expect(t.calls).toHaveLength(1)
  })
})
