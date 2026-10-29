import path from "node:path";
import type { DoctorContext } from "../doctor/doctor.js";
import type { CliSettingsDefinition, SettingDescriptor } from "@shared/cli-settings-types";
import type { ProviderId } from "@shared/provider-types";
import { profileFile, readProfileFile } from "../profile-document.js";
import { readText, type FileChange } from "../workbench/history.js";
import { CLI_SETTINGS_FILE, CLI_SETTINGS_LOCAL, parseCliSettings, mergeCliSettings, setValue } from "./definition.js";
import { settingCatalog, settingId, validateValue, readonlyReason } from "./catalog.js";
import { patchTomlValues } from "./toml.js";
import { extensionOption, installedOptions } from "./extensions.js";

export async function cliDefinition(ctx: Pick<DoctorContext, "templateRoot" | "repoRoot"> & { profileDir?: string }) {
  const root = ctx.templateRoot ?? ctx.repoRoot;
  return mergeCliSettings(parseCliSettings(root ? await readProfileFile(root, CLI_SETTINGS_FILE) : null), parseCliSettings(ctx.profileDir ? await readProfileFile(ctx.profileDir, CLI_SETTINGS_LOCAL) : null));
}
export function validateSettings(definition: CliSettingsDefinition, extra: SettingDescriptor[] = []) {
  for (const item of definition.settings) {
    const descriptor = [...settingCatalog(item.provider), ...extra].find(d => d.id === settingId(item.provider, item.path)) ?? extensionOption(item);
    if (!descriptor || descriptor.readonly || descriptor.type === "unknown") throw new Error(`${item.path.join(".")}: ${descriptor?.readonly ?? "지원 여부를 확인하지 못한 설정입니다"}`);
    if (item.operation === "set") {
      validateValue(descriptor, item.value!);
      const inspect = (value: unknown, keys: string[]) => {
        if (readonlyReason(item.provider, keys)?.includes("민감")) throw new Error(`${keys.join(".")}: 인증 정보는 CLI에서 관리하세요`);
        if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) inspect(child, [...keys, key]);
      };
      inspect(item.value, item.path);
    }
  }
}
export function applyProviderSettings(provider: ProviderId, text: string | null, definition: CliSettingsDefinition) {
  const present = provider === "claude" ? JSON.parse(text ?? "{}") : undefined;
  const items = [...definition.settings.filter(item => item.provider === provider), ...definition.extensions.filter(e => e.provider === provider && (e.enabled || provider === "claude" && present?.enabledPlugins?.[e.id] !== undefined || provider === "codex" && (text ?? "").includes(e.id))).map(e => ({ provider, path: provider === "claude" ? ["enabledPlugins", e.id] : ["plugins", e.id, "enabled"], operation: "set" as const, value: e.enabled }))];
  if (!items.length) return text;
  if (provider === "codex") return patchTomlValues(text ?? "", items);
  const current = JSON.parse(text ?? "{}"), next = structuredClone(current);
  for (const item of items) setValue(next, item);
  return JSON.stringify(current) === JSON.stringify(next) ? text : JSON.stringify(next, null, 2) + "\n";
}
export async function projectCliSettings(ctx: Pick<DoctorContext, "templateRoot" | "repoRoot" | "claudeHome" | "codexHome"> & { profileDir?: string }, input?: CliSettingsDefinition, base: FileChange[] = []) {
  const definition = input ?? await cliDefinition(ctx);
  if (!definition.settings.length && !definition.extensions.length) return { definition, files: [] as FileChange[] };
  validateSettings(definition, await installedOptions(ctx));
  const files: FileChange[] = [];
  for (const provider of ["claude", "codex"] as const) {
    const root = provider === "claude" ? ctx.claudeHome : ctx.codexHome;
    const target = await profileFile(root, provider === "claude" ? "settings.json" : "config.toml");
    const existing = base.find(file => file.path === target);
    const before = existing?.before ?? await readText(target);
    const after = applyProviderSettings(provider, existing ? existing.after : before, definition);
    if (after !== before) files.push({ path: target, before, after });
  }
  return { definition, files };
}
