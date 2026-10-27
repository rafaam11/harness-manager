import { useState } from "react";
import type { ProviderFilter, ProviderId } from "@shared/provider-types";

export const DEFAULT_PROVIDER_FILTER: ProviderFilter = "all";

export interface ProviderFilterOption {
  value: ProviderFilter;
  label: string;
  fullLabel: string;
}

export const PROVIDER_FILTER_OPTIONS: ProviderFilterOption[] = [
  { value: "all", label: "전체", fullLabel: "모든 provider" },
  { value: "claude", label: "Claude", fullLabel: "Claude Code" },
  { value: "codex", label: "Codex", fullLabel: "Codex" },
];

export function providerToneClass(provider: ProviderFilter | ProviderId): string {
  return provider === "all" ? "provider-all" : `provider-${provider}`;
}

export function providerGroupLabel(provider: ProviderId): string {
  return provider === "claude" ? "Claude Code" : "Codex";
}

export function groupRowsByProvider<T extends { provider?: ProviderId }>(
  rows: T[],
): { provider: ProviderId; rows: T[] }[] {
  const order: ProviderId[] = ["claude", "codex"];
  return order
    .map((provider) => ({ provider, rows: rows.filter((row) => row.provider === provider) }))
    .filter((group) => group.rows.length > 0);
}

export function providerLabel(provider: ProviderId): string {
  return provider === "claude" ? "Claude" : "Codex";
}

export function providerBadgeClass(provider: ProviderId): string {
  return `provider-${provider}`;
}

/**
 * 화면마다 따로 기억하는 provider 필터(M13에서 사이드바 전역 필터를 없앴다). 저장소가 막혀 있어도 기본값으로 돈다.
 */
export function useStoredProviderFilter(storageKey: string): [ProviderFilter, (next: ProviderFilter) => void] {
  const [value, setValue] = useState<ProviderFilter>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === "claude" || stored === "codex" || stored === "all" ? stored : DEFAULT_PROVIDER_FILTER;
    } catch {
      return DEFAULT_PROVIDER_FILTER;
    }
  });
  const update = (next: ProviderFilter) => {
    setValue(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // 기억하지 못해도 화면은 동작한다.
    }
  };
  return [value, update];
}
