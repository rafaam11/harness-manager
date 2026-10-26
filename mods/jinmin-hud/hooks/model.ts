import type { HudBoard, HudGit, HudLimit, HudPr, HudTodo } from '../types'

// 상황판 데이터의 초기값·파서. IO·$ 없음.

export const RECENT_LIMIT = 20
export const TREND_LIMIT = 30
export const GIT_FILE_LIMIT = 50

export function emptyBoard(): HudBoard {
  return {
    model: null,
    effort: null,
    mode: null,
    version: null,
    sessionId: null,
    sessionName: null,
    project: null,
    mcwProject: null,
    mcwSessionId: null,
    git: null,
    context: null,
    compactAt: null,
    compactions: 0,
    pr: null,
    trend: [],
    limits: [],
    costUsd: null,
    startedAt: null,
    turns: 0,
    turnStartedAt: null,
    lastAnswerAt: null,
    running: [],
    turnTools: {},
    sessionTools: {},
    recent: [],
    agents: [],
    todos: [],
    config: null,
    breakdown: null,
    cacheTtlMs: 300_000,
    sevenDayThreshold: 80,
    maxRows: 10,
  }
}

// `git status --porcelain=v2 --branch` 출력 → 브랜치·동기화·파일 통계·목록.
export function parseGitStatus(out: string): HudGit {
  const git: HudGit = {
    branch: null,
    upstream: null,
    lastCommit: null,
    lastModified: null,
    worktree: null,
    repo: null,
    isDirty: false,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
    files: [],
  }
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      git.branch = head === '(detached)' ? 'detached' : head
    } else if (line.startsWith('# branch.upstream ')) {
      git.upstream = line.slice('# branch.upstream '.length).trim() || null
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+) -(\d+)/)
      git.ahead = Number(match?.[1] ?? 0)
      git.behind = Number(match?.[2] ?? 0)
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const fields = line.split(' ')
      const xy = fields[1] ?? '..'
      if (xy[0] !== '.') {
        git.staged += 1
      }
      if (xy[1] !== '.') {
        git.modified += 1
      }
      const path = line.startsWith('2 ') ? (fields.slice(9).join(' ').split('\t')[0] ?? '') : fields.slice(8).join(' ')
      git.files.push({ code: xy.replace(/\./g, ' ').trim() || 'M', path })
    } else if (line.startsWith('u ')) {
      git.conflicted += 1
      git.files.push({ code: 'U', path: line.split(' ').slice(10).join(' ') })
    } else if (line.startsWith('? ')) {
      git.untracked += 1
      git.files.push({ code: '?', path: line.slice(2) })
    }
  }
  git.isDirty = git.staged + git.modified + git.untracked + git.conflicted > 0
  git.files = git.files.slice(0, GIT_FILE_LIMIT)

  return git
}

// `git log -1 --format=%h%x1f%ct%x1f%s` 출력 → 마지막 커밋.
export function parseLastCommit(out: string): HudGit['lastCommit'] {
  const [hash, seconds, ...subject] = out.trim().split('\x1f')
  if (!hash || !seconds) {
    return null
  }

  return { hash, at: Number(seconds) * 1000, subject: subject.join('\x1f') }
}

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 60 * 60_000, seven_day: 7 * 24 * 60 * 60_000 }

// 사용 한도 창의 시간 경과 비율과 속도 편차(사용 − 경과 비율). 창 길이나 초기화 시각을 모르면 null.
export function paceOf(limit: HudLimit, now: number): { elapsed: number; variance: number } | null {
  const length = WINDOW_MS[limit.kind]
  if (!length || limit.resetsAt === null) {
    return null
  }
  const elapsed = Math.min(1, Math.max(0, (now - (limit.resetsAt - length)) / length))

  return { elapsed, variance: limit.percentUsed - elapsed * 100 }
}

// `git rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel`
// → 연결된 워크트리면 그 폴더 이름, 주 작업 폴더면 null.
export function parseWorktree(out: string): string | null {
  const [gitDir, commonDir, top] = out
    .trim()
    .split(/\r?\n/)
    .map(line => line.trim().replace(/\\/g, '/').replace(/\/$/, '').toLowerCase())
  if (!gitDir || !commonDir || !top || gitDir === commonDir) {
    return null
  }
  const original = out.trim().split(/\r?\n/)[2]?.trim().replace(/\\/g, '/').replace(/\/$/, '') ?? top

  return original.split('/').pop() ?? null
}

// origin URL → owner/repo (https·ssh 모두).
export function parseRemote(url: string): string | null {
  const match = url.trim().match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/)

  return match ? `${match[1]}/${match[2]}` : null
}

type GhCheck = { conclusion?: string | null; status?: string | null; state?: string | null }

// `gh pr view --json number,state,isDraft,title,url,reviewDecision,statusCheckRollup` → HudPr.
export function parsePr(json: string): HudPr | null {
  try {
    const pr = JSON.parse(json) as {
      number?: number
      state?: string
      isDraft?: boolean
      title?: string
      url?: string
      reviewDecision?: string | null
      statusCheckRollup?: GhCheck[] | null
    }
    if (typeof pr.number !== 'number') {
      return null
    }
    const checks = pr.statusCheckRollup ?? []
    const results = checks.map(check => (check.conclusion ?? check.state ?? '').toUpperCase())
    const isPending = checks.some(check => {
      const status = (check.status ?? '').toUpperCase()
      const state = (check.state ?? '').toUpperCase()

      return (status !== '' && status !== 'COMPLETED') || state === 'PENDING' || state === 'EXPECTED'
    })
    const ci =
      checks.length === 0
        ? null
        : results.some(result => result === 'FAILURE' || result === 'ERROR' || result === 'TIMED_OUT' || result === 'CANCELLED' || result === 'ACTION_REQUIRED')
          ? 'fail'
          : isPending
            ? 'pending'
            : 'pass'

    return {
      number: pr.number,
      state: pr.state ?? 'OPEN',
      isDraft: pr.isDraft === true,
      title: pr.title ?? '',
      url: pr.url ?? '',
      review: pr.reviewDecision || null,
      ci,
    }
  } catch {
    return null
  }
}

export function projectOfBrief(brief: string): string | null {
  const heading = brief.match(/^#\s*업무 프로젝트:\s*(.+)$/m) ?? brief.match(/^#\s+(.+)$/m)

  return heading?.[1]?.trim() || null
}

// 툴 입력에서 보여 줄 대상(파일명·명령 앞부분·패턴) 하나를 뽑는다.
export function toolTarget(input: Readonly<Record<string, unknown>>): string | null {
  const path = input['file_path'] ?? input['notebook_path'] ?? input['path']
  if (typeof path === 'string' && path !== '') {
    return path.split(/[\\/]/).pop() || path
  }
  for (const key of ['command', 'pattern', 'query', 'url', 'skill', 'description', 'subject']) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') {
      return value.replace(/\s+/g, ' ').trim()
    }
  }

  return null
}

export function todoCounts(todos: readonly HudTodo[]): { done: number; total: number; current: HudTodo | null; next: HudTodo | null } {
  return {
    done: todos.filter(todo => todo.status === 'completed').length,
    total: todos.length,
    current: todos.find(todo => todo.status === 'in_progress') ?? null,
    next: todos.find(todo => todo.status === 'pending') ?? null,
  }
}

export function pushBounded<T>(list: T[], item: T, limit: number): T[] {
  return [...list, item].slice(-limit)
}
