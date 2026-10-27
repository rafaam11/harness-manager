import os from "node:os";
import path from "node:path";

// HM_HOME은 엔진 테스트와 hm-cli 시험 실행이 실제 홈을 건드리지 않게 하는 격리 장치다(v3 원칙).
// HM_CLAUDE_HOME·HM_CODEX_HOME은 provider 홈만 따로 바꾼다.
export const HM_USER_HOME = process.env.HM_HOME ? path.resolve(process.env.HM_HOME) : os.homedir();
export const CLAUDE_HOME = process.env.HM_CLAUDE_HOME
  ? path.resolve(process.env.HM_CLAUDE_HOME)
  : path.join(HM_USER_HOME, ".claude");
export const CLAUDE_JSON = path.join(HM_USER_HOME, ".claude.json");
export const CODEX_HOME = process.env.HM_CODEX_HOME
  ? path.resolve(process.env.HM_CODEX_HOME)
  : process.env.CODEX_HOME || path.join(HM_USER_HOME, ".codex");
export const APP_STATE_DIR = path.join(HM_USER_HOME, ".harness-manager");
// 공개 레포에 넣지 않는 개인 부분(AGENTS.local.md, 로컬 오버레이, private-terms.json). capture가 쓴다.
export const PROFILE_DIR = path.join(APP_STATE_DIR, "profile");
// 앱 설정(고른 프로필 core/dev/full 등). 위저드(M7)가 쓰고 doctor·install이 읽는다.
export const APP_SETTINGS_FILE = path.join(APP_STATE_DIR, "settings.json");
// 앱이 기억하는 레포 클론 위치({"path": "..."}). 설치본은 자기 위치로 레포를 알 수 없다.
export const REPO_LOCATION_FILE = path.join(APP_STATE_DIR, "repo.json");
// 외부 스킬(npx skills)의 설치 기록. capture가 manifest/skills.json의 원본으로 읽는다.
export const AGENTS_SKILL_LOCK = path.join(HM_USER_HOME, ".agents", ".skill-lock.json");
// npx skills·Codex가 함께 쓰는 스킬 폴더. 정리(M8)가 깨진 링크·중복 사본을 옮기려면 이 폴더가 allowlist에 있어야 한다.
export const AGENTS_SKILLS_DIR = path.join(HM_USER_HOME, ".agents", "skills");

// 모든 파일 연산이 허용되는 경로. path-guard가 이 목록으로 검사한다.
export const ALLOWED_ROOTS = [CLAUDE_HOME, CLAUDE_JSON, CODEX_HOME, APP_STATE_DIR, AGENTS_SKILLS_DIR];

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
