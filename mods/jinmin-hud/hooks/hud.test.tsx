import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { HudBoard } from '../types'
import { layoutBand, layoutPane, rowBudget } from './board'
import { fit, lineWidth, pack, textWidth, type Line } from './cells'
import { emptyBoard, paceOf, parseGitStatus, parsePr, parseRemote, parseWorktree } from './model'
import { duration, prettyModel, sparkline } from './visual'

const GIT_OUT =
  '# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +1 -0\n' +
  '1 .M N... 100644 100644 100644 a b src/x.ts\n1 M. N... 100644 100644 100644 a b src/y.ts\n? notes.md\n'
const NOW = 10 * 60 * 60_000

function richBoard(): HudBoard {
  return {
    ...emptyBoard(),
    model: 'claude-opus-5-5',
    effort: 'high',
    mode: 'acceptEdits',
    version: '2.1.302',
    sessionId: 'abc',
    sessionName: 'jinmin-hud 작업',
    project: 'multi-cli-work',
    mcwProject: '예시프로젝트',
    mcwSessionId: 'a1b2c3d4-0000',
    git: {
      ...parseGitStatus(GIT_OUT),
      lastCommit: { hash: 'a35c6e5', subject: 'chore: release v1.48.1', at: NOW - 2 * 60 * 60_000 },
      lastModified: { path: 'src/x.ts', at: NOW - 3 * 60_000 },
      worktree: 'feat-hud',
      repo: 'rafaam11/multi-cli-work',
    },
    compactAt: 155_000,
    compactions: 2,
    pr: { number: 12, state: 'OPEN', isDraft: false, title: 'feat: hud', url: 'https://github.com/rafaam11/multi-cli-work/pull/12', review: 'APPROVED', ci: 'pending' },
    context: { percent: 48, tokens: 96_000, window: 200_000 },
    trend: [10, 20, 30, 48],
    limits: [
      { kind: 'five_hour', percentUsed: 23, resetsAt: NOW + 130 * 60_000 },
      { kind: 'seven_day', percentUsed: 82, resetsAt: NOW + 76 * 60 * 60_000 },
    ],
    costUsd: 1.2,
    startedAt: NOW - 42 * 60_000,
    turns: 14,
    turnStartedAt: NOW - 72_000,
    lastAnswerAt: NOW - 108_000,
    running: [{ id: 't1', tool: 'Edit', target: 'register.tsx', startedAt: NOW - 1000 }],
    turnTools: { Read: { count: 3, errors: 0, ms: 30 }, Bash: { count: 2, errors: 1, ms: 900 } },
    sessionTools: { Read: { count: 30, errors: 0, ms: 300 }, Bash: { count: 9, errors: 1, ms: 9000 } },
    recent: [
      { at: NOW - 60_000, tool: 'Read', target: 'board.ts', isOk: true },
      { at: NOW - 30_000, tool: 'Bash', target: 'npm test', isOk: false },
    ],
    agents: [
      { id: 'a1', type: 'Explore', model: 'haiku', description: 'Finding auth code', startedAt: NOW - 72_000, endedAt: null },
      { id: 'a2', type: 'code-reviewer', model: 'sonnet', description: 'Review', startedAt: NOW - 200_000, endedAt: NOW - 166_000 },
    ],
    todos: [
      { text: '설계', status: 'completed' },
      { text: '구현 중', status: 'in_progress' },
      { text: '검증', status: 'pending' },
    ],
    config: { claudeMd: 2, rules: 1, mcp: 9, hooks: 3 },
    cacheTtlMs: 300_000,
  }
}

const PULSE = { now: NOW, frame: 2 }

function texts(lines: Line[]): string[] {
  return lines.map(line => line.map(span => span.text).join(''))
}

describe('cells', () => {
  test('한글은 2칸, 박스 문자는 1칸', async () => {
    expect(textWidth('예시프로젝트')).toBe(12)
    expect(textWidth('╭─█░⠹▰')).toBe(6)
  })

  test('fit은 정확히 맞추고 넘치면 …', async () => {
    expect(lineWidth(fit([{ text: '가나다라' }], 5))).toBe(5)
    expect(fit([{ text: '가나다라' }], 5).map(span => span.text).join('')).toBe('가나…')
    expect(lineWidth(fit([{ text: 'ab' }], 6))).toBe(6)
  })

  test('pack은 우선순위 낮은 조각부터 버린다', async () => {
    const line = pack(
      [
        { prio: 1, spans: [{ text: 'AAAA' }] },
        { prio: 9, spans: [{ text: 'ZZZZ' }] },
        { prio: 2, spans: [{ text: 'BBBB' }] },
      ],
      10,
    )
    expect(line.map(span => span.text).join('').trim()).toBe('AAAA  BBBB')
  })
})

