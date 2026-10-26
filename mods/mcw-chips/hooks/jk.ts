import type { ChipsChip, ChipsHealth, ChipsProgress, ChipsWire } from '../types'
import { CHIP_KEYS } from './chips'

// jk(멀티 터미널 작업기 제어 서버)로 칩·진행선을 보낸다.
// diff·인코딩·출력 파싱은 순수 함수, Flusher와 transport는 run·clock을 주입받는다 — $를 모른다.
// 토큰은 여기서 읽지 않는다: 자식 PowerShell이 물려받은 $env:JK_CODING_CLI_TOKEN을 직접 붙인다.

export type JkOp =
  | { kind: 'clear'; key: string }
  | { kind: 'set'; key: string; text: string; color: ChipsChip['color'] }
  | { kind: 'progress'; progress: ChipsProgress | null }

export type OpResult = { ok: true } | { ok: false; error: string }

export type JkRequest = { callerSessionId: string; command: 'status' | 'progress'; args: Record<string, unknown> }

export type RunResult = { exitCode: number; stdout: string; stderr: string }

export type Run = (argv: readonly string[], init?: { env?: Record<string, string>; stdin?: string; timeoutMs?: number }) => Promise<RunResult>

export const CHIP_LIMIT_ERROR = /칩은 세션마다/
export const DISABLE_ERROR = /세션이 실행 중이 아닙니다|인증 실패|토큰 없음|no-token|no-pipe/

export const LATENCY_KEEP = 20
export const BACKOFF_AFTER = 3
export const BACKOFF_MS = 60_000
export const OFF_AFTER = 6
export const PIPE_TIMEOUT_MS = 4_000
export const PIPE_FALLBACK_AFTER = 2

// ---- diff ----

function sameProgress(a: ChipsProgress | null, b: ChipsProgress | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// 바뀐 것만, clear → set → progress 순서로. sent===null이면 모르는 상태라 우리 키를 전부 지우고 진행선도 보낸다.
// blocked(칩 8개 한도에 걸린 키)는 set하지 않는다.
export function diff(sent: ChipsWire | null, desired: ChipsWire, blocked: ReadonlySet<string> = new Set()): JkOp[] {
  const clears: JkOp[] = []
  const sets: JkOp[] = []
  for (const key of CHIP_KEYS) {
    const want = desired.chips[key]
    const had = sent?.chips[key]
    if (want === undefined) {
      if (sent === null || had !== undefined) {
        clears.push({ kind: 'clear', key })
      }
    } else if (!blocked.has(key) && (had === undefined || had.text !== want.text || had.color !== want.color)) {
      sets.push({ kind: 'set', key, text: want.text, color: want.color })
    }
  }
  const ops = [...clears, ...sets]
  if (sent === null || !sameProgress(sent.progress, desired.progress)) {
    ops.push({ kind: 'progress', progress: desired.progress })
  }

  return ops
}

export function applyOp(wire: ChipsWire, op: JkOp) {
  if (op.kind === 'clear') {
    delete wire.chips[op.key]
  } else if (op.kind === 'set') {
    wire.chips[op.key] = { text: op.text, color: op.color }
  } else {
    wire.progress = op.progress
  }
}

// control-cli-installer.ts의 ps1이 만드는 요청과 1:1 (token은 자식이 붙인다).
export function requestFor(op: JkOp, callerSessionId: string): JkRequest {
  if (op.kind === 'clear') {
    return { callerSessionId, command: 'status', args: { action: 'clear', key: op.key } }
  }
  if (op.kind === 'set') {
    return { callerSessionId, command: 'status', args: { action: 'set', key: op.key, text: op.text, color: op.color } }
  }
  if (op.progress === null) {
    return { callerSessionId, command: 'progress', args: { clear: true } }
  }

  return op.progress.kind === 'busy'
    ? { callerSessionId, command: 'progress', args: { state: 'indeterminate' } }
    : { callerSessionId, command: 'progress', args: { value: op.progress.value } }
}

// jk-coding-cli 인자: status set <key> <텍스트> --color <c> | status clear <key> | progress <n>|busy|clear
export function cliArgs(op: JkOp): string[] {
  if (op.kind === 'clear') {
    return ['status', 'clear', op.key]
  }
  if (op.kind === 'set') {
    return ['status', 'set', op.key, op.text, '--color', op.color]
  }

  return ['progress', op.progress === null ? 'clear' : op.progress.kind === 'busy' ? 'busy' : String(op.progress.value)]
}

// ---- base64 (런타임에 Buffer·btoa가 있다고 가정하지 않는다) ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }

  return out
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of clean) {
    buffer = (buffer << 6) | B64.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 255)
    }
  }

  return new Uint8Array(out)
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

