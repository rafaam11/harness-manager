import type { InstallEvent } from "@shared/install-types";
import type { ProgressReport } from "../../window-progress.js";

export class InstallBusyError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("이미 설치가 진행 중입니다");
  }
}

/**
 * 앱 안에서 도는 install 실행 하나. 두 실행이 같은 설정 파일을 동시에 고치지 않게 하나만 허용하고,
 * 종료 관문(QuitCoordinator)이 "도는 중인가"를 묻고 취소한 뒤 끝나기를 기다릴 수 있게 한다.
 */
export class InstallSession {
  private controller: AbortController | null = null;
  private backgroundController: AbortController | null = null;
  private finished: Promise<unknown> = Promise.resolve();
  private repairs = new Map<string, { controller: AbortController; finished: Promise<unknown> }>();

  get running(): boolean {
    return this.controller !== null || this.repairs.size > 0;
  }

  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.execute(work, false);
  }
  async runAutomatic<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (this.running) return undefined;
    return this.execute(work, true);
  }
  private async execute<T>(work: (signal: AbortSignal) => Promise<T>, automatic: boolean): Promise<T> {
    // 사용자가 고른 작업은 백그라운드 확인이 정리된 뒤 실행한다. 일반 설치끼리는 계속 409다.
    if (!automatic && this.backgroundController) { this.backgroundController.abort(); await this.finished; }
    if (this.running) throw new InstallBusyError();
    const controller = new AbortController();
    this.controller = controller;
    if (automatic) this.backgroundController = controller;
    const pending = (async () => work(controller.signal))();
    this.finished = pending.catch(() => undefined);
    try {
      return await pending;
    } finally {
      this.controller = null;
      if (this.backgroundController === controller) this.backgroundController = null;
    }
  }

  /** 복구끼리의 동시 실행·자원 충돌은 coordinator가 관리하고 일반 설치와는 서로 배제한다. */
  async runRepair<T>(id: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.backgroundController) { this.backgroundController.abort(); await this.finished; }
    if (this.controller || this.repairs.has(id)) throw new InstallBusyError();
    const controller = new AbortController();
    const pending = Promise.resolve().then(() => work(controller.signal));
    this.repairs.set(id, { controller, finished: pending.catch(() => undefined) });
    try { return await pending; }
    finally { this.repairs.delete(id); }
  }

  cancelRepair(id: string): void { this.repairs.get(id)?.controller.abort(); }

  cancel(): void {
    this.controller?.abort();
    for (const repair of this.repairs.values()) repair.controller.abort();
  }

  /** 취소하고 지금 도는 명령이 정리될 때까지 기다린다(앱 종료 전). */
  async cancelAndWait(): Promise<void> {
    this.cancel();
    await Promise.all([this.finished, ...[...this.repairs.values()].map((repair) => repair.finished)]);
  }
}

/**
 * install 이벤트를 작업표시줄 진행 막대 한 칸으로 바꾼다. 실패한 step이 있으면 빨강으로 남긴다.
 * undefined는 "바꿀 것 없음", "clear"는 막대를 치운다.
 */
export function installProgress(): (event: InstallEvent) => ProgressReport | "clear" | undefined {
  let total = 0;
  let done = 0;
  let failed = false;
  return (event) => {
    if (event.type === "run-done") return "clear";
    if (event.type === "run-start") {
      total = event.total;
      done = 0;
      failed = false;
    } else if (event.type === "step-done") {
      done += 1;
      if (event.result.outcome === "failed") failed = true;
    } else {
      return undefined;
    }
    return { state: failed ? "error" : "normal", value: total === 0 ? 100 : Math.round((done / total) * 100) };
  };
}
