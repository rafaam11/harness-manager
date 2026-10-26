import { describe, expect, test } from 'claude-code/testing'

import type { ChipsModel } from '../types'
import { ctxColor, deriveWire, duration, elapsed, sanitize } from './chips'
import {
  addAgent,
  addBg,
  applyTaskCreate,
  applyTaskList,
  applyTaskUpdate,
  applyTodoWrite,
  bgFromCommand,
  bgLabel,
  bgNamed,
  bgShort,
  emptyModel,
  finishTask,
  finishTest,
  parseTaskNotifications,
  reconcileBackground,
  startTest,
  todoCounts,
} from './model'

const OPTS = { ctxStep: 1, lingerMs: 60_000 }
const NOW = 100 * 60_000

function model(patch: Partial<ChipsModel> = {}): ChipsModel {
  return { ...emptyModel(), ...patch }
}

describe('포맷', () => {
  test('경과 시간은 분 단위만, 끝난 작업은 초까지', async () => {
    expect([elapsed(0), elapsed(59_999), elapsed(60_000), elapsed(12 * 60_000 + 59_000), elapsed(65 * 60_000)]).toEqual(['<1m', '<1m', '1m', '12m', '1h05m'])
    expect([duration(45_000), duration(123_000), duration(65 * 60_000)]).toEqual(['45s', '2m03s', '1h05m'])
  })

  test('sanitize: 제어 문자 제거, 40자 넘으면 39자 + …', async () => {
    expect(sanitize(' a\u0007b\nc ')).toBe('abc')
    const long = 'x'.repeat(50)
    expect(sanitize(long)).toBe(`${'x'.repeat(39)}…`)
    expect(sanitize(long).length).toBe(40)
    expect(sanitize('y'.repeat(40))).toBe('y'.repeat(40))
  })

  test('ctx 색 경계 59/60/84/85', async () => {
    expect([ctxColor(59), ctxColor(60), ctxColor(84), ctxColor(85)]).toEqual(['green', 'amber', 'amber', 'red'])
  })

  test('bg 라벨: cd·환경변수 접두를 떼고 세 토큰, 짧은 이름', async () => {
    expect(bgLabel('cd C:/dev/app && NODE_ENV=production npm run build --verbose')).toBe('npm run build')
    expect(bgLabel('python -m http.server 8000 --bind 0.0.0.0')).toBe('python -m http.server')
    expect(bgShort('cd x && npm run build')).toBe('build')
    expect(bgShort('pnpm run dev')).toBe('dev')
    expect(bgShort('npx tsc --watch')).toBe('tsc')
    expect(bgShort('./scripts/deploy.sh prod')).toBe('deploy.sh')
  })
})

