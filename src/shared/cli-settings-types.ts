import type { ProviderId } from "./provider-types";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface SettingIntent { provider: ProviderId; path: string[]; operation: "set" | "remove"; value?: JsonValue }
export interface ExtensionIntent { provider: ProviderId; id: string; enabled: boolean }
export interface CliSettingsDefinition { schemaVersion: 1; settings: SettingIntent[]; extensions: ExtensionIntent[] }
export interface SettingDescriptor {
  id: string; provider: ProviderId; path: string[]; title: string; category: string; description: string;
  type: string; schema: Record<string, unknown>; defaultDescription: string; source: string; minimumVersion?: string; storage?: "user" | "global" | "managed";
  readonly?: string; current?: JsonValue; desired?: SettingIntent; managed: boolean;
}
export interface SettingsSnapshot { provider: ProviderId; version: string | null; schemaDate: string; settings: SettingDescriptor[]; warnings: string[] }
export interface ExtensionDescriptor {
  id: string; provider: ProviderId; title: string; description: string; installed: boolean; enabled: boolean | null;
  version?: string; managed: boolean; desired?: boolean; readonly?: string; detail: string; counterpart?: string;
  options: SettingDescriptor[];
}
export interface SettingsEdit { provider: ProviderId; id: string; operation: "set" | "remove" | "release"; value?: JsonValue }
export interface ExtensionEdit { provider: ProviderId; id: string; enabled: boolean }
