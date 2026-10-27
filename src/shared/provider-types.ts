export type ProviderId = "claude" | "codex";
export type ProviderFilter = ProviderId | "all";
export type EntityId = `${ProviderId}:${string}`;

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  running: boolean;
  roots: string[];
}