export function base64ToUtf8(text: string): string {
  return new TextDecoder().decode(base64ToBytes(text))
}

// powershell -EncodedCommand가 받는 형식: UTF-16LE의 base64.
export function encodeCommand(script: string): string {
  const bytes = new Uint8Array(script.length * 2)
  for (let i = 0; i < script.length; i += 1) {
    const unit = script.charCodeAt(i)
    bytes[i * 2] = unit & 255
    bytes[i * 2 + 1] = unit >> 8
  }

  return bytesToBase64(bytes)
}

// 한 줄에 요청 하나: UTF-8 JSON의 base64 (PS 5.1 stdin 인코딩 문제를 피한다).
export function encodeBatch(requests: readonly JkRequest[]): string {
  return requests.map(request => utf8ToBase64(JSON.stringify(request))).join('\n') + '\n'
}

export class JkFatal extends Error {}

// 스크립트 출력: 요청마다 `ok <i>` 또는 `err <i> <base64 메시지>`, 시작 전에 막히면 `fatal <이유>`.
export function parseBatchOutput(stdout: string, count: number): OpResult[] {
  const results: Array<OpResult | undefined> = new Array(count).fill(undefined)
  let seen = 0
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    const fatal = line.match(/^fatal\s+(.*)$/)
    if (fatal) {
      throw new JkFatal(fatal[1] || 'fatal')
    }
    const hit = line.match(/^(ok|err)\s+(\d+)(?:\s+(\S+))?$/)
    if (!hit) {
      continue
    }
    const index = Number(hit[2])
    if (index < 0 || index >= count) {
      continue
    }
    seen += 1
    results[index] = hit[1] === 'ok' ? { ok: true } : { ok: false, error: hit[3] ? base64ToUtf8(hit[3]) : 'unknown error' }
  }
  if (seen === 0 && count > 0) {
    throw new JkFatal(`unparseable output: ${stdout.slice(0, 200)}`)
  }

  return results.map(result => result ?? { ok: false, error: 'no result' })
}

