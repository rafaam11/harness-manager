export interface PcStatusItem {
  id: string; provider: "claude" | "codex"; kind: string; name: string;
  version?: string; recognition: "confirmed" | "unverified"; enabled: boolean | null;
  managed: boolean; stale: boolean; checkedAt?: string;
  source?: { pluginId: string };
  origin?: "shared-user" | "cli-user" | "system" | "plugin"; contentDigest?: string;
}
export interface PcStatusReport {
  format: "harness-manager-pc-status"; version: 1; pcId: string; alias: string; reportedAt: string;
  cliVersions: Partial<Record<"claude" | "codex", string>>; items: PcStatusItem[];
}
export interface PcStatusPreview { token: string; report: PcStatusReport }
