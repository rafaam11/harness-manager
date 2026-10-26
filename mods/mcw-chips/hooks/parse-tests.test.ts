import { describe, expect, test } from 'claude-code/testing'

import { isTestCommand, parseTestSummary, stripAnsi } from './parse-tests'

const ESC = String.fromCharCode(27)

describe('isTestCommand', () => {
  test('명령 자리의 테스트 러너는 잡는다', async () => {
    for (const command of [
      'npm test',
      'npm run test',
      'npm run test:unit -- --run',
      'pnpm test',
      'yarn test:e2e',
      'bun test',
      'npx vitest run',
      'vitest',
      'pnpm exec vitest run src',
      'pnpm vitest',
      'bunx jest --ci',
      'jest',
      'npx playwright test',
      'playwright test --project=chromium',
      'pytest -q',
      'python -m pytest tests',
      'python3 -m pytest',
      'node --test',
      'cd C:/dev/app && npm test',
      'npm run build; npm test',
      'echo hi | npx vitest run',
      'CI=1 npx vitest run',
    ]) {
      expect({ command, hit: isTestCommand(command) }).toEqual({ command, hit: true })
    }
  })

  test('러너 이름이 인자에만 있으면 아니다', async () => {
    for (const command of [
      'npm run build',
      'git log --grep test',
      'cat vitest.config.ts',
      'rg "pytest" src',
      'npm install -D vitest',
      'echo npm test',
      'ls tests',
      'npm run testing-utils',
    ]) {
      expect({ command, hit: isTestCommand(command) }).toEqual({ command, hit: false })
    }
  })
})

describe('parseTestSummary', () => {
  test('vitest: Test Files 줄이 아니라 Tests 줄', async () => {
    const out = [
      ' ❯ src/a.test.ts (5 tests | 3 failed) 12ms',
      '',
      ' Test Files  1 failed | 4 passed (5)',
      '      Tests  3 failed | 38 passed (41)',
      '   Start at  10:00:00',
      '   Duration  1.20s',
    ].join('\n')
    expect(parseTestSummary(out)).toEqual({ passed: 38, failed: 3 })
  })

  test('vitest: ANSI 색이 섞여 있어도', async () => {
    const out = `${ESC}[2m Test Files ${ESC}[22m ${ESC}[1m${ESC}[32m5 passed${ESC}[39m${ESC}[22m${ESC}[90m (5)${ESC}[39m\n${ESC}[2m      Tests ${ESC}[22m ${ESC}[1m${ESC}[32m41 passed${ESC}[39m${ESC}[22m${ESC}[90m (41)${ESC}[39m\n`
    expect(stripAnsi(out)).not.toContain(ESC)
    expect(parseTestSummary(out)).toEqual({ passed: 41, failed: 0 })
  })

  test('요약이 두 번이면 마지막 것', async () => {
    const out = ['      Tests  3 failed | 38 passed (41)', 'rerun...', '      Tests  41 passed (41)'].join('\n')
    expect(parseTestSummary(out)).toEqual({ passed: 41, failed: 0 })
  })

  test('jest', async () => {
    const out = ['Test Suites: 1 failed, 3 passed, 4 total', 'Tests:       3 failed, 38 passed, 41 total', 'Snapshots:   0 total', 'Time:        2.1 s'].join('\n')
    expect(parseTestSummary(out)).toEqual({ passed: 38, failed: 3 })
  })

  test('playwright: flaky는 통과로', async () => {
    const out = [
      'Running 41 tests using 4 workers',
      '  1) [chromium] › a.spec.ts:3:5 › fails',
      '',
      '  2 failed',
      '    [chromium] › a.spec.ts:3:5 › fails',
      '  1 flaky',
      '    [chromium] › b.spec.ts:9:5 › flaky one',
      '  2 skipped',
      '  36 passed (12.3s)',
    ].join('\n')
    expect(parseTestSummary(out)).toEqual({ passed: 37, failed: 2 })
  })

  test('pytest: error도 실패로', async () => {
    expect(parseTestSummary('collected 13 items\n\n===== 2 failed, 10 passed, 1 error in 1.23s =====\n')).toEqual({ passed: 10, failed: 3 })
    expect(parseTestSummary('============ 12 passed in 0.50s ============')).toEqual({ passed: 12, failed: 0 })
  })

  test('node --test (TAP)과 bun test', async () => {
    expect(parseTestSummary('# tests 5\n# suites 1\n# pass 4\n# fail 1\n# cancelled 0\n')).toEqual({ passed: 4, failed: 1 })
    expect(parseTestSummary(' 38 pass\n 3 fail\n 120 expect() calls\nRan 41 tests across 3 files. [1.20s]\n')).toEqual({ passed: 38, failed: 3 })
  })

  test('요약이 없으면 null', async () => {
    expect(parseTestSummary('Error: Cannot find module vitest\n    at x (y.js:1:1)')).toBeNull()
    expect(parseTestSummary('')).toBeNull()
  })
})
