import { randomUUID } from "node:crypto";
import type { InstallEvent } from "@shared/install-types";
import type { ProviderId } from "@shared/provider-types";
import type { RepairBatchSnapshot, RepairEvent, RepairSnapshot } from "@shared/repair-types";
import { RequestError } from "../../ipc-validation.js";
import type { InstallContext } from "../install/engine.js";
import type { InstallSession } from "../install/session.js";
import { redactInstallText } from "../install/journal.js";
import { RepairSession, initialRepair, type PrepareRepairSource, type RepairHistory } from "./session.js";
import type { AgentRunner } from "./agent.js";

// 동일 provider의 플러그인·MCP는 같은 설정을 쓴다. 런타임 변경은 모든 복구와 충돌한다.
export function repairResources(id: string): string[] {
  if (/^(packages\.|tools\.)/.test(id)) return ["*"];
  if (/^(plugins\.|mcp\.|skills\.)/.test(id)) return ["claude", "codex"];
  if (id.includes("claude")) return ["claude"];
  if (id.includes("codex")) return ["codex"];
  if (id.startsWith("dotfiles.")) return [id];
  return ["claude", "codex"];
}

interface Ticket { id: string; resources: string[]; begin(): void }

/** 대기 중 작업도 InstallSession에 등록해서 앱 종료가 모든 자식 종료를 기다리게 한다. */
export class RepairCoordinator {
  private jobs = new Map<string, RepairSnapshot>();
  private history: RepairHistory = new Map();
  private recorder = new RepairSession("history", this.history);
  private queue: Ticket[] = [];
  private active = new Map<string, string[]>();
  private sessions = new Map<string, RepairSession>();
  private retrying: string | null = null;
  readonly maxParallel = 3;
  constructor(private tasks: InstallSession, private emit: (event: RepairEvent) => void,
    private stateDir: string, private prepareSource?: PrepareRepairSource, private agent?: AgentRunner) {}

  remember(event: InstallEvent): void {
    this.recorder.remember(event);
    if (event.type === "run-start") this.event({ type: "reset" });
  }
  reset(): void { this.history.clear(); this.sessions.clear(); this.event({ type: "reset" }); }
  async retrySource(id: string): Promise<RepairSnapshot> {
    const session = this.sessions.get(id);
    if (!session) throw new RequestError(404, "복구 작업 사본이 없습니다");
    return this.tasks.run(async (signal) => { this.retrying = id; try { return await session.retrySource(signal, this.event); } finally { this.retrying = null; } });
  }
  snapshot(): RepairBatchSnapshot { return { maxParallel: this.maxParallel, jobs: [...this.jobs.values()].map((job) => ({ ...job, lines: [...job.lines] })) }; }
  cancel(id: string): void {
    if (!this.jobs.has(id)) throw new RequestError(404, "복구 작업을 찾지 못했습니다");
    if (this.retrying === id) { this.tasks.cancel(); return; }
    this.tasks.cancelRepair(id);
  }
  private event = (event: RepairEvent) => {
    if (event.type === "reset") { this.jobs.clear(); this.sessions.clear(); }
    else if (event.type === "state") this.jobs.set(event.state.jobId, event.state);
    else {
      const job = this.jobs.get(event.jobId);
      if (job) this.jobs.set(event.jobId, { ...job, lines: [...job.lines.slice(-1_999), event.line] });
    }
    this.emit(event);
  };

  enqueue(context: () => Promise<InstallContext>, stepId: string, provider: ProviderId): RepairSnapshot {
    if ([...this.jobs.values()].some((job) => job.running && job.stepId === stepId)) throw new RequestError(409, "이미 이 항목을 복구하고 있습니다");
    if ([...this.jobs.values()].filter((job) => job.running).length >= 30) throw new RequestError(409, "복구 대기열이 가득 찼습니다");
    const jobId = randomUUID();
    const state: RepairSnapshot = { ...initialRepair(jobId), running: true, provider, stepId, phase: "queued", detail: "실행 순서를 기다립니다" };
    this.event({ type: "state", state });
    // 완료 이력의 메모리 사용량을 제한하되 실행 중인 작업은 유지한다.
    for (const [id, job] of this.jobs) if (this.jobs.size > 30 && !job.running) this.jobs.delete(id);
    void this.tasks.runRepair(jobId, async (signal) => {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          this.queue = this.queue.filter((ticket) => ticket.id !== jobId);
          signal.removeEventListener("abort", abort);
          reject(new Error("복구를 취소했습니다"));
          this.drain();
        };
        if (signal.aborted) { abort(); return; }
        signal.addEventListener("abort", abort, { once: true });
        this.queue.push({ id: jobId, resources: repairResources(stepId), begin: () => { signal.removeEventListener("abort", abort); resolve(); } });
        this.drain();
      });
      try {
        if (signal.aborted) throw new Error("복구를 취소했습니다");
        const ctx = await context();
        if (signal.aborted) throw new Error("복구를 취소했습니다");
        const session = new RepairSession(jobId, this.history); this.sessions.set(jobId, session);
        await session.run(ctx, stepId, provider, signal, this.event, () => undefined, this.stateDir, this.agent, ctx.contribution && ctx.contribution !== "none" ? this.prepareSource : undefined);
      } finally { this.active.delete(jobId); this.drain(); }
    }).catch((error: Error) => {
      const previous = this.jobs.get(jobId)!;
      this.event({ type: "state", state: { ...previous, running: false, phase: /취소/.test(error.message) ? "cancelled" : "failed", detail: redactInstallText(error.message, process.env) } });
    });
    return state;
  }
  private drain(): void {
    const reserved: string[] = [];
    for (const ticket of [...this.queue]) {
      const busy = [...this.active.values()].flat().concat(reserved);
      const conflict = busy.length > 0 && (ticket.resources.includes("*") || busy.includes("*") || ticket.resources.some((key) => busy.includes(key)));
      if (this.active.size >= this.maxParallel || conflict) { reserved.push(...ticket.resources); continue; }
      this.queue = this.queue.filter((entry) => entry !== ticket);
      this.active.set(ticket.id, ticket.resources);
      ticket.begin();
    }
  }
}
