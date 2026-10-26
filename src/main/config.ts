import os from "node:os";
import path from "node:path";

export const CLAUDE_HOME = path.join(os.homedir(), ".claude");
export const CLAUDE_JSON = path.join(os.homedir(), ".claude.json");
export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
// HM_HOME은 엔진 테스트와 hm-cli 시험 실행이 실제 홈을 건드리지 않게 하는 격리 장치다(v3 원칙).
export const HM_USER_HOME = process.env.HM_HOME ? path.resolve(process.env.HM_HOME) : os.homedir();
export const APP_STATE_DIR = path.join(HM_USER_HOME, ".harness-manager");

// 모든 파일 연산이 허용되는 경로. path-guard가 이 목록으로 검사한다.
export const ALLOWED_ROOTS = [CLAUDE_HOME, CLAUDE_JSON, CODEX_HOME, APP_STATE_DIR];

// 설정 파일 쓰기·복원의 .bak 백업 위치(앱 소유). v2의 ~/.claude/backups/harness-manager는 더 이상 쓰지 않는다.
export const BACKUP_DIR = path.join(APP_STATE_DIR, "backups");
export const BACKUP_KEEP = 20;

export const ARCHIVE_ROOT = path.join(CLAUDE_HOME, "archive");

export const STALE_DAYS = 30;
export const AGENT_SIZE_WARN_BYTES = 19 * 1024;

// 편집 가능한 설정 파일. claude-json은 MVP에서 읽기 전용 (CC가 상시 재작성).
export const CONFIG_FILES: Record<string, { path: string; writable: boolean }> = {
  settings: { path: path.join(CLAUDE_HOME, "settings.json"), writable: true },
  "settings-local": { path: path.join(CLAUDE_HOME, "settings.local.json"), writable: true },
  "claude-json": { path: CLAUDE_JSON, writable: false },
};

// 레포 일괄 최신화(repo-sync)의 결과·잠금·설정. 계약은 docs/contracts/repo-sync.md.
export const REPO_SYNC_DIR = path.join(APP_STATE_DIR, "repo-sync");
// multi-cli-work가 찾아 부르는 hm-cli 심의 위치.
export const HM_CLI_BIN_DIR = path.join(APP_STATE_DIR, "bin");

export const TEMP_DIRS = [
  "session-env",
  "plans",
  "file-history",
  "paste-cache",
  "shell-snapshots",
];
