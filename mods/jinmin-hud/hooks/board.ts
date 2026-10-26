import type { HudBoard, HudLimit, HudPr, HudPulse } from '../types'

import { fit, lineWidth, pack, type Chunk, type Line, type Span } from './cells'
import { paceOf, todoCounts } from './model'
import {
  SPINNER,
  bar,
  clockTime,
  countdown,
  duration,
  effortLabel,
  heat,
  modeColor,
  modeLabel,
  prettyModel,
  sparkline,
  tokens,
} from './visual'

// 상황판 레이아웃: 데이터 + 화면 크기 → 셀 너비가 정확한 줄들. 순수 함수.

export type BandSize = { columns: number; rows: number }

type Row = {
  key: string
  prio: number
  label: [string, string]
  left: Chunk[]
  right: Chunk[]
  isEmpty: boolean
}

type Ctx = { b: HudBoard; now: number; spin: string; isNarrow: boolean }

const DIM: Span = { text: '—', dim: true }

function chunk(prio: number, ...spans: Span[]): Chunk {
  return { prio, spans }
}

function label(text: string): Span {
  return { text, color: 'subtle', bold: true }
}

// 터미널 높이 → 밴드가 쓸 줄 수. 6분할처럼 낮은 창에선 대화가 보이도록 줄인다.
export function rowBudget(terminalRows: number, maxRows: number, configured: number): number {
  const byHeight =
    terminalRows >= 40 ? 10 : terminalRows >= 30 ? 8 : terminalRows >= 22 ? 6 : terminalRows >= 16 ? 4 : terminalRows >= 11 ? 2 : 1

  return Math.max(1, Math.min(byHeight, maxRows, configured))
}

// 막대 위 표식: 0~1 위치의 칸을 다른 글자로 덮는다(시간 위치 │, 자동 압축 지점 ┊).
type Mark = { at: number; char: string; color: Span['color'] }

function meter(percent: number, cells: number, marks: readonly Mark[] = []): Span[] {
  const [full, empty] = bar(percent, cells)
  const cellsOf: Span[] = [
    ...[...full].map((char): Span => ({ text: char, color: heat(percent) })),
    ...[...empty].map((char): Span => ({ text: char, dim: true })),
  ]
  for (const mark of marks) {
    const index = Math.min(cells - 1, Math.max(0, Math.round(mark.at * cells) - (mark.at >= 1 ? 1 : 0)))
    cellsOf[index] = { text: mark.char, color: mark.color, bold: true }
  }
  const merged: Span[] = []
  for (const cell of cellsOf) {
    const last = merged[merged.length - 1]
    if (last && last.color === cell.color && last.dim === cell.dim && last.bold === cell.bold) {
      last.text += cell.text
    } else {
      merged.push({ ...cell })
    }
  }

  return [...merged, { text: ` ${Math.round(percent)}%`, color: heat(percent), bold: percent >= 85 }]
}

function limitChunks(limit: HudLimit, cells: number, now: number, prio: number): Chunk[] {
  const name = limit.kind === 'five_hour' ? '5시간' : limit.kind === 'seven_day' ? '7일' : limit.kind.replace(/_/g, ' ')
  const pace = paceOf(limit, now)
  const marks: Mark[] = pace ? [{ at: pace.elapsed, char: '│', color: 'text' }] : []
  const out: Chunk[] = [chunk(prio, { text: `${name} `, color: 'subtle', bold: true }, ...meter(limit.percentUsed, cells, marks))]
  if (pace) {
    const v = Math.round(pace.variance)
    out.push(
      chunk(
        prio + 1,
        v > 5
          ? { text: `+${v}% 빠름`, color: 'error', bold: true }
          : v < -5
            ? { text: `${v}% 여유`, color: 'success' }
            : { text: '예상 속도', dim: true },
      ),
    )
  }
  if (limit.resetsAt !== null) {
    out.push(chunk(prio + 3, { text: `${duration(limit.resetsAt - now)} 뒤 초기화`, dim: true }))
  }

  return out
}