// 요청마다 파이프에 새로 연결한다(서버는 응답 한 줄 뒤 연결을 닫는다). 출력은 ASCII뿐.
export const PIPE_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Say([string]$line) { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
function B64([string]$text) { [Convert]::ToBase64String($utf8.GetBytes($text)) }
$token = $env:JK_CODING_CLI_TOKEN
if ([string]::IsNullOrEmpty($token)) { Say 'fatal no-token'; exit 0 }
$pipeName = $env:JK_CODING_CLI_PIPE
if ([string]::IsNullOrEmpty($pipeName)) { Say 'fatal no-pipe'; exit 0 }
$head = '{"token":' + (ConvertTo-Json -InputObject ([string]$token) -Compress) + ','
$i = 0
while ($null -ne ($b64 = [Console]::In.ReadLine())) {
  $b64 = $b64.Trim()
  if ($b64.Length -eq 0) { continue }
  $pipe = $null
  $err = $null
  try {
    $json = $utf8.GetString([Convert]::FromBase64String($b64))
    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(1500)
    $writer = New-Object System.IO.StreamWriter($pipe, $utf8)
    $writer.AutoFlush = $true
    $writer.WriteLine($head + $json.Substring(1))
    $reader = New-Object System.IO.StreamReader($pipe, $utf8)
    $line = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($line)) { $err = 'no response' }
    else {
      $response = ConvertFrom-Json $line
      if (-not $response.ok) { $err = [string]$response.error; if ([string]::IsNullOrEmpty($err)) { $err = 'error' } }
    }
  } catch { $err = [string]$_.Exception.Message; if ([string]::IsNullOrEmpty($err)) { $err = 'exception' } }
  finally { if ($pipe) { $pipe.Dispose() } }
  if ($null -eq $err) { Say ('ok ' + $i) } else { Say ('err ' + $i + ' ' + (B64 $err)) }
  $i++
}
exit 0
`

// ---- transports ----

export type Transport = {
  name: () => string
  send: (ops: readonly JkOp[]) => Promise<OpResult[]>
}

export type TransportEnv = {
  callerSessionId: string
  isWindows: boolean
  powershell: string
  // pipe 이름이 JK_CODING_CLI_ENDPOINT(pipe://…)에서만 왔을 때 자식에게 넘길 값.
  pipeEnv: Record<string, string> | undefined
  // jk-coding-cli(.ps1) 경로를 찾는다(없으면 null). 한 번만 부르도록 호출 측에서 memo.
  findCli: () => Promise<string | null>
}

export function pipeArgv(powershell: string): string[] {
  return [powershell, '-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodeCommand(PIPE_SCRIPT)]
}

export function pipeTransport(run: Run, env: TransportEnv): Transport {
  const argv = pipeArgv(env.powershell)

  return {
    name: () => 'pipe',
    send: async ops => {
      const stdin = encodeBatch(ops.map(op => requestFor(op, env.callerSessionId)))
      const ran = await run(argv, { stdin, timeoutMs: PIPE_TIMEOUT_MS, ...(env.pipeEnv ? { env: env.pipeEnv } : {}) })

      return parseBatchOutput(ran.stdout, ops.length)
    },
  }
}

const CLI_OK = /->\s*\S/

function cliError(ran: RunResult): string {
  const text = (ran.stderr || ran.stdout).trim().replace(/^jk-coding-cli:\s*/, '')

  return text || `exit ${ran.exitCode}`
}

// op마다 jk-coding-cli를 실행한다(한 flush의 op는 동시에). Windows는 .ps1을 powershell -File로.
export function cliTransport(run: Run, env: TransportEnv): Transport {
  return {
    name: () => 'cli',
    send: async ops => {
      const cli = await env.findCli()
      if (cli === null) {
        throw new JkFatal('jk-coding-cli를 찾지 못했습니다')
      }

      return Promise.all(
        ops.map(async (op): Promise<OpResult> => {
          // PS 5.1 -File 인자 처리에서 큰따옴표가 깨지므로 작은따옴표로 바꾼다(표시만 다르다).
          const args = env.isWindows ? cliArgs(op).map(arg => arg.replaceAll('"', "'")) : cliArgs(op)
          const argv = env.isWindows ? [env.powershell, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', cli, ...args] : [cli, ...args]
          try {
            const ran = await run(argv, { timeoutMs: PIPE_TIMEOUT_MS })

            // PS 5.1은 -File 경로가 없어도 0으로 끝난다: 클라이언트의 성공 줄(`상태 칩 -> id`, `진행률 -> id`)까지 본다.
            return ran.exitCode === 0 && CLI_OK.test(ran.stdout) ? { ok: true } : { ok: false, error: cliError(ran) }
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
        }),
      )
    },
  }
}

// auto: Windows는 pipe로 시작해 치명적 실패(시작 실패·fatal·해석 불가) 2번이면 cli로 내려간다. Linux는 cli.
export function autoTransport(run: Run, env: TransportEnv): Transport {
  const pipe = pipeTransport(run, env)
  const cli = cliTransport(run, env)
  let current: Transport = env.isWindows ? pipe : cli
  let fatals = 0

  return {
    name: () => `auto:${current.name()}`,
    send: async ops => {
      if (current === cli) {
        return cli.send(ops)
      }
      try {
        const results = await pipe.send(ops)
        fatals = 0

        return results
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!DISABLE_ERROR.test(message)) {
          fatals += 1
          if (fatals >= PIPE_FALLBACK_AFTER && (await env.findCli()) !== null) {
            current = cli
          }
        }
        throw error
      }
    },
  }
}

export function makeTransport(kind: string, run: Run, env: TransportEnv): Transport {
  if (kind === 'pipe') {
    return env.isWindows ? pipeTransport(run, env) : cliTransport(run, env)
  }
  if (kind === 'cli') {
    return cliTransport(run, env)
  }

  return autoTransport(run, env)
}

// ---- Flusher ----

export type FlusherClock = {
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => { cancel: () => void }
}

export type FlusherDeps = {
  clock: FlusherClock
  transport: Transport
  debounceMs: number
  desired: (now: number) => ChipsWire | Promise<ChipsWire>
  sent: ChipsWire | null
  onSent?: (sent: ChipsWire | null) => void
  onHealth?: (health: ChipsHealth) => void
  log?: (text: string) => void
}

export function emptyHealth(transport: string): ChipsHealth {
  return { transport, flushes: 0, failures: 0, consecutive: 0, backoffUntil: 0, disabled: null, blocked: [], latencies: [], lastError: null }
}

function cloneWire(wire: ChipsWire): ChipsWire {
  return { chips: { ...wire.chips }, progress: wire.progress }
}

// 고정 창(첫 요청부터 debounceMs)으로 묶고, 한 번에 하나만 보낸다. 보내는 중 바뀌면 끝난 뒤 한 번 더.
export class Flusher {
  sent: ChipsWire | null
  readonly health: ChipsHealth
  private readonly deps: FlusherDeps
  private readonly blocked = new Set<string>()
  private timer: { cancel: () => void } | null = null
  private inFlight = false
  private dirty = false
  private stopped = false

  constructor(deps: FlusherDeps) {
    this.deps = deps
    this.sent = deps.sent
    this.health = emptyHealth(deps.transport.name())
  }

  get isBusy(): boolean {
    return this.inFlight || this.timer !== null
  }

  request(): void {
    if (this.stopped || this.health.disabled !== null) {
      return
    }
    if (this.inFlight) {
      this.dirty = true

      return
    }
    if (this.timer !== null) {
      return
    }
    this.arm(this.deps.debounceMs)
  }

  // 창을 기다리지 않고 바로(이미 보내는 중이면 끝난 뒤).
  flushNow(): void {
    if (this.stopped || this.health.disabled !== null) {
      return
    }
    this.timer?.cancel()
    this.timer = null
    if (this.inFlight) {
      this.dirty = true

      return
    }
    void this.flush()
  }

  stop(): void {
    this.stopped = true
    this.timer?.cancel()
    this.timer = null
  }

  private arm(ms: number) {
    this.timer = this.deps.clock.after(Math.max(0, ms), () => {
      this.timer = null
      void this.flush()
    })
  }

  async flush(): Promise<void> {
    if (this.stopped || this.health.disabled !== null) {
      return
    }
    if (this.inFlight) {
      this.dirty = true

      return
    }
    this.inFlight = true
    this.dirty = false
    let now = 0
    try {
      now = await this.deps.clock.now()
      await this.flushOnce(now)
    } catch (error) {
      this.recordFailure(error instanceof Error ? error.message : String(error), now)
    } finally {
      this.inFlight = false
      this.deps.onHealth?.({ ...this.health, blocked: [...this.blocked], latencies: [...this.health.latencies] })
      if (this.dirty && !this.stopped && this.health.disabled === null) {
        this.dirty = false
        this.request()
      }
    }
  }

  private async flushOnce(now: number) {
    if (now < this.health.backoffUntil) {
      this.dirty = false
      this.timer?.cancel()
      this.arm(this.health.backoffUntil - now)

      return
    }
    const desired = await this.deps.desired(now)
    for (const key of [...this.blocked]) {
      if (desired.chips[key] === undefined) {
        this.blocked.delete(key)
      }
    }
    const ops = diff(this.sent, desired, this.blocked)
    if (ops.length === 0) {
      return
    }
    this.health.transport = this.deps.transport.name()
    const results = await this.deps.transport.send(ops)
    const done = await this.deps.clock.now()
    this.health.flushes += 1
    this.health.latencies = [...this.health.latencies, done - now].slice(-LATENCY_KEEP)

    const wasUnknown = this.sent === null
    const blockedBefore = [...this.blocked]
    const next = cloneWire(this.sent ?? { chips: {}, progress: null })
    let failed = 0
    let cleared = false
    let lastError: string | null = null
    ops.forEach((op, i) => {
      const result = results[i] ?? { ok: false, error: 'no result' }
      if (result.ok) {
        applyOp(next, op)
        cleared ||= op.kind === 'clear'

        return
      }
      if (op.kind === 'set' && CHIP_LIMIT_ERROR.test(result.error)) {
        this.blocked.add(op.key)
      } else if (DISABLE_ERROR.test(result.error)) {
        this.disable(result.error)
      } else {
        failed += 1
        lastError = result.error
      }
    })
    // 다른 키가 비면 막혔던 키를 다음 창에서 다시 시도한다.
    if (cleared && blockedBefore.length > 0) {
      for (const key of blockedBefore) {
        this.blocked.delete(key)
      }
      this.dirty = true
    }
    // 처음(모르는 상태)에 일부가 실패하면 무엇이 떠 있는지 모르니 다음에 처음부터 다시 맞춘다.
    this.sent = wasUnknown && failed > 0 ? null : next
    this.deps.onSent?.(this.sent)
    if (failed > 0) {
      this.recordFailure(lastError ?? 'error', now)
    } else {
      this.health.consecutive = 0
      this.health.lastError = null
    }
  }

  private recordFailure(message: string, now: number) {
    if (DISABLE_ERROR.test(message)) {
      this.disable(message)

      return
    }
    this.health.failures += 1
    this.health.consecutive += 1
    this.health.lastError = message
    if (this.health.consecutive >= OFF_AFTER) {
      this.disable(`연속 ${OFF_AFTER}번 실패: ${message}`)

      return
    }
    if (this.health.consecutive >= BACKOFF_AFTER) {
      this.health.backoffUntil = now + BACKOFF_MS
    }
    this.dirty = true
  }

  private disable(reason: string) {
    if (this.health.disabled !== null) {
      return
    }
    this.health.disabled = reason
    this.timer?.cancel()
    this.timer = null
    this.dirty = false
    this.deps.log?.(`mcw-chips: jk 전송을 이 세션 동안 끕니다 — ${reason}`)
  }
}

export function latencySummary(latencies: readonly number[]): { avg: number; p95: number } | null {
  if (latencies.length === 0) {
    return null
  }
  const sorted = [...latencies].sort((a, b) => a - b)
  const avg = Math.round(sorted.reduce((sum, ms) => sum + ms, 0) / sorted.length)
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0

  return { avg, p95 }
}
