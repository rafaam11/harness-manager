import type { InstallStepResult } from "./install-types";
import type { ProviderId } from "./provider-types";

export interface RepairProvider {
  id: ProviderId;
  available: boolean;
  detail: string;
}

export interface RepairLine {
  id: number;
  stream: "stdout" | "stderr" | "info";
  text: string;
}

export interface RepairSnapshot {
  jobId: string;
  running: boolean;
  provider: ProviderId | null;
  stepId: string | null;
  round: number;
  phase: "idle" | "queued" | "preparing" | "agent" | "verify" | "publishing" | "done" | "failed" | "cancelled";
  detail: string;
  lines: RepairLine[];
  result?: InstallStepResult;
  logFile?: string;
  source?: { state: "unchanged" | "published" | "failed"; detail: string; workspace: string; commit?: string; url?: string };
}

export interface RepairBatchSnapshot { jobs: RepairSnapshot[]; maxParallel: number }
export type RepairEvent = { type: "reset" } | { type: "state"; state: RepairSnapshot } | { type: "log"; jobId: string; line: RepairLine };