function contextRow(c: Ctx): Row {
  const ctx = c.b.context
  const cells = c.isNarrow ? 10 : 20
  const compactAt = c.b.compactAt
  const marks: Mark[] = ctx && compactAt !== null && compactAt < ctx.window ? [{ at: compactAt / ctx.window, char: '┊', color: 'warning' }] : []
  const left: Chunk[] = ctx ? [chunk(1, ...meter(ctx.percent, cells, marks))] : [chunk(1, DIM)]
  if (ctx && ctx.tokens !== null) {
    left.push(chunk(3, { text: `${tokens(ctx.tokens)}/${tokens(ctx.window)} 토큰`, dim: true }))
    if (compactAt !== null) {
      const room = compactAt - ctx.tokens
      left.push(
        chunk(
          2,
          room > 0
            ? { text: `자동 압축까지 ${tokens(room)}`, color: room < ctx.window * 0.1 ? 'warning' : 'subtle' }
            : { text: '곧 자동 압축', color: 'warning', bold: true },
        ),
      )
    } else {
      left.push(chunk(5, { text: `남은 ${tokens(Math.max(0, ctx.window - ctx.tokens))}`, dim: true }))
    }
  }
  if (c.b.compactions > 0) {
    left.push(chunk(9, { text: `압축 ${c.b.compactions}회`, dim: true }))
  }

  return { key: 'context', prio: 1, label: ['컨텍스트', '맥락'], left, right: [], isEmpty: ctx === null }
}

function limitsRow(c: Ctx): Row {
  const cells = c.isNarrow ? 6 : 10
  const five = c.b.limits.find(limit => limit.kind === 'five_hour')
  const seven = c.b.limits.find(limit => limit.kind === 'seven_day')
  const others = c.b.limits.filter(limit => limit.kind !== 'five_hour' && limit.kind !== 'seven_day')
  const left = five ? limitChunks(five, cells, c.now, 1) : others[0] ? limitChunks(others[0], cells, c.now, 1) : [chunk(1, DIM)]
  const right =
    seven && seven.percentUsed >= c.b.sevenDayThreshold
      ? limitChunks(seven, cells, c.now, 2)
      : seven
        ? [chunk(6, label('7일 '), { text: `${Math.round(seven.percentUsed)}%`, dim: true })]
        : []

  return { key: 'limits', prio: 2, label: ['사용 한도', '한도'], left, right, isEmpty: c.b.limits.length === 0 }
}

function ago(ms: number): string {
  return ms < 60_000 ? '방금' : `${duration(ms)} 전`
}

const PR_STATE: Record<string, string> = { OPEN: '열림', MERGED: '병합됨', CLOSED: '닫힘' }
const REVIEW: Record<string, string> = { APPROVED: '리뷰 승인', CHANGES_REQUESTED: '변경 요청', REVIEW_REQUIRED: '리뷰 대기' }

export function prChunks(pr: HudPr, spin: string): Chunk[] {
  const state = pr.isDraft ? '초안' : (PR_STATE[pr.state] ?? pr.state)
  const out: Chunk[] = [
    chunk(3, { text: `PR #${pr.number} `, color: 'suggestion', bold: true }, { text: state, color: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'subtle' : 'success' }),
  ]
  if (pr.ci) {
    out.push(
      chunk(
        4,
        pr.ci === 'pass'
          ? { text: 'CI ✓', color: 'success' }
          : pr.ci === 'fail'
            ? { text: 'CI ✗', color: 'error', bold: true }
            : { text: `CI ${spin}`, color: 'warning' },
      ),
    )
  }
  if (pr.review && REVIEW[pr.review]) {
    out.push(chunk(7, { text: REVIEW[pr.review] ?? '', color: pr.review === 'APPROVED' ? 'success' : pr.review === 'CHANGES_REQUESTED' ? 'error' : 'subtle' }))
  }

  return out
}

