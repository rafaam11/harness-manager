import type { ProviderId } from "./provider-types";
export type ComponentKind = "skill" | "instruction" | "agent" | "command" | "memory" | "mcp" | "plugin" | "mod" | "environment";
export type Compatibility = "native" | "partial" | "alternative" | "unsupported" | "unverified";
export interface ComponentSource { kind: "profile" | "github"; repository?: string; directory?: string; revision?: string }
export interface ComponentDefinition {
  id: string; name: string; description: string; kind: "skill" | "instruction";
  source: ComponentSource; targets: ProviderId[]; files: Record<string, string>;
}
export interface WorkbenchDefinition { schemaVersion: 2; automatic: boolean; components: ComponentDefinition[] }
export interface ComponentObservation {
  provider: ProviderId; installed: boolean | null; enabled: boolean | null;
  comparison?: "match" | "different" | "missing" | "outside" | "unknown";
  recognition: "confirmed" | "unverified"; execution: "confirmed" | "unverified";
  compatibility: Compatibility; detail: string; checkedAt: string; cwd?: string; version?: string;
}
export interface ManagedComponent {
  id: string; name: string; description: string; kind: ComponentKind; source: string;
  managed: boolean; observations: ComponentObservation[]; stepIds: string[];
  definitionId?: string; catalogPath?: string; issue?: string;
}
export interface WorkbenchSnapshot {
  profile: { id: string; name: string; kind: string }; migrated: boolean; automatic: boolean;
  components: ManagedComponent[]; warnings: string[]; checkedAt: string;
}
export interface ChangeFile { path: string; diff: string }
export interface WorkbenchPlan { token: string; title: string; files: ChangeFile[]; commands: string[]; notes: string[]; automatic: boolean; targets?: ProviderId[]; scope?: "settings-and-pc" | "pc" | "settings" | "diagnostic" }
export interface ChangeRecord {
  id: string; title: string; at: string; actor: "user" | "automatic"; profileId: string;
  status: "pending" | "done" | "failed" | "restored" | "recovery-needed";
  files: { path: string; beforeHash: string | null; afterHash: string | null }[]; detail: string;
  restorable: boolean;
}
export interface VersionLock { schemaVersion: 1; profileId: string; at: string; entries: { id: string; source: ComponentSource; digest: string; appliedHashes: Record<string, string> }[]; environment?: { id: string; version: string; pinned: false; detail: string }[] }
export interface UpdateCandidate { id: string; name: string; current?: string; available?: string; automatic: boolean; reason: string }
export interface AutomationStatus { running: boolean; checkedAt?: string; detail: string; pending: UpdateCandidate[] }
export interface HookDiagnostic { provider: ProviderId; event: string; matcher: string; command: string; timeout?: number; source: string; issues: string[] }
export interface ProjectComparison { folder: string; entries: { provider: ProviderId; file: string; present: boolean; detail: string }[] }
export const COMPONENT_LABELS: Record<ComponentKind, string> = { skill: "스킬", instruction: "지침", agent: "에이전트", command: "명령", memory: "메모리", mcp: "MCP", plugin: "플러그인", mod: "mod", environment: "환경" };
export const COMPATIBILITY_LABELS: Record<Compatibility, string> = { native: "동일 제공", partial: "부분 제공", alternative: "대체 방식", unsupported: "미지원", unverified: "미검증" };