describe('deriveWire', () => {
  test('빈 모델이면 칩도 진행선도 없다', async () => {
    expect(deriveWire(emptyModel(), NOW, OPTS)).toEqual({ chips: {}, progress: null })
  })

  test('할 일: 진행 중이면 칩 + 완료 %, 다 끝나면 칩도 진행선도 없음', async () => {
    const m = model()
    applyTodoWrite(m, [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }, { status: 'pending' }])
    expect(deriveWire(m, NOW, OPTS)).toEqual({ chips: { todo: { text: '할 일 1/4', color: 'blue' } }, progress: { kind: 'value', value: 25 } })
    applyTodoWrite(m, [{ status: 'completed' }, { status: 'completed' }])
    expect(deriveWire(m, NOW, OPTS)).toEqual({ chips: {}, progress: null })
  })

  test('Task 도구: 생성 2개 + 하나 완료 → 1/2, 삭제·TaskList 동기화', async () => {
    const m = model()
    applyTaskCreate(m, '1')
    applyTaskCreate(m, '2')
    applyTaskUpdate(m, '1', 'completed')
    expect(todoCounts(m)).toEqual({ done: 1, total: 2 })
    applyTaskUpdate(m, '2', 'deleted')
    expect(todoCounts(m)).toEqual({ done: 1, total: 1 })
    applyTaskList(m, [
      { id: '1', status: 'completed' },
      { id: '3', status: 'in_progress' },
      { id: '4', status: 'pending' },
    ])
    expect(deriveWire(m, NOW, OPTS).chips['todo']?.text).toBe('할 일 1/3')
  })

  test('ctx: 값과 색, ctxStep 내림', async () => {
    expect(deriveWire(model({ ctxPercent: 59 }), NOW, OPTS).chips['ctx']).toEqual({ text: 'ctx 59%', color: 'green' })
    expect(deriveWire(model({ ctxPercent: 60 }), NOW, OPTS).chips['ctx']).toEqual({ text: 'ctx 60%', color: 'amber' })
    expect(deriveWire(model({ ctxPercent: 84 }), NOW, OPTS).chips['ctx']).toEqual({ text: 'ctx 84%', color: 'amber' })
    expect(deriveWire(model({ ctxPercent: 85 }), NOW, OPTS).chips['ctx']).toEqual({ text: 'ctx 85%', color: 'red' })
    expect(deriveWire(model({ ctxPercent: 67 }), NOW, { ...OPTS, ctxStep: 5 }).chips['ctx']?.text).toBe('ctx 65%')
  })

  test('에이전트: 실행 중인 것만, 모델 패밀리와 bg 수', async () => {
    const m = model()
    addAgent(m, { id: 'a', model: 'haiku', isBackground: false, isRunning: true, startedAt: NOW })
    addAgent(m, { id: 'b', model: 'opus', isBackground: true, isRunning: true, startedAt: NOW })
    addAgent(m, { id: 'c', model: 'sonnet', isBackground: false, isRunning: false, startedAt: NOW })
    const wire = deriveWire(m, NOW, OPTS)
    expect(wire.chips['agents']).toEqual({ text: '에이전트 2 · haiku+opus (bg 1)', color: 'blue' })
    // 백그라운드 에이전트가 돌면 busy
    expect(wire.progress).toEqual({ kind: 'busy' })
  })

  test('테스트 칩: 실행 중·통과·실패·해석 불가', async () => {
    const m = model()
    startTest(m)
    expect(deriveWire(m, NOW, OPTS).chips['test']).toEqual({ text: '테스트 실행 중', color: 'blue' })
    finishTest(m, { passed: 41, failed: 0 }, false)
    expect(deriveWire(m, NOW, OPTS).chips['test']).toEqual({ text: '테스트 41/41', color: 'green' })
    startTest(m)
    finishTest(m, { passed: 38, failed: 3 }, true)
    expect(deriveWire(m, NOW, OPTS).chips['test']).toEqual({ text: '테스트 3 실패', color: 'red' })
    startTest(m)
    finishTest(m, null, true)
    expect(deriveWire(m, NOW, OPTS).chips['test']).toEqual({ text: '테스트 실패', color: 'red' })
    // 요약도 오류도 없으면 실행 전 값으로 돌아간다
    startTest(m)
    finishTest(m, null, false)
    expect(deriveWire(m, NOW, OPTS).chips['test']).toEqual({ text: '테스트 실패', color: 'red' })
  })

  test('bg: 가장 오래된 작업의 라벨과 분 단위 경과, busy', async () => {
    const m = model()
    addBg(m, bgFromCommand('b1', 'cd app && npm run build', NOW - 12 * 60_000 - 5_000, false))
    addBg(m, bgFromCommand('b2', 'npm run lint', NOW - 60_000, false))
    const wire = deriveWire(m, NOW, OPTS)
    expect(wire.chips['bg']).toEqual({ text: 'bg 2 · npm run build 12m', color: 'amber' })
    expect(wire.progress).toEqual({ kind: 'busy' })
  })

  test('모니터만 돌면 진행선은 없다', async () => {
    const m = model()
    addBg(m, bgNamed('m1', 'monitor', 'watch logs', NOW - 1000))
    const wire = deriveWire(m, NOW, OPTS)
    expect(wire.chips['bg']?.text).toBe('bg 1 · watch logs <1m')
    expect(wire.progress).toBeNull()
  })

  test('할 일이 있으면 bg가 돌아도 진행선은 할 일 %', async () => {
    const m = model()
    applyTodoWrite(m, [{ status: 'completed' }, { status: 'pending' }])
    addBg(m, bgFromCommand('b1', 'npm run build', NOW, false))
    expect(deriveWire(m, NOW, OPTS).progress).toEqual({ kind: 'value', value: 50 })
  })

  test('bg-done: ✓ 걸린 시간, ✗, ■, linger 뒤 사라짐', async () => {
    const m = model()
    addBg(m, bgFromCommand('b1', 'npm run build', NOW - 123_000, false))
    finishTask(m, 'b1', 'completed', NOW)
    expect(m.bg).toEqual([])
    expect(deriveWire(m, NOW, OPTS).chips['bg-done']).toEqual({ text: '✓ build 2m03s', color: 'green' })
    expect(deriveWire(m, NOW + 59_999, OPTS).chips['bg-done']).toBeDefined()
    expect(deriveWire(m, NOW + 60_000, OPTS).chips['bg-done']).toBeUndefined()

    addBg(m, bgFromCommand('b2', 'npm run build', NOW, false))
    finishTask(m, 'b2', 'failed', NOW + 1000)
    expect(deriveWire(m, NOW + 1000, OPTS).chips['bg-done']).toEqual({ text: '✗ build', color: 'red' })

    addBg(m, bgFromCommand('b3', 'npm run dev', NOW, false))
    finishTask(m, 'b3', 'killed', NOW + 2000)
    expect(deriveWire(m, NOW + 2000, OPTS).chips['bg-done']).toEqual({ text: '■ dev', color: 'gray' })
  })

  test('모르는 작업 id의 끝은 에이전트면 종료 처리, 아니면 무시', async () => {
    const m = model()
    addAgent(m, { id: 'ag', model: 'haiku', isBackground: true, isRunning: true, startedAt: NOW })
    expect(finishTask(m, 'ag', 'completed', NOW).changed).toBe(true)
    expect(m.agents[0]?.isRunning).toBe(false)
    expect(finishTask(m, 'nope', 'completed', NOW)).toEqual({ bg: null, changed: false })
    expect(m.done).toBeNull()
  })
})

