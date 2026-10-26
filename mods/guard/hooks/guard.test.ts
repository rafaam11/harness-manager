import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { detect } from './rules'

describe('detect', () => {
  const kinds = (command: string) => detect(command).map(one => one.kind)

  test('위험 명령을 찾는다', async () => {
    expect(kinds('rm -rf dist')).toEqual(['rm'])
    expect(kinds('sudo rm -r ./build ./out')).toEqual(['rm'])
    expect(kinds('rm --recursive tmp')).toEqual(['rm'])
    expect(kinds('Remove-Item -Recurse -Force .\\dist')).toEqual(['rm'])
    expect(kinds('rmdir /s /q build')).toEqual(['rm'])
    expect(kinds('git push --force origin main')).toEqual(['push-force'])
    expect(kinds('git push -f')).toEqual(['push-force'])
    expect(kinds('git push origin +main')).toEqual(['push-force'])
    expect(kinds('git push --force-with-lease')).toEqual(['push-force'])
    expect(kinds('git push origin --delete feat')).toEqual(['push-force'])
    expect(kinds('git -C ../other reset --hard HEAD~1')).toEqual(['reset-hard'])
    expect(kinds('git clean -fdx')).toEqual(['clean'])
    expect(kinds('git checkout -- .')).toEqual(['discard'])
    expect(kinds('git restore src/a.ts')).toEqual(['discard'])
    expect(kinds('git branch -D old-feature')).toEqual(['branch-delete'])
    expect(kinds('git stash clear')).toEqual(['stash'])
    expect(kinds('npm test && rm -rf coverage')).toEqual(['rm'])
  })

  test('안전한 명령과 따옴표 속 글자는 지나친다', async () => {
    for (const command of [
      'rm file.txt',
      'rm -f a.log',
      'Remove-Item a.txt',
      'git push',
      'git push -u origin feat',
      'git push --follow-tags',
      'git reset --soft HEAD~1',
      'git reset HEAD a.ts',
      'git clean -n -d',
      'git clean -fdn',
      'git checkout main',
      'git checkout -b feat',
      'git restore --staged a.ts',
      'git branch -d merged',
      'git stash pop',
      'echo "rm -rf /"',
      "grep -r 'git push --force' docs",
      'git commit -m "git reset --hard 설명"',
    ]) {
      expect(kinds(command)).toEqual([])
    }
  })

  test('대상과 git -C 폴더를 뽑는다', async () => {
    expect(detect('rm -rf "my dir" build')[0]?.targets).toEqual(['my dir', 'build'])
    expect(detect('Remove-Item -Path .\\out -Recurse')[0]?.targets).toEqual(['.\\out'])
    expect(detect('git -C ../x reset --hard')[0]?.gitDir).toBe('../x')
    expect(detect('git branch -D a b')[0]?.targets).toEqual(['a', 'b'])
  })
})

// 테스트의 on은 엔진 자리: 플러그인이 next(e)로 넘긴 툴 호출과 $.ui.ask의 질문 창에 답한다.
function engine(on: On, answer: string | null, ran: string[], asked: string[]) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: 'C:/work' }))
  on('process.run', ($, e) => {
    const args = e.argv.join(' ')
    if (args.startsWith('git status')) {
      return { value: { exitCode: 0, stdout: ' M src/a.ts\n M src/b.ts\n?? new.txt\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }

    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.stat', () => ({ deny: 'ENOENT' }))
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const question = String((e.questions[0] as { question?: string } | undefined)?.question ?? '')
      asked.push(question)
      if (answer === null) {
        return { deny: '대화 상자를 닫음' }
      }

      return { result: { questions: e.questions, answers: { [question]: answer } } as never, text: answer }
    }
    ran.push(String((e as unknown as { command?: string }).command ?? ''))

    return { result: { stdout: '', stderr: '' } as never, text: 'ok' }
  })
}

test('실행을 고르면 명령이 실행된다', async ($, on) => {
  const ran: string[] = []
  const asked: string[] = []
  engine(on, '실행', ran, asked)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(ran).toEqual(['git reset --hard'])
  expect(asked[0]).toContain('커밋 안 된 변경 2개가 사라짐: src/a.ts, src/b.ts')
  expect(asked[0]).toContain('실행할까요?')
})

test('취소하거나 창을 닫으면 막는다', async ($, on) => {
  const ran: string[] = []
  const asked: string[] = []
  engine(on, '취소', ran, asked)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })

  const cancelled = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran).toEqual([])
  expect(asked[0]).toContain('build: 없음')
  expect(JSON.stringify(cancelled)).toContain('사용자가 실행을 취소했습니다')
})

test('물을 수 없으면 보류한다', async ($, on) => {
  const ran: string[] = []
  engine(on, null, ran, [])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })

  const held = await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item -Recurse dist' })
  expect(ran).toEqual([])
  expect(JSON.stringify(held)).toContain('guard')
})

test('위험하지 않은 명령은 묻지 않는다, /guard off면 지나간다', async ($, on) => {
  const ran: string[] = []
  const asked: string[] = []
  engine(on, '취소', ran, asked)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'git status' })
  const off = await $.command.run({ command: 'guard', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(off.text).toContain('껐습니다')
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(asked).toEqual([])
  expect(ran).toEqual(['git status', 'rm -rf build'])
})