describe('format', () => {
  test('git porcelain v2 통계', async () => {
    const git = parseGitStatus(GIT_OUT)
    expect([git.branch, git.ahead, git.staged, git.modified, git.untracked]).toEqual(['main', 1, 1, 1, 1])
    expect(git.files.map(file => file.path)).toEqual(['src/x.ts', 'src/y.ts', 'notes.md'])
  })

  test('속도 편차: 경과 비율 대비 사용량', async () => {
    const start = NOW - 60 * 60_000
    const pace = paceOf({ kind: 'five_hour', percentUsed: 40, resetsAt: start + 5 * 60 * 60_000 }, NOW)
    expect(Math.round((pace?.elapsed ?? 0) * 100)).toBe(20)
    expect(Math.round(pace?.variance ?? 0)).toBe(20)
    expect(paceOf({ kind: 'five_hour', percentUsed: 40, resetsAt: null }, NOW)).toBeNull()
    expect(paceOf({ kind: 'spend_limit', percentUsed: 40, resetsAt: NOW }, NOW)).toBeNull()
  })

  test('워크트리·원격·PR 파싱', async () => {
    expect(parseWorktree('C:/dev/x/.git\nC:/dev/x/.git\nC:/dev/x\n')).toBeNull()
    expect(parseWorktree('C:/dev/x/.git/worktrees/feat\nC:/dev/x/.git\nC:/dev/x-feat\n')).toBe('x-feat')
    expect(parseRemote('https://github.com/rafaam11/multi-cli-work.git\n')).toBe('rafaam11/multi-cli-work')
    expect(parseRemote('git@github.com:rafaam11/jinmin-mods.git')).toBe('rafaam11/jinmin-mods')
    const json = (checks: object[], extra: object = {}) =>
      JSON.stringify({ number: 5, state: 'OPEN', isDraft: false, title: 't', url: 'u', reviewDecision: '', statusCheckRollup: checks, ...extra })
    expect(parsePr(json([{ status: 'COMPLETED', conclusion: 'SUCCESS' }]))).toMatchObject({ number: 5, ci: 'pass', review: null })
    expect(parsePr(json([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: '' }]))?.ci).toBe('pending')
    expect(parsePr(json([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }]))?.ci).toBe('fail')
    expect(parsePr(json([], { reviewDecision: 'APPROVED', isDraft: true }))).toMatchObject({ ci: null, review: 'APPROVED', isDraft: true })
    expect(parsePr('no pull requests found')).toBeNull()
  })

  test('작은 포맷터들', async () => {
    expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(duration(72_000)).toBe('1분 12초')
    expect(duration(130 * 60_000)).toBe('2시간 10분')
    expect(sparkline([0, 50, 100], 3)).toBe('▁▅█')
  })

  test('터미널 높이 → 줄 예산 (6분할 대응)', async () => {
    expect(rowBudget(50, 50, 10)).toBe(10)
    expect(rowBudget(32, 32, 10)).toBe(8)
    expect(rowBudget(24, 24, 10)).toBe(6)
    expect(rowBudget(18, 18, 10)).toBe(4)
    expect(rowBudget(12, 12, 10)).toBe(2)
    expect(rowBudget(8, 8, 10)).toBe(1)
    expect(rowBudget(50, 50, 6)).toBe(6)
  })
})

describe('밴드 레이아웃', () => {
  test('막대 위 표식: 시간 위치 │ 와 자동 압축 지점 ┊', async () => {
    const all = texts(layoutBand(richBoard(), PULSE, { columns: 140, rows: 10 }))
    expect(all[1]).toContain('┊')
    expect(all[2]).toContain('│')
  })

  for (const columns of [140, 100, 80, 60, 45]) {
    for (const rows of [10, 8, 6, 4, 2, 1]) {
      test(`${columns}칸 × ${rows}줄: 줄 수 ≤ 예산, 모든 줄 너비 ≤ ${columns}`, async () => {
        const lines = layoutBand(richBoard(), PULSE, { columns, rows })
        expect(lines.length).toBeLessThanOrEqual(rows)
        expect(lines.length).toBeGreaterThan(0)
        for (const line of lines) {
          expect(lineWidth(line)).toBeLessThanOrEqual(columns)
        }
      })
    }
  }

  test('넓은 창: 테두리 카드 5줄, 모든 줄이 정확히 같은 너비, 핵심 정보', async () => {
    const lines = layoutBand(richBoard(), PULSE, { columns: 120, rows: 10 })
    const all = texts(lines)
    expect(lines.length).toBe(5)
    for (const line of lines) {
      expect(lineWidth(line)).toBe(120)
    }
    expect(all[0]).toMatch(/^╭─ ◆ Opus 5\.5/)
    expect(all[0]).toMatch(/╮$/)
    expect(all[4]).toMatch(/^╰─ CLAUDE\.md 2개/)
    const body = all.join('\n')
    for (const needle of ['예시프로젝트', 'Opus 5.5 effort high', '편집 자동 승인', '48%', '96k/200k 토큰', '5시간', '23%', '7일', '⎇ main', '올릴 커밋 1', '스테이지 1', '수정 1', '새 파일 1', '수정 3분 전', '커밋 2시간 전', '자동 압축까지 59k', '압축 2회', '-34% 여유', '+27% 빠름', '2시간 10분 뒤 초기화', 'PR #12 열림', 'CI ⠹', '규칙 1개', 'MCP 9개']) {
      expect(body).toContain(needle)
    }
  })

  test('6줄 미만이면 테두리 없이 헤더 + 우선순위 줄', async () => {
    const all = texts(layoutBand(richBoard(), PULSE, { columns: 90, rows: 4 }))
    expect(all).toHaveLength(4)
    expect(all[0]).toContain('Opus 5.5')
    expect(all[1]).toContain('맥락')
    expect(all.join('')).not.toContain('╭')
  })

  test('1줄이면 컬러 요약 한 줄', async () => {
    const all = texts(layoutBand(richBoard(), PULSE, { columns: 70, rows: 1 }))
    expect(all).toHaveLength(1)
    expect(all[0]).toContain('Opus 5.5')
    expect(all[0]).toContain('48%')
  })

  test('데이터가 없어도 판이 깨지지 않는다', async () => {
    const lines = layoutBand(emptyBoard(), PULSE, { columns: 100, rows: 10 })
    for (const line of lines) {
      expect(lineWidth(line)).toBe(100)
    }
  })

  test('패널: 섹션이 모두 나오고 너비를 넘지 않는다', async () => {
    const lines = layoutPane(richBoard(), PULSE, 70)
    const body = texts(lines).join('\n')
    for (const section of ['컨텍스트', '사용량', '에이전트', '할 일', 'git', 'src/x.ts', '뒤 초기화', '→ origin/main', '마지막 커밋 a35c6e5', '마지막 수정', 'PR #12', 'pull/12', '워크트리 feat-hud']) {
      expect(body).toContain(section)
    }
    for (const line of lines) {
      expect(lineWidth(line)).toBeLessThanOrEqual(70)
    }
  })
})

