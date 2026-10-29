import type { CliSettingsDefinition, JsonValue, SettingIntent } from "@shared/cli-settings-types";
import { RequestError } from "../../ipc-validation.js";
import path from "node:path";
export function containsPcPath(value: unknown): boolean {
  if (typeof value === "string") return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
  return Boolean(value && typeof value === "object" && Object.values(value).some(containsPcPath));
}
export const CLI_SETTINGS_FILE = "home/cli-settings.v1.json";
export const CLI_SETTINGS_LOCAL = "cli-settings.local.json";
export const emptySettings = (): CliSettingsDefinition => ({ schemaVersion: 1, settings: [], extensions: [] });
export function mergeCliSettings(base: CliSettingsDefinition, local: CliSettingsDefinition): CliSettingsDefinition {
  if (!local.settings.length && !local.extensions.length) return base;
  return parseCliSettings(JSON.stringify({ schemaVersion: 1, settings: [...base.settings.filter(s => !local.settings.some(l => s.provider === l.provider && JSON.stringify(s.path) === JSON.stringify(l.path))), ...local.settings], extensions: [...base.extensions.filter(e => !local.extensions.some(l => l.provider === e.provider && l.id === e.id)), ...local.extensions] }));
}
export function parseCliSettings(text: string | null): CliSettingsDefinition {
  if (text === null) return emptySettings();
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new RequestError(422, "설정 정의는 2 MiB 이하여야 합니다");
  const v = JSON.parse(text);
  const check = (value: unknown, depth = 0) => {
    if (depth > 32) throw new RequestError(422, "설정 중첩이 너무 깊습니다");
    if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new RequestError(422, "허용하지 않는 설정 키입니다");
      check(child, depth + 1);
    }
  };
  check(v);
  if (!v || v.schemaVersion !== 1 || !Array.isArray(v.settings) || !Array.isArray(v.extensions) || Object.keys(v).some(k => !["schemaVersion", "settings", "extensions"].includes(k))) throw new RequestError(422, "지원하지 않는 CLI 설정 정의입니다");
  for (const item of v.settings) {
    if (!item || !["claude", "codex"].includes(item.provider) || !Array.isArray(item.path) || !item.path.length || item.path.length > 16 || item.path.some((key: unknown) => typeof key !== "string" || !key.length || key.length > 250 || ["__proto__", "constructor", "prototype"].includes(key)) || !["set", "remove"].includes(item.operation) || (item.operation === "set" && !Object.hasOwn(item, "value")) || Object.keys(item).some(k => !["provider", "path", "operation", "value"].includes(k))) throw new RequestError(422, "잘못된 설정 변경입니다");
  }
  const ids = v.settings.map((s: SettingIntent) => JSON.stringify([s.provider, s.path]));
  if (new Set(ids).size !== ids.length) throw new RequestError(422, "설정 경로가 중복됩니다");
  for (const item of v.settings) if (v.settings.some((other: SettingIntent) => other !== item && other.provider === item.provider && other.path.length < item.path.length && other.path.every((key, i) => item.path[i] === key))) throw new RequestError(422, "상위 설정과 하위 설정을 동시에 관리할 수 없습니다");
  for (const item of v.extensions) if (!item || !["claude", "codex"].includes(item.provider) || typeof item.id !== "string" || !/^[\w.-]+@[\w.-]+$/.test(item.id) || typeof item.enabled !== "boolean" || Object.keys(item).some(k => !["provider", "id", "enabled"].includes(k))) throw new RequestError(422, "잘못된 확장 설정입니다");
  if (new Set(v.extensions.map((e: { provider: string; id: string }) => `${e.provider}:${e.id}`)).size !== v.extensions.length) throw new RequestError(422, "확장이 중복됩니다");
  return v;
}
export function getValue(object: unknown, keys: string[]): JsonValue | undefined {
  let current: any = object;
  for (const key of keys) { if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) return undefined; current = current[key]; }
  return current;
}
export function setValue(object: Record<string, any>, item: SettingIntent) {
  let parent = object;
  for (const key of item.path.slice(0, -1)) { if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) { if (item.operation === "remove") return; parent[key] = {}; } parent = parent[key]; }
  const key = item.path.at(-1)!;
  if (item.operation === "remove") delete parent[key]; else parent[key] = structuredClone(item.value);
}