function gitRow(c: Ctx): Row {
  const git = c.b.git
  const left: Chunk[] = []
  const right: Chunk[] = []
  if (git?.branch) {
    left.push(chunk(1, { text: '⎇ ', color: 'suggestion' }, { text: git.branch, color: 'suggestion', bold: true }))
    if (git.worktree) {
      left.push(chunk(5, { text: `워크트리 ${git.worktree}`, color: 'warning' }))
    }
    if (git.repo) {
      left.push(chunk(8, { text: git.repo, dim: true }))
    }
    if (git.upstream) {
      left.push(chunk(6, { text: `→ ${git.upstream}`, dim: true }))
    }
    if (git.ahead > 0) left.push(chunk(3, { text: `↑ 올릴 커밋 ${git.ahead}`, color: 'warning' }))
    if (git.behind > 0) left.push(chunk(3, { text: `↓ 받을 커밋 ${git.behind}`, color: 'warning' }))
    if (git.upstream && git.ahead === 0 && git.behind === 0) left.push(chunk(7, { text: '원격과 같음', dim: true }))
    const stats: Span[] = []
    if (git.conflicted > 0) stats.push({ text: `충돌 ${git.conflicted} `, color: 'error', bold: true })
    if (git.staged > 0) stats.push({ text: `스테이지 ${git.staged} `, color: 'success' })
    if (git.modified > 0) stats.push({ text: `수정 ${git.modified} `, color: 'warning' })
    if (git.untracked > 0) stats.push({ text: `새 파일 ${git.untracked}`, color: 'subtle' })
    left.push(stats.length > 0 ? chunk(2, { text: '● ', color: 'warning' }, ...stats) : chunk(2, { text: '✓ 변경 없음', color: 'success' }))
    if (git.lastModified) {
      right.push(
        chunk(4, label('수정 '), { text: ago(c.now - git.lastModified.at), bold: true }),
        chunk(8, { text: git.lastModified.path.split('/').pop() ?? git.lastModified.path, dim: true }),
      )
    }
    if (git.lastCommit) {
      right.push(chunk(git.lastModified ? 5 : 4, label('커밋 '), { text: ago(c.now - git.lastCommit.at), bold: !git.lastModified }))
    }
    if (c.b.pr) {
      right.push(...prChunks(c.b.pr, c.spin))
    }
  } else {
    left.push(chunk(1, { text: 'git 저장소 아님', dim: true }))
  }

  return { key: 'git', prio: 3, label: ['git', 'git'], left, right, isEmpty: !git?.branch }
}

function allRows(c: Ctx): Row[] {
  return [contextRow(c), limitsRow(c), gitRow(c)]
}

// 줄 예산만큼 우선순위로 고르되 빈 줄을 먼저 빼고, 표시는 원래 순서로.
function pickRows(rows: Row[], count: number): Row[] {
  const ranked = [...rows].sort((a, b) => Number(a.isEmpty) - Number(b.isEmpty) || a.prio - b.prio).slice(0, count)

  return rows.filter(row => ranked.includes(row))
}

function titleSpans(c: Ctx): { left: Chunk[]; right: Chunk[] } {
  const b = c.b
  // 추론 강도는 모델과 한 조각이라 좁은 창에서도 함께 남는다.
  const left: Chunk[] = [
    chunk(
      1,
      { text: '◆ ', color: 'claude' },
      { text: b.model ? prettyModel(b.model) : 'Claude', color: 'claude', bold: true },
      ...(b.effort ? [{ text: ` ${effortLabel(b.effort)}`, color: 'suggestion' as const }] : []),
    ),
  ]
  if (b.mode && b.mode !== 'default') left.push(chunk(3, { text: modeLabel(b.mode), color: modeColor(b.mode), bold: true }))
  if (b.project) left.push(chunk(2, { text: b.project, bold: true }))
  if (b.mcwProject) left.push(chunk(4, { text: `▣ ${b.mcwProject}`, color: 'remember' }))
  if (b.sessionName) left.push(chunk(7, { text: `“${b.sessionName}”`, dim: true }))
  const right: Chunk[] = []
  if (b.startedAt !== null) right.push(chunk(3, { text: `세션 ${duration(c.now - b.startedAt)}`, bold: true }))
  if (b.turns > 0) right.push(chunk(6, { text: `${b.turns}번째 턴`, dim: true }))

  return { left, right }
}

