import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const START = { cwd: 'C:/dev/multi-cli-work', surface: 'terminal', isInteractive: true } as const
const BRIEF_PATH = 'C:/mcw/briefs/brief.md'
const BRIEF = '# 업무 프로젝트: 예시프로젝트\n\n- 구분: 예시\n'

function mcw() {
  return {
    command: 'mcw',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  } as const
}

// 테스트의 on은 엔진 자리라, 플러그인 훅이 next(e)로 넘긴 이벤트에 엔진처럼 답한다.
function engineBottom(on: On, toasts: string[]) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('fs.read', ($, e) =>
    e.path.replaceAll('\\', '/') === BRIEF_PATH ? { value: BRIEF } : { deny: `ENOENT ${e.path}` },
  )
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
}

test('multi-cli-work 밖에서는 /mcw가 안내만 하고 알림이 없다', async ($, on) => {
  const toasts: string[] = []
  mock.env(on, {})
  engineBottom(on, toasts)
  await $.session.start(START)

  const ran = await $.command.run(mcw())
  expect(ran.text).toContain('multi-cli-work 안에서 시작되지 않았습니다')
  await $.turn.complete({ answer: 'x', durationMs: 90000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(toasts).toEqual([])
})

test('multi-cli-work 세션: /mcw, 긴 턴·한도 토스트', async ($, on) => {
  const toasts: string[] = []
  mock.env(on, {
    MULTI_CLI_WORK_SESSION_ID: 'abcdef1234567890',
    MULTI_CLI_WORK_GENERATION: '3',
    MULTI_CLI_WORK_PROJECT_BRIEF: BRIEF_PATH,
  })
  engineBottom(on, toasts)
  await $.session.start(START)

  const info = await $.command.run(mcw())
  expect(info.text).toContain('abcdef1234567890')
  expect(info.text).toContain('프로젝트: 예시프로젝트')
  expect(info.text).toContain('- 구분: 예시')

  for (let i = 0; i < 2; i += 1) {
    await $.session.measure({
      context: { window: 200000, tokens: 124000, percent: 62 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 92 }],
      changed: ['rateLimits'],
    })
  }
  await $.turn.complete({ answer: 'done', durationMs: 75000, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.complete({ answer: 'x', durationMs: 90000, isAborted: false, turnId: 's1', agentId: 'a1', reason: 'answer' })
  expect(toasts).toEqual(['⚠ five_hour 한도 92% 사용', '⏱ 턴 완료 · 75s'])
})