describe('task-notification 파서와 Stop 보정', () => {
  test('알림 블록에서 id·상태·출력 파일', async () => {
    const text = [
      '<task-notification>',
      '<task-id>bx81k2</task-id>',
      '<tool-use-id>toolu_01</tool-use-id>',
      '<output-file>C:\\Users\\me\\tasks\\bx81k2.output</output-file>',
      '<status>completed</status>',
      '<summary>Background command "npm run build" completed (exit code 0)</summary>',
      '</task-notification>',
      '<task-notification><task-id>m1</task-id><event>line</event></task-notification>',
      '<task-notification><task-id>b9</task-id><status>failed</status></task-notification>',
    ].join('\n')
    expect(parseTaskNotifications(text)).toEqual([
      { taskId: 'bx81k2', status: 'completed', outputFile: 'C:\\Users\\me\\tasks\\bx81k2.output', summary: 'Background command "npm run build" completed (exit code 0)' },
      { taskId: 'b9', status: 'failed', outputFile: null, summary: null },
    ])
    expect(parseTaskNotifications('그냥 프롬프트')).toEqual([])
  })

  test('Stop: 목록에 없는 오래된 작업은 끝 표시 없이 빼고, 모르는 작업은 더한다', async () => {
    const m = model()
    addBg(m, bgFromCommand('old', 'npm run build', NOW - 10_000, false))
    addBg(m, bgFromCommand('fresh', 'npm run lint', NOW - 1_000, false))
    addAgent(m, { id: 'bga', model: 'opus', isBackground: true, isRunning: true, startedAt: NOW - 10_000 })
    const isChanged = reconcileBackground(
      m,
      [
        { id: 'w1', type: 'workflow', status: 'running', description: 'review', name: 'code-review' },
        { id: 's1', type: 'shell', status: 'running', description: 'dev server', command: 'cd web && pnpm run dev' },
      ],
      NOW,
    )
    expect(isChanged).toBe(true)
    expect(m.bg.map(bg => [bg.id, bg.kind, bg.label])).toEqual([
      ['fresh', 'shell', 'npm run lint'],
      ['w1', 'workflow', 'code-review'],
      ['s1', 'shell', 'pnpm run dev'],
    ])
    expect(m.agents[0]?.isRunning).toBe(false)
    expect(m.done).toBeNull()
  })
})
