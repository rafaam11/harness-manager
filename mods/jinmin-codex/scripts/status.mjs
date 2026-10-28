import { readState } from './store.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const args = process.argv.slice(2);
const data = args[args.indexOf('--data') + 1];
const session = args[args.indexOf('--session') + 1];
if (!args.includes('--data') || !args.includes('--session') || !data || !session) {
  console.error('사용법: node status.mjs --data <플러그인 데이터 폴더> --session <Codex 세션 ID>');
  process.exitCode = 2;
} else {
  try {
    const state = await readState(data, session);
    if (!state) { console.error('관측된 상태가 없습니다. hook 신뢰 후 새 세션에서 확인하세요.'); process.exitCode = 1; }
    else {
      let git = null;
      if (typeof state.cwd === 'string' && path.isAbsolute(state.cwd)) {
        try {
          const { stdout } = await promisify(execFile)('git', ['--no-optional-locks', '-C', state.cwd, 'status', '--porcelain=v2', '--branch'], { windowsHide: true, timeout: 2000, maxBuffer: 256 * 1024 });
          const lines = stdout.split(/\r?\n/);
          const ab = lines.find((line) => line.startsWith('# branch.ab '))?.match(/\+(\d+) -(\d+)/);
          git = { branch: lines.find((line) => line.startsWith('# branch.head '))?.slice(14) ?? null, changedEntries: lines.filter((line) => line && !line.startsWith('#')).length,
            ...(ab ? { ahead: Number(ab[1]), behind: Number(ab[2]) } : {}) };
        } catch { /* No repository, unavailable Git or slow query: keep the observed session data. */ }
      }
      console.log(JSON.stringify({ ...state, git }, null, 2));
    }
  } catch { console.error('상태 파일을 읽지 못했습니다.'); process.exitCode = 1; }
}
