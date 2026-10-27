import type { InstallStepResult } from "./install-types";
import type { ProviderId } from "./provider-types";

export interface RepairProvider {
  id: ProviderId;
  available: boolean;
  detail: string;
}

export interface RepairApproval {
  id: string;
  title: string;
  detail: string;
}

export interface RepairLine {
  id: number;
  stream: "stdout" | "stderr" | "info";
  text: string;
}

export interface RepairSnapshot {
  running: boolean;
  provider: ProviderId | null;
  stepId: string | null;
  round: number;
  phase: "idle" | "agent" | "approval" | "verify" | "done" | "failed" | "cancelled";
  detail: string;
  approvals: RepairApproval[];
  lines: RepairLine[];
  result?: InstallStepResult;
  logFile?: string;
}

export type RepairEvent = { type: "state"; state: RepairSnapshot } | { type: "log"; line: RepairLine };
