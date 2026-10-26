import type { DoctorCheckState, DoctorSection } from "./doctor-types";
import type { Profile } from "./manifest-types";

/**
 * install(M6) 계약. step 하나는 manifest 항목 하나(또는 설정 파일 하나)를 manifest 상태로 맞춘다.
 * 렌더러와 AI 위저드는 step id만 보낸다 — 실행 파일·인자·쓸 내용은 main이 manifest에서 정한다.
 */

/** 이 step의 현재 상태. doctor 검사 결과에서 온다. ok면 실행할 것이 없다. */
export type InstallStepState = DoctorCheckState;

export interface InstallAction {
  kind: "command" | "file" | "manual";
  /** 사람이 읽는 한 줄. 명령이면 실행할 명령줄, 파일이면 바꿀 파일과 무엇을 하는지. */
  summary: string;
  /** 파일 변경의 unified diff(파일일 때만). */
  diff?: string;
}

export interface InstallStep {
  id: string;
  section: DoctorSection;
  title: string;
  state: InstallStepState;
  /** 상태의 근거(doctor 상세). */
  detail: string;
  /** ok·skipped·info가 아니고 manual이 아니면 true. */
  actionable: boolean;
  /** 자동으로 할 수 없어 안내만 하는 step(예: 설치 명령이 정해지지 않은 도구). */
  manual: boolean;
  actions: InstallAction[];
}

export interface InstallPlan {
  repoRoot: string | null;
  repoError?: string;
  profile: Profile;
  /** 실행 순서대로. */
  steps: InstallStep[];
}

export type InstallOutcome = "done" | "skipped" | "failed" | "manual";

export interface InstallStepResult {
  id: string;
  outcome: InstallOutcome;
  /** 실행 뒤 다시 검사한 상태. */
  after: InstallStepState;
  detail: string;
}

export interface InstallRunResult {
  results: InstallStepResult[];
  /** 끝난 뒤 doctor를 다시 돌린 카드 상태 요약. */
  verify: { section: DoctorSection; state: string; summary: string }[];
  cancelled: boolean;
}

export type InstallEvent =
  | { type: "run-start"; total: number }
  | { type: "step-start"; id: string; index: number; title: string }
  | { type: "log"; id: string; stream: "stdout" | "stderr" | "info"; line: string }
  | { type: "step-done"; result: InstallStepResult }
  | { type: "run-done"; result: InstallRunResult };

export const INSTALL_OUTCOME_LABELS: Record<InstallOutcome, string> = {
  done: "완료",
  skipped: "건너뜀",
  failed: "실패",
  manual: "직접 해야 함",
};
