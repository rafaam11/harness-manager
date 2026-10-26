import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { detectCompanion, finishedMessage, parseStatus } from './status'

const COMPANION = 'C:/Users/me/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs'

describe('status', () => {
  test('codex companion 명령을 알아본다', async () => {
    expect(detectCompanion(`node "${COMPANION}" review --background`)).toEqual({ path: COMPANION, sub: 'review' })
    expect(detectCompanion(`node ${COMPANION} adversarial-review`)?.sub).toBe('adversarial-review')
    expect(detectCompanion(`node "${COMPANION}" task --write "fix it"`)?.sub).toBe('task')
    expect(detectCompanion(`node "${COMPANION}" status --json`)).toBeNull()
    expect(detectCompanion('git status')).toBeNull()
  })

  test('status --json을 읽는다', async () => {
    const parsed = parseStatus(
      JSON.stringify({
        running: [{ id: 'r1', kindLabel: 'review', status: 'running', phase: 'reviewing', startedAt: '2026-10-18T00:00:00Z' }],
        latestFinished: { id: 'r0', kindLabel: 'adversarial-review', status: 'completed', duration: '3m 2s', summary: '  2 issues found\n in a.ts ' },
        recent: [{ id: 'x' }, { nope: true }],
      }),
    )
    expect(parsed?.running[0]).toMatchObject({ id: 'r1', kind: 'review', phase: 'reviewing', startedAt: Date.parse('2026-10-18T00:00:00Z') })
    expect(parsed?.finished.map(job => job.id)).toEqual(['r0', 'x'])
    expect(finishedMessage(parsed!.finished[0]!)).toBe('Codex 적대적 리뷰 끝 · 3m 2s · 2 issues found in a.ts — /codex:result')
    expect(parseStatus('not json')).toBeNull()
  })
})

function engine(on: On, statuses: string[], toasts: string[]) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: 'C:/work' }))
  on('fs.list', () => ({ value: [{ name: '1.0.3', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: statuses.length > 1 ? (statuses.shift() ?? '') : (statuses[0] ?? ''), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } as never, text: 'ok' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
}

const RUNNING = JSON.stringify({ running: [{ id: 'j1', kindLabel: 'review', status: 'running', phase: 'reviewing', startedAt: '1970-01-01T00:00:00Z' }], latestFinished: null, recent: [] })
const DONE = JSON.stringify({ running: [], latestFinished: { id: 'j1', kindLabel: 'review', status: 'completed', duration: '1m 5s', summary: 'No issues.' }, recent: [] })

const BAND = {
  plugin: 'codex-watch',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 0 }, view: {} },
} as const

test('리뷰가 돌면 입력창 위에 보이고, 끝나면 토스트 한 번', async ($, on) => {
  const statuses = [JSON.stringify({ running: [], latestFinished: null, recent: [] }), RUNNING, RUNNING, DONE]
  const toasts: string[] = []
  const clock = mock.clock(on, { now: 65_000 })
  mock.env(on, { USERPROFILE: 'C:/Users/me' })
  engine(on, statuses, toasts)

  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await clock.advance(1_000)
  await $.tool.call({ tool: 'Bash', command: `node "${COMPANION}" review --background` })
  await clock.advance(1_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Codex 리뷰 진행 중/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
    await ui.unmount()
  }

  await clock.advance(10_000)
  expect(toasts).toEqual(['Codex 리뷰 끝 · 1m 5s · No issues. — /codex:result'])
  await clock.advance(10_000)
  expect(toasts).toHaveLength(1)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /진행 중/ })).toBeUndefined()
  await ui.unmount()
})
