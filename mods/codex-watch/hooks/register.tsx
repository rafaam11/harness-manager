import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CodexJob } from '../types'
import { detectCompanion, finishedMessage, kindLabel, parseStatus } from './status'

// 관찰형 mod: codex 플러그인의 리뷰·작업이 도는 동안 입력창 위에 한 줄로 보여 주고,
// 끝나면 토스트와 알림을 띄운다. 툴 호출은 next(e) 결과를 그대로 돌려준다.

type Watch = {
  companion: string | null
  root: string | null
  known: Set<string>
  timer: Timer | null
  ticks: number
  idlePolls: number
}

const runningAtom = atom({ plugin: 'codex-watch', key: 'running' } as const, [])
const recentAtom = atom({ plugin: 'codex-watch', key: 'recent' } as const, [])
const frameAtom = atom({ plugin: 'codex-watch', key: 'frame' } as const, 0)
const nowAtom = atom({ plugin: 'codex-watch', key: 'now' } as const, 0)

const TICK_MS = 1_000
const POLL_EVERY_TICKS = 5
const STATUS_TIMEOUT_MS = 10_000
const RECENT_LIMIT = 5
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)

  return minutes === 0 ? `${seconds}초` : minutes < 60 ? `${minutes}분 ${seconds % 60}초` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`
}

// companion 경로를 아직 모르면 설치된 codex 플러그인의 최신 버전에서 찾는다.
async function findCompanion($: EngineInterface): Promise<string | null> {
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  if (!home) {
    return null
  }
  const base = `${home}/.claude/plugins/cache/openai-codex/codex`
  const versions = (await $.fs.list(base).catch(() => []))
    .filter(entry => entry.kind === 'dir' && /^\d+(\.\d+)*$/.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const latest = versions[versions.length - 1]

  return latest ? `${base}/${latest}/scripts/codex-companion.mjs` : null
}

async function poll($: EngineInterface, w: Watch) {
  if (!w.companion || !w.root) {
    return
  }
  const ran = await $.process.run(['node', w.companion, 'status', '--json'], { cwd: w.root, timeoutMs: STATUS_TIMEOUT_MS }).catch(() => null)
  const status = ran && ran.exitCode === 0 ? parseStatus(ran.stdout) : null
  if (!status) {
    return
  }
  for (const id of w.known) {
    if (!status.running.some(job => job.id === id)) {
      const done = status.finished.find(job => job.id === id)
      if (done) {
        const message = finishedMessage(done)
        $.ui.toast(message)
        void $.ui.notify(message, { title: kindLabel(done.kind) }).catch(() => undefined)
        await update($, recentAtom, list => [done, ...list.filter(job => job.id !== done.id)].slice(0, RECENT_LIMIT))
      }
    }
  }
  w.known = new Set(status.running.map(job => job.id))
  w.idlePolls = status.running.length === 0 ? w.idlePolls + 1 : 0
  await update($, runningAtom, () => status.running)
  // 막 시작한 작업이 큐에 오르기 전일 수 있어 두 번 비어 있을 때 멈춘다.
  if (w.idlePolls >= 2) {
    w.timer?.cancel()
    w.timer = null
  }
}

async function tick($: EngineInterface, w: Watch) {
  w.ticks += 1
  await update($, frameAtom, frame => frame + 1)
  const now = await $.clock.now()
  await update($, nowAtom, () => now)
  if (w.ticks % POLL_EVERY_TICKS === 1) {
    await poll($, w)
  }
}

// 다음 틱에 바로 상태를 묻고, 그 뒤로는 5초마다.
function startWatching($: EngineInterface, w: Watch) {
  w.idlePolls = 0
  w.ticks = 0
  if (w.timer === null) {
    w.timer = $.clock.every(TICK_MS, () => void tick($, w))
  }
}

export const register: Register = on => {
  const w: Watch = { companion: null, root: null, known: new Set(), timer: null, ticks: 0, idlePolls: 0 }

  on('session.start', async ($, e, next) => {
    w.timer?.cancel()
    w.timer = null
    await $.command
      .register({ name: 'codex-watch', description: '지금 도는 Codex 작업과 최근에 끝난 작업 보기' })
      .catch(() => undefined)
    w.root = await $.session.root().catch(() => e.cwd)
    w.companion = await findCompanion($)
    // 세션을 다시 열었을 때 이미 돌고 있던 작업도 잡는다.
    startWatching($, w)

    return next(e)
  })

  on('command.run', { command: 'codex-watch' }, async $ => {
    const running = await read($, runningAtom)
    const recent = await read($, recentAtom)
    const now = await $.clock.now()
    const lines = [
      ...running.map(job => `진행 중  ${kindLabel(job.kind)} · ${job.startedAt ? duration(now - job.startedAt) : '?'}${job.phase ? ` · ${job.phase}` : ''} (${job.id})`),
      ...recent.map(job => `끝남     ${finishedMessage(job)} (${job.id})`),
    ]

    return { text: lines.length > 0 ? lines.join('\n') : '이 세션에서 본 Codex 작업이 없습니다.' }
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const found = detectCompanion(String((e as unknown as { command?: unknown }).command ?? ''))
    if (found) {
      w.companion = found.path
      startWatching($, w)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && w.timer === null && w.known.size > 0) {
      startWatching($, w)
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    w.timer?.cancel()

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const running = await read($, runningAtom)
    if (running.length === 0 || e.props.hasSurvey) {
      return next(e)
    }
    const frame = await read($, frameAtom)
    const now = (await read($, nowAtom)) || (await $.clock.now())
    const beneath = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const spin = SPINNER[frame % SPINNER.length] ?? '⠋'

    return (
      <Box flexDirection="column">
        {running.slice(0, 3).map((job: CodexJob) => (
          <Box key={`codex-${job.id}`}>
            <Text wrap="truncate">
              <Text color="claude">{spin} </Text>
              <Text bold>{kindLabel(job.kind)} 진행 중</Text>
              <Text dimColor>
                {job.startedAt ? ` · ${duration(now - job.startedAt)}` : ''}
                {job.phase ? ` · ${job.phase}` : ''}
              </Text>
            </Text>
          </Box>
        ))}
        {beneath}
      </Box>
    )
  })
}
