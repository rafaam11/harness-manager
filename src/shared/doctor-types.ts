import type { Profile } from "./manifest-types";

/**
 * doctor 결과. 앱 상태판·섹션 화면, `hm doctor --json`(AI 위저드)이 같은 형태를 쓴다.
 * 검사 하나의 상태가 카드 하나의 상태로 모인다(스펙 §5-3).
 */

export type DoctorSection = "toolchain" | "claude" | "codex" | "plugins" | "skills" | "mcp" | "cua" | "dotfiles";
export const DOCTOR_SECTIONS: readonly DoctorSection[] = ["toolchain", "claude", "codex", "plugins", "skills", "mcp", "cua", "dotfiles"];

export const DOCTOR_SECTION_LABELS: Record<DoctorSection, string> = {
  toolchain: "툴체인",
  claude: "Claude Code",
  codex: "Codex",
  plugins: "플러그인",
  skills: "스킬",
  mcp: "MCP",
  cua: "cua-driver",
  dotfiles: "dotfiles",
};

/**
 * - ok: manifest와 같다
 * - drift: 있지만 manifest와 다르다(노랑)
 * - missing: 없다(빨강)
 * - error: 검사하지 못했다(빨강)
 * - info: 알려 줄 뿐 상태에 넣지 않는다
 * - skipped: 고른 프로필 밖이라 세지 않는다
 */
export type DoctorCheckState = "ok" | "drift" | "missing" | "error" | "info" | "skipped";

export const DOCTOR_CHECK_LABELS: Record<DoctorCheckState, string> = {
  ok: "정상",
  drift: "다름",
  missing: "없음",
  error: "검사 실패",
  info: "정보",
  skipped: "프로필 밖",
};

export interface DoctorCheck {
  /** 섹션 안에서 유일. install step id와 같은 체계를 쓴다(예: `packages.winget.git`, `mcp.cua-driver.codex`). */
  id: string;
  title: string;
  state: DoctorCheckState;
  detail: string;
  /** 비공개 오버레이(`profile/manifest.local.json`)에서 온 항목이면 true. */
  local?: boolean;
}

/** 카드 색. ok=초록 "정상", warn=노랑 "주의", fail=빨강 "누락", info=회색 "정보". */
export type DoctorCardState = "ok" | "warn" | "fail" | "info";

export const DOCTOR_CARD_LABELS: Record<DoctorCardState, string> = {
  ok: "정상",
  warn: "주의",
  fail: "누락",
  info: "정보",
};

export interface DoctorCard {
  section: DoctorSection;
  label: string;
  state: DoctorCardState;
  /** 한 줄 요약(예: "패키지 10/11 정상"). */
  summary: string;
  checks: DoctorCheck[];
}

export interface DoctorReport {
  schemaVersion: 1;
  generatedAt: string;
  profile: Profile;
  repoRoot: string | null;
  repoError?: string;
  cards: DoctorCard[];
}
