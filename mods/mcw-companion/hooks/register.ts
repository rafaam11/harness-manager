import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { McwContext } from '../types'

// multi-cli-work가 띄운 Claude 세션에서만 켜진다: 앱이 넣는 MULTI_CLI_WORK_* 환경변수로 판정.
// 화면 표시(프로젝트명 등)는 jinmin-hud가 맡고, 여기는 /mcw와 알림만 둔다.

const ctxAtom = atom({ plugin: 'mcw-companion', key: 'ctx' } as const, null)

const LONG_TURN_SECONDS = 60
const RATE_LIMIT_WARN_PERCENT = 90
const BRIEF_HEAD_LINES = 20

function projectOf(brief: string): string | null {
  const heading = brief.match(/^#\s*업무 프로젝트:\s*(.+)$/m) ?? brief.match(/^#\s+(.+)$/m)

  return heading?.[1]?.trim() || null
}

function describe(ctx: McwContext): string {
  const lines = [
    `multi-cli-work 세션 ${ctx.sessionId}`,
    `- generation: ${ctx.generation ?? '(없음)'}`,
    `- 프로젝트: ${ctx.project ?? '(소속 업무 프로젝트 없음)'}`,
    `- settings 오버레이: ${ctx.settingsPath ?? '(없음)'}`,
    `- 브리프: ${ctx.briefPath ?? '(없음)'}`,
  ]
  if (ctx.briefHead) {
    lines.push('', `브리프 앞 ${BRIEF_HEAD_LINES}줄:`, ctx.briefHead)
  }

  return lines.join('\n')
}

export const register: Register = on => {
  let isActive = false
  const warned = new Set<string>()

  on('session.start', async ($, e, next) => {
    // 커맨드 등록이 실패해도 세션 판정은 살아 있게 한다.
    await $.command
      .register({ name: 'mcw', description: 'multi-cli-work 세션 정보와 프로젝트 브리프' })
      .catch(() => undefined)

    const sessionId = await $.env.get('MULTI_CLI_WORK_SESSION_ID')
    isActive = Boolean(sessionId)
    if (!sessionId) {
      await update($, ctxAtom, () => null)

      return next(e)
    }

    const briefPath = (await $.env.get('MULTI_CLI_WORK_PROJECT_BRIEF')) || null
    let brief: string | null = null
    if (briefPath) {
      try {
        brief = await $.fs.read(briefPath)
      } catch {
        brief = null
      }
    }

    const ctx: McwContext = {
      sessionId,
      generation: (await $.env.get('MULTI_CLI_WORK_GENERATION')) || null,
      settingsPath: (await $.env.get('MULTI_CLI_WORK_CLAUDE_SETTINGS')) || null,
      briefPath,
      project: brief ? projectOf(brief) : null,
      briefHead: brief ? brief.split(/\r?\n/).slice(0, BRIEF_HEAD_LINES).join('\n') : null,
    }
    await update($, ctxAtom, () => ctx)

    return next(e)
  })

  on('command.run', { command: 'mcw' }, async $ => {
    const ctx = await read($, ctxAtom)

    return {
      text: ctx === null ? '이 세션은 multi-cli-work 안에서 시작되지 않았습니다 (MULTI_CLI_WORK_SESSION_ID 없음).' : describe(ctx),
    }
  })

  on('turn.complete', ($, e, next) => {
    if (isActive && e.agentId === undefined) {
      const seconds = Math.round(e.durationMs / 1000)
      if (seconds >= LONG_TURN_SECONDS) {
        $.ui.toast(`⏱ 턴 완료 · ${seconds}s`)
      }
    }

    return next(e)
  })

  on('session.measure', ($, e, next) => {
    if (isActive) {
      for (const limit of e.rateLimits) {
        if (limit.percentUsed < RATE_LIMIT_WARN_PERCENT) {
          warned.delete(limit.kind)
        } else if (!warned.has(limit.kind)) {
          warned.add(limit.kind)
          $.ui.toast(`⚠ ${limit.kind} 한도 ${limit.percentUsed}% 사용`)
        }
      }
    }

    return next(e)
  })
}
