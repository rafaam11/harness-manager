import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { detect, type Danger } from './rules'

// 가드형 mod: 되돌리기 어려운 셸 명령을 실행 전에 붙잡고, 무엇이 사라지는지 보여 준 뒤
// 엔진의 질문 창으로 확인받는다. 권한 모드(bypass 포함)와 상관없이 묻는다.
// 이 훅은 거부하는 자리라 .catch로 실패 시에도 보류(deny)한다.

const enabledAtom = atom({ plugin: 'guard', key: 'isEnabled' } as const, true)

const IMPACT_TIMEOUT_MS = 3_000
const LIST_LIMIT = 5
const COUNT_LIMIT = 2_000

const RUN = '실행'
const CANCEL = '취소'

function joinPath(cwd: string, path: string): string {
  return /^([a-zA-Z]:[\\/]|[\\/])/.test(path) ? path : `${cwd.replace(/[\\/]$/, '')}/${path}`
}

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  const ran = await $.process.run(['git', ...args], { cwd, timeoutMs: IMPACT_TIMEOUT_MS }).catch(() => null)

  return ran && ran.exitCode === 0 ? ran.stdout : null
}

// 폴더를 두 단계까지 세어 대략의 규모를 보여 준다.
async function countTree($: EngineInterface, path: string): Promise<{ files: number; dirs: number; isMore: boolean }> {
  const out = { files: 0, dirs: 0, isMore: false }
  const queue: Array<{ path: string; depth: number }> = [{ path, depth: 0 }]
  while (queue.length > 0) {
    const next = queue.shift()
    if (!next) {
      break
    }
    const entries = await $.fs.list(next.path).catch(() => [])
    for (const entry of entries) {
      if (entry.kind === 'dir') {
        out.dirs += 1
        if (next.depth < 1) {
          queue.push({ path: `${next.path}/${entry.name}`, depth: next.depth + 1 })
        } else {
          out.isMore = true
        }
      } else {
        out.files += 1
      }
      if (out.files + out.dirs >= COUNT_LIMIT) {
        return { ...out, isMore: true }
      }
    }
  }

  return out
}

function preview(lines: string[]): string {
  const shown = lines.slice(0, LIST_LIMIT).join(', ')

  return lines.length > LIST_LIMIT ? `${shown} 외 ${lines.length - LIST_LIMIT}개` : shown
}

