import { randomUUID } from "node:crypto";
import type { RepairApproval } from "@shared/repair-types";
import { RequestError } from "../../ipc-validation.js";

/** 렌더러는 승인 id와 결정만 보낸다. 실제 명령·수정 내용은 대기 중인 요청에 묶여 있다. */
export class RepairApprovals {
  private pending = new Map<string, { approval: RepairApproval; resolve(allow: boolean): void }>();
  constructor(private changed: () => void) {}
  list(): RepairApproval[] { return [...this.pending.values()].map((entry) => entry.approval); }

  ask(title: string, detail: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    // 내용을 전부 보여 줄 수 없는 요청을 잘라서 승인시키지 않는다.
    if (detail.length > 64_000 || this.pending.size >= 8) return Promise.resolve(false);
    const id = randomUUID();
    return new Promise((resolve) => {
      const finish = (allow: boolean) => {
        signal.removeEventListener("abort", abort);
        this.pending.delete(id);
        this.changed();
        resolve(allow);
      };
      const abort = () => finish(false);
      this.pending.set(id, { approval: { id, title, detail }, resolve: finish });
      signal.addEventListener("abort", abort, { once: true });
      this.changed();
      if (signal.aborted) abort();
    });
  }

  answer(id: string, allow: boolean): void {
    const request = this.pending.get(id);
    if (!request) throw new RequestError(409, "이미 끝났거나 취소된 승인 요청입니다");
    request.resolve(allow);
  }

  clear(): void { for (const entry of [...this.pending.values()]) entry.resolve(false); }
}
