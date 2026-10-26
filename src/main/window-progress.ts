/** 진행 상황 한 건. 설치 step 하나가 보고한다(M6). value는 0–100, 모르면 null. */
export interface ProgressReport {
  state: "normal" | "indeterminate" | "error" | "warning";
  value: number | null;
}

/** Arguments for `BrowserWindow.setProgressBar`: -1 removes the bar, above 1 is indeterminate. */
export interface TaskbarProgress {
  value: number;
  mode: "none" | "normal" | "indeterminate" | "error" | "paused";
}

/**
 * 진행 중인 모든 작업을 작업표시줄 막대 하나로 모은다. 실패가 가장 먼저 보여야 하고, 그다음이 멈춤이다.
 * 그 밖에는 가장 덜 끝난 작업을 따라간다.
 */
export function aggregateTaskbarProgress(progresses: readonly ProgressReport[]): TaskbarProgress {
  const error = progresses.find((progress) => progress.state === "error");
  if (error) return { value: fraction(error.value, 1), mode: "error" };
  const warning = progresses.find((progress) => progress.state === "warning");
  if (warning) return { value: fraction(warning.value, 1), mode: "paused" };
  const values = progresses.filter((progress) => progress.state === "normal").map((progress) => progress.value ?? 0);
  if (values.length > 0) return { value: Math.min(...values) / 100, mode: "normal" };
  if (progresses.length > 0) return { value: 2, mode: "indeterminate" };
  return { value: -1, mode: "none" };
}

function fraction(value: number | null, fallback: number): number {
  return value === null ? fallback : value / 100;
}