async function impactOf($: EngineInterface, danger: Danger, cwd: string): Promise<string> {
  const dir = danger.gitDir ? joinPath(cwd, danger.gitDir) : cwd
  switch (danger.kind) {
    case 'rm': {
      const parts: string[] = []
      for (const target of danger.targets.slice(0, LIST_LIMIT)) {
        if (/[*?]/.test(target)) {
          parts.push(`${target}: 와일드카드라 대상을 미리 셀 수 없음`)
          continue
        }
        const full = joinPath(cwd, target)
        const stat = await $.fs.stat(full).catch(() => null)
        if (!stat) {
          parts.push(`${target}: 없음`)
        } else if (stat.kind === 'dir') {
          const tree = await countTree($, full)
          parts.push(`${target}: 폴더 ${tree.dirs}개 · 파일 ${tree.files}개${tree.isMore ? ' 이상' : ''}`)
        } else {
          parts.push(`${target}: 파일 1개`)
        }
      }

      return parts.join('\n') || '대상을 알 수 없음'
    }
    case 'reset-hard':
    case 'discard': {
      const status = await git($, dir, ['status', '--porcelain'])
      if (status === null) {
        return 'git 상태를 읽지 못함'
      }
      const changed = status
        .split(/\r?\n/)
        .filter(line => line.trim() !== '' && !line.startsWith('??'))
        .map(line => line.slice(3))

      return changed.length === 0 ? '사라질 변경 없음' : `커밋 안 된 변경 ${changed.length}개가 사라짐: ${preview(changed)}`
    }
    case 'clean': {
      const extra = danger.flags.flatMap(flag => (flag.startsWith('--') ? [] : [...flag.slice(1)])).filter(letter => letter === 'd' || letter === 'x' || letter === 'X')
      const dry = await git($, dir, ['clean', '-n', ...extra.map(letter => `-${letter}`), ...danger.targets])
      if (dry === null) {
        return 'git clean 미리보기 실패'
      }
      const removed = dry
        .split(/\r?\n/)
        .filter(line => line.startsWith('Would remove '))
        .map(line => line.slice('Would remove '.length))

      return removed.length === 0 ? '지워질 파일 없음' : `${removed.length}개가 지워짐: ${preview(removed)}`
    }
    case 'push-force': {
      const behind = await git($, dir, ['rev-list', '--count', 'HEAD..@{u}'])
      const branch = (await git($, dir, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim()
      const count = behind === null ? null : Number(behind.trim())

      return count === null
        ? `브랜치 ${branch ?? '?'}: 원격 기록과 비교하지 못함`
        : count > 0
          ? `브랜치 ${branch ?? '?'}: 원격에만 있는 커밋 ${count}개가 덮어써짐`
          : `브랜치 ${branch ?? '?'}: 원격에만 있는 커밋 없음(마지막으로 받아 온 기준)`
    }
    case 'branch-delete': {
      const parts: string[] = []
      for (const name of danger.targets.slice(0, LIST_LIMIT)) {
        const only = await git($, dir, ['rev-list', '--count', name, '--not', '--remotes', 'HEAD'])
        parts.push(only === null ? `${name}: 확인 실패` : `${name}: 다른 곳에 없는 커밋 ${only.trim()}개`)
      }

      return parts.join('\n')
    }
    case 'stash': {
      const list = await git($, dir, ['stash', 'list'])
      const count = list === null ? null : list.split(/\r?\n/).filter(Boolean).length

      return count === null ? 'stash 목록을 읽지 못함' : `stash ${count}개 중 ${danger.targets[0] ?? (danger.summary.includes('전부') ? '전부' : 'stash@{0}')}가 사라짐`
    }
  }
}

async function confirm($: EngineInterface, dangers: Danger[], command: string): Promise<{ isAllowed: boolean; reason: string }> {
  const cwd = await $.session.cwd().catch(() => '.')
  const parts: string[] = []
  for (const danger of dangers) {
    const impact = await impactOf($, danger, cwd).catch(() => '영향을 계산하지 못함')
    parts.push(`• ${danger.summary}\n  ${impact.replace(/\n/g, '\n  ')}`)
  }
  const shown = command.length > 160 ? `${command.slice(0, 159)}…` : command
  const question = `되돌리기 어려운 명령입니다.\n$ ${shown}\n${parts.join('\n')}\n실행할까요?`
  try {
    const answer = await $.ui.ask(question, { header: '위험 명령', options: [CANCEL, RUN] })

    return answer === RUN ? { isAllowed: true, reason: '' } : { isAllowed: false, reason: `guard: 사용자가 실행을 취소했습니다 (${dangers.map(one => one.summary).join(', ')}). 같은 명령을 다시 시도하지 말고 사용자에게 어떻게 할지 물어보세요.` }
  } catch {
    return { isAllowed: false, reason: 'guard: 확인할 사람이 없어 위험 명령을 보류했습니다. 사용자에게 직접 확인을 받으세요.' }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: 'guard', description: '위험 명령 보류를 이 세션에서 끄기/켜기 (on|off|status)', argumentHint: '[on|off|status]' })
      .catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'guard' }, async ($, e) => {
    const arg = (e.args ?? '').trim()
    if (arg === 'on' || arg === 'off') {
      await update($, enabledAtom, () => arg === 'on')

      return { text: arg === 'on' ? 'guard: 위험 명령 보류를 켰습니다.' : 'guard: 이 세션에서 위험 명령 보류를 껐습니다. (/guard on으로 다시 켜기)' }
    }

    return { text: `guard: ${(await read($, enabledAtom)) ? '켜짐' : '꺼짐'} — 대상: rm -r · Remove-Item -Recurse · git push --force · reset --hard · clean -f · checkout -- / restore · branch -D · stash drop/clear` }
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const command = String((e as unknown as { command?: unknown }).command ?? '')
    const dangers = detect(command)
    if (dangers.length === 0 || !(await read($, enabledAtom))) {
      return next(e)
    }
    const verdict = await confirm($, dangers, command)

    return verdict.isAllowed ? next(e) : { deny: verdict.reason }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'guard: 검사 중 오류가 나서 위험할 수 있는 명령을 보류했습니다.' }))
}