function engine(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: 'C:/dev/multi-cli-work' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.version', () => ({ value: { version: '2.1.302' } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 96_000, percent: 48 }, rateLimits: [{ kind: 'five_hour', percentUsed: 23 }] },
  }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: GIT_OUT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', ($, e) => (e.path.split(String.fromCharCode(92)).join('/') === 'C:/mcw/brief.md' ? { value: '# 업무 프로젝트: 예시프로젝트\n' } : { deny: 'ENOENT' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('tool.list', () => ({ value: [{ name: 'mcp__notion__search', description: '', mcp: true }] }))
  on('settings.read', () => ({ value: {} }))
  on('agent.list', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
}

const HINT = {
  plugin: 'jinmin-hud',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const BAND = {
  plugin: 'jinmin-hud',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 40, bodyColumns: 120, scroll: { offset: 0, bodyRows: 0 }, view: {} },
} as const

test('세션 흐름이 입력창 아래에 그려지고 엔진 안내 줄은 남는다 (terminal·desktop)', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { MULTI_CLI_WORK_SESSION_ID: 'abc', MULTI_CLI_WORK_PROJECT_BRIEF: 'C:/mcw/brief.md', USERPROFILE: 'C:/Users/me' })
  engine(on)

  await $.session.start({ cwd: 'C:/dev/multi-cli-work', surface: 'terminal', isInteractive: true })
  await clock.advance(10)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/dev/a/register.tsx' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: '설계', status: 'completed', activeForm: '설계 중' },
      { content: '구현', status: 'in_progress', activeForm: '구현 중' },
    ],
  })
  await $.session.measure({
    context: { window: 200_000, tokens: 130_000, percent: 65 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
    cost: { usd: 0.5 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...HINT, surface })
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    for (const needle of [/Opus 5\.5/, /예시프로젝트/, /65%/, /main/, /수정 1/]) {
      expect(await ui.find({ type: 'Text', text: needle })).toBeDefined()
    }
    await ui.unmount()
  }

  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /65%/ })).toBeDefined()
  await ui.unmount()

  // 기본 위치에선 입력창 위 밴드를 그리지 않는다.
  const above = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await above.find({ type: 'Text', text: /Opus/ })).toBeUndefined()
  await above.unmount()
})

test('placement=above면 입력창 위에 그리고 아래 안내 줄은 그대로', { options: { placement: 'above' } }, async ($, on) => {
  mock.env(on, {})
  engine(on)
  await $.session.start({ cwd: 'C:/dev/x', surface: 'terminal', isInteractive: true })
  const above = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await above.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  await above.unmount()
  const hint = await $.ui.mount({ ...HINT, surface: 'terminal' })
  expect(await hint.find({ type: 'Text', text: /Opus/ })).toBeUndefined()
  await hint.unmount()
})

test('설문이 떠 있으면 밴드를 양보한다', { options: { placement: 'above' } }, async ($, on) => {
  mock.env(on, {})
  engine(on)
  await $.session.start({ cwd: 'C:/dev/x', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Text', text: /Opus/ })).toBeUndefined()
  await ui.unmount()
})