function footerChunks(c: Ctx): Chunk[] {
  const cfg = c.b.config
  const out: Chunk[] = []
  if (cfg) {
    if (cfg.claudeMd > 0) out.push(chunk(1, { text: `CLAUDE.md ${cfg.claudeMd}개`, dim: true }))
    if (cfg.rules > 0) out.push(chunk(2, { text: `규칙 ${cfg.rules}개`, dim: true }))
    if (cfg.mcp > 0) out.push(chunk(1, { text: `MCP ${cfg.mcp}개`, dim: true }))
    if (cfg.hooks > 0) out.push(chunk(2, { text: `훅 ${cfg.hooks}개`, dim: true }))
  }
  if (c.b.version) out.push(chunk(3, { text: `Claude Code ${c.b.version}`, dim: true }))
  out.push(chunk(4, { text: '/hud 자세히', color: 'suggestion' }))

  return out
}

const BORDER: Span = { text: '', color: 'promptBorder' }

function border(text: string): Span {
  return { ...BORDER, text }
}

// "╭─ 왼쪽 ─────── 오른쪽 ─╮" 같은 테두리 줄. 가운데를 ─로 채워 정확히 `width`에 맞춘다.
function borderLine(open: string, close: string, left: Chunk[], right: Chunk[], width: number): Line {
  const inner = width - 4
  const sep: Span = { text: ' · ', dim: true }
  const rightTrim = right.length > 0 ? trimEnd(pack(right, Math.max(0, Math.floor(inner / 3)), sep)) : []
  const rightWidth = lineWidth(rightTrim)
  const leftRoom = inner - (rightWidth > 0 ? rightWidth + 3 : 0) - 2
  const leftSpans = trimEnd(pack(left, Math.max(0, leftRoom), sep))
  const fill = Math.max(1, inner - lineWidth(leftSpans) - 2 - (rightWidth > 0 ? rightWidth + 2 : 0))

  return [
    border(`${open}─ `),
    ...leftSpans,
    border(` ${'─'.repeat(fill)}${rightWidth > 0 ? ' ' : ''}`),
    ...rightTrim,
    border(rightWidth > 0 ? ` ─${close}` : `─${close}`),
  ]
}

function trimEnd(spans: Span[]): Span[] {
  const out = [...spans]
  while (out.length > 0 && (out[out.length - 1]?.text.trim() ?? '') === '') {
    out.pop()
  }

  return out
}

function rowLine(row: Row, width: number, isBordered: boolean, isTwoColumn: boolean, isNarrow: boolean): Line {
  const inner = isBordered ? width - 4 : width
  const name = isNarrow ? row.label[1] : row.label[0]
  const labelWidth = isNarrow ? 5 : 10
  const head = fit([label(name)], labelWidth)
  const body = inner - labelWidth
  let content: Span[]
  if (isTwoColumn && row.right.length > 0) {
    const leftWidth = Math.ceil((inner - 3) * 0.55) - labelWidth
    const rightWidth = inner - labelWidth - leftWidth - 3
    content = [...pack(row.left, leftWidth), { text: ' │ ', color: 'promptBorder' }, ...pack(row.right, rightWidth)]
  } else {
    content = pack([...row.left, ...row.right], body, { text: '  ' })
  }
  const line = [...head, ...content]

  return isBordered ? [border('│ '), ...line, border(' │')] : line
}

function summaryLine(c: Ctx, width: number): Line {
  const b = c.b
  const chunks: Chunk[] = [
    chunk(
      1,
      { text: '◆ ', color: 'claude' },
      { text: b.model ? prettyModel(b.model) : 'Claude', color: 'claude', bold: true },
      ...(b.effort ? [{ text: ` ${effortLabel(b.effort)}`, color: 'suggestion' as const }] : []),
    ),
  ]
  if (b.context) chunks.push(chunk(1, { text: '맥락 ', color: 'subtle' }, ...meter(b.context.percent, 6)))
  const five = b.limits.find(limit => limit.kind === 'five_hour')
  if (five) chunks.push(chunk(2, { text: '5시간 ', color: 'subtle' }, { text: `${Math.round(five.percentUsed)}%`, color: heat(five.percentUsed) }))
  if (b.git?.branch) chunks.push(chunk(2, { text: `⎇ ${b.git.branch}`, color: 'suggestion' }, b.git.isDirty ? { text: ' ● 변경', color: 'warning' } : { text: ' ✓', color: 'success' }))
  if (b.mcwProject) chunks.push(chunk(5, { text: `▣ ${b.mcwProject}`, color: 'remember' }))
  if (b.project) chunks.push(chunk(5, { text: b.project, dim: true }))

  return pack(chunks, width, { text: ' │ ', dim: true })
}

