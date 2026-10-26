import type { CodexJob } from '../types'

// codex 플러그인(openai-codex)의 companion 스크립트와 그 status --json 출력을 다룬다. 순수 함수.

const WATCHED = /\b(review|adversarial-review|task)\b/

// Bash 명령에서 codex-companion.mjs 경로와 하위 명령. 감시 대상이 아니면 null.
export function detectCompanion(command: string): { path: string; sub: string } | null {
  const match = command.match(/"([^"]*codex-companion\.mjs)"|'([^']*codex-companion\.mjs)'|(\S*codex-companion\.mjs)/)
  const path = match?.[1] ?? match?.[2] ?? match?.[3]
  if (!path) {
    return null
  }
  const after = command.slice((match?.index ?? 0) + (match?.[0].length ?? 0))
  const sub = after.trim().split(/\s+/)[0]?.replace(/^["']|["']$/g, '') ?? ''

  return WATCHED.test(sub) ? { path, sub } : null
}

type RawJob = {
  id?: unknown
  kindLabel?: unknown
  kind?: unknown
  status?: unknown
  phase?: unknown
  startedAt?: unknown
  createdAt?: unknown
  summary?: unknown
  duration?: unknown
}

function toJob(raw: RawJob): CodexJob | null {
  if (typeof raw.id !== 'string') {
    return null
  }
  const started = typeof raw.startedAt === 'string' ? raw.startedAt : typeof raw.createdAt === 'string' ? raw.createdAt : null
  const at = started ? Date.parse(started) : NaN

  return {
    id: raw.id,
    kind: typeof raw.kindLabel === 'string' ? raw.kindLabel : typeof raw.kind === 'string' ? raw.kind : 'job',
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    phase: typeof raw.phase === 'string' && raw.phase !== '' ? raw.phase : null,
    startedAt: Number.isNaN(at) ? null : at,
    summary: typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary.trim() : null,
    duration: typeof raw.duration === 'string' ? raw.duration : null,
  }
}

export function parseStatus(json: string): { running: CodexJob[]; finished: CodexJob[] } | null {
  try {
    const data = JSON.parse(json) as { running?: RawJob[]; latestFinished?: RawJob | null; recent?: RawJob[] }
    const running = (data.running ?? []).map(toJob).filter((job): job is CodexJob => job !== null)
    const finished = [data.latestFinished, ...(data.recent ?? [])]
      .filter((job): job is RawJob => Boolean(job))
      .map(toJob)
      .filter((job): job is CodexJob => job !== null)

    return { running, finished }
  } catch {
    return null
  }
}

const KIND: Record<string, string> = { review: '리뷰', 'adversarial-review': '적대적 리뷰', rescue: '작업', task: '작업' }

export function kindLabel(kind: string): string {
  return `Codex ${KIND[kind] ?? kind}`
}

const STATUS: Record<string, string> = { completed: '끝', failed: '실패', cancelled: '취소됨' }

// 끝난 작업을 알리는 한 줄.
export function finishedMessage(job: CodexJob): string {
  const head = `${kindLabel(job.kind)} ${STATUS[job.status] ?? job.status}${job.duration ? ` · ${job.duration}` : ''}`
  const summary = job.summary ? ` · ${job.summary.replace(/\s+/g, ' ').slice(0, 80)}` : ''

  return `${head}${summary} — /codex:result`
}