function headerLine(c: Ctx, width: number): Line {
  const { left, right } = titleSpans(c)

  return pack([...left, ...right], width, { text: ' · ', dim: true })
}

export function layoutBand(b: HudBoard, pulse: HudPulse, size: BandSize): Line[] {
  const width = Math.max(10, size.columns)
  const c: Ctx = { b, now: pulse.now, spin: SPINNER[pulse.frame % SPINNER.length] ?? '⠋', isNarrow: width < 64 }
  const budget = Math.max(1, size.rows)
  if (budget <= 1) {
    return [summaryLine(c, width)]
  }
  const rows = allRows(c)
  const isBordered = budget >= 6 && width >= 50
  if (!isBordered) {
    return [headerLine(c, width), ...pickRows(rows, budget - 1).map(row => rowLine(row, width, false, false, true))]
  }
  const isTwoColumn = width >= 100
  const { left, right } = titleSpans(c)

  return [
    borderLine('╭', '╮', left, right, width),
    ...pickRows(rows, budget - 2).map(row => rowLine(row, width, true, isTwoColumn, c.isNarrow)),
    borderLine('╰', '╯', footerChunks(c), [], width),
  ]
}

// /hud 패널: 높이 제한 없이 섹션별로 전부. 패널이 넘치면 엔진이 스크롤한다.
export function layoutPane(b: HudBoard, pulse: HudPulse, columns: number): Line[] {
  const width = Math.max(20, columns)
  const c: Ctx = { b, now: pulse.now, spin: SPINNER[pulse.frame % SPINNER.length] ?? '⠋', isNarrow: width < 64 }
  const out: Line[] = []
  const section = (title: string) => {
    out.push([])
    const head: Span = { text: `▍${title} `, color: 'claude', bold: true }
    out.push(fit([head, { text: '─'.repeat(Math.max(0, width - lineWidth([head]))), color: 'promptBorder' }], width))
  }
  const row = (...spans: Span[]) => out.push(fit(spans, width))
  const cells = Math.max(6, Math.min(30, width - 46))

  out.push(headerLine(c, width))
  row({ text: `세션 ${b.sessionId ?? '—'}`, dim: true }, ...(b.version ? [{ text: ` · Claude Code ${b.version}`, dim: true }] : []))
  if (b.startedAt !== null) row({ text: `시작 ${clockTime(b.startedAt)} · 경과 ${duration(c.now - b.startedAt)} · 턴 ${b.turns}`, dim: true })
  if (b.mcwSessionId) row({ text: '▣ multi-cli-work ', color: 'remember' }, { text: `${b.mcwProject ?? '프로젝트 없음'} · ${b.mcwSessionId.slice(0, 8)}`, dim: true })

  section('컨텍스트')
  if (b.context) {
    row(...meter(b.context.percent, cells), { text: `  ${b.context.tokens !== null ? tokens(b.context.tokens) : '?'} / ${tokens(b.context.window)}`, dim: true })
  } else {
    row(DIM)
  }
  for (const category of b.breakdown ?? []) {
    const percent = b.context ? (category.tokens / b.context.window) * 100 : 0
    const [full] = bar(percent, cells)
    row(...fit([{ text: category.name, dim: true }], 22), { text: full || '▏', color: 'suggestion' }, { text: ` ${tokens(category.tokens)}`, dim: true })
  }
  if (b.trend.length >= 2) row({ text: '추이 ', color: 'subtle' }, { text: sparkline(b.trend, Math.min(30, width - 6)), color: heat(b.trend[b.trend.length - 1] ?? 0) })

  section('사용량')
  for (const limit of b.limits) {
    const name = limit.kind === 'five_hour' ? '5시간' : limit.kind === 'seven_day' ? '7일' : limit.kind
    const reset = limit.resetsAt !== null ? `  ${duration(limit.resetsAt - c.now)} 뒤 초기화 (${clockTime(limit.resetsAt)})` : ''
    row(...fit([{ text: name, color: 'subtle', bold: true }], 7), ...meter(limit.percentUsed, cells), { text: reset, dim: true })
  }
  if (b.limits.length === 0) row({ text: '사용량 창 정보 없음(구독 아님 또는 첫 응답 전)', dim: true })
  if (b.lastAnswerAt !== null && b.cacheTtlMs > 0) {
    const leftMs = b.lastAnswerAt + b.cacheTtlMs - c.now
    row({ text: '캐시 ', color: 'subtle' }, leftMs > 0 ? { text: `${countdown(leftMs)} 남음 (유지 시간 ${duration(b.cacheTtlMs)})`, color: 'success' } : { text: '만료', color: 'error' })
  }

  section('에이전트')
  for (const agent of [...b.agents].reverse().slice(0, 10)) {
    const isLive = agent.endedAt === null
    row(
      { text: isLive ? `${c.spin} ` : '✓ ', color: isLive ? 'claude' : 'success' },
      { text: agent.type, color: 'suggestion', bold: true },
      { text: agent.model ? `(${agent.model}) ` : ' ', dim: true },
      { text: agent.description },
      { text: ` · ${duration((agent.endedAt ?? c.now) - agent.startedAt)}`, dim: true },
    )
  }
  if (b.agents.length === 0) row(DIM)

  section('할 일')
  for (const todo of b.todos) {
    const icon = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '▸' : '○'
    const color = todo.status === 'completed' ? 'success' : todo.status === 'in_progress' ? 'claude' : 'subtle'
    row({ text: `${icon} `, color }, { text: todo.text, dim: todo.status === 'completed' })
  }
  if (b.todos.length === 0) row(DIM)

  section('git')
  if (b.git?.branch) {
    row({ text: '⎇ ', color: 'suggestion' }, { text: b.git.branch, color: 'suggestion', bold: true }, { text: b.git.upstream ? `  → ${b.git.upstream}` : '  (원격 브랜치 없음)', dim: true })
    row({ text: `올릴 커밋 ${b.git.ahead} · 받을 커밋 ${b.git.behind} · 스테이지 ${b.git.staged} · 수정 ${b.git.modified} · 새 파일 ${b.git.untracked}${b.git.conflicted ? ` · 충돌 ${b.git.conflicted}` : ''}`, dim: true })
    if (b.git.repo || b.git.worktree) {
      row({ text: [b.git.repo, b.git.worktree ? `워크트리 ${b.git.worktree}` : null].filter(Boolean).join(' · '), dim: true })
    }
    if (b.pr) {
      row(...prChunks(b.pr, c.spin).flatMap((one, i) => (i === 0 ? one.spans : [{ text: ' · ', dim: true }, ...one.spans])))
      row({ text: `  ${b.pr.title}` })
      if (b.pr.url) row({ text: `  ${b.pr.url}`, dim: true })
    }
    if (b.git.lastCommit) {
      const commit = b.git.lastCommit
      row({ text: '마지막 커밋 ', color: 'subtle' }, { text: commit.hash, color: 'warning' }, { text: ` ${ago(c.now - commit.at)} (${clockTime(commit.at)})`, dim: true })
      row({ text: `  ${commit.subject}` })
    }
    if (b.git.lastModified) {
      row({ text: '마지막 수정 ', color: 'subtle' }, { text: ago(c.now - b.git.lastModified.at), bold: true }, { text: ` ${b.git.lastModified.path}`, dim: true })
    }
    for (const file of b.git.files.slice(0, 15)) {
      row({ text: `${file.code.padEnd(3)}`, color: file.code === '?' ? 'subtle' : file.code === 'U' ? 'error' : 'warning' }, { text: file.path })
    }
    if (b.git.files.length > 15) row({ text: `… 외 ${b.git.files.length - 15}개`, dim: true })
  } else {
    row(DIM)
  }

  return out
}
