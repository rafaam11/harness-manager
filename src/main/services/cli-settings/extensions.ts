import hud from "../../../../mods/jinmin-hud/.claude-plugin/plugin.json";
import chips from "../../../../mods/mcw-chips/.claude-plugin/plugin.json";
import type { SettingDescriptor, SettingIntent } from "@shared/cli-settings-types";
import { settingId } from "./catalog.js";
import { profileFile, readProfileFile } from "../profile-document.js";
import type { DoctorContext } from "../doctor/doctor.js";
import path from "node:path";
export const KNOWN_EXTENSIONS = [
  { id: "jinmin-hud@jinmin", provider: "claude" as const, title: "입력창 상황판", description: "모델·사용량·Git 상태를 입력창에 표시", options: hud.userConfig, counterpart: "Codex는 jinmin-codex의 상태 조회로 대체" },
  { id: "guard@jinmin", provider: "claude" as const, title: "위험 명령 가드", description: "위험 명령의 영향을 보여 주고 확인", options: {}, counterpart: "Codex는 jinmin-codex의 선택형 차단 가드" },
  { id: "codex-watch@jinmin", provider: "claude" as const, title: "Codex 작업 알림", description: "Claude에서 실행한 Codex 작업 관측·종료 알림", options: {}, counterpart: "Codex는 외부 CLI 관측으로 대체" },
  { id: "mcw-companion@jinmin", provider: "claude" as const, title: "MCW 세션 연결", description: "MCW 세션 정보와 알림", options: {}, counterpart: "Codex 세션 연결은 MCW에서 관리" },
  { id: "mcw-chips@jinmin", provider: "claude" as const, title: "MCW 작업 칩", description: "작업·컨텍스트·에이전트 칩 표시", options: chips.userConfig, counterpart: "Codex 칩은 MCW에서 관리" },
  { id: "jinmin-codex@jinmin", provider: "codex" as const, title: "Codex 상태·가드 확장", description: "상태 조회와 외부 CLI 관측. 가드는 HM_CODEX_GUARD=block인 세션에서만 켜짐", options: {}, counterpart: "Claude mod 일부를 대체 · 입력창 HUD는 제공하지 않음" },
];
export function optionDescriptors(id: string, options: Record<string, any>): SettingDescriptor[] {
  return Object.entries(options).filter(([, option]) => option && typeof option === "object").map(([key, option]) => {
    const path = ["pluginConfigs", id, "options", key];
    const bounds: Record<string, Record<string, number>> = { maxRows: { minimum: 1, maximum: 10 }, promptCacheTtlSeconds: { minimum: 0, maximum: 3600 }, sevenDayThreshold: { minimum: 0, maximum: 100 }, ctxStep: { minimum: 1, maximum: 100 }, debounceMs: { minimum: 0 }, bgTickSeconds: { minimum: 1 }, doneLingerSeconds: { minimum: 0 } };
    const type = option.type === "string[]" ? "array" : option.type;
    return { id: settingId("claude", path), provider: "claude" as const, path, title: option.title ?? key, category: "확장 옵션", description: option.description ?? "", type, schema: { type, ...(type === "array" ? { items: { type: "string" } } : {}), ...(option.options ? { enum: option.options } : {}), ...bounds[key] }, defaultDescription: JSON.stringify(option.default ?? (type === "array" ? [] : type === "boolean" ? false : type === "number" ? 0 : "")), source: "플러그인 userConfig", managed: false, readonly: option.sensitive || /api.?key|token|password|secret/i.test(key) ? "민감 옵션은 Claude에서 설정하세요" : !["string", "number", "boolean", "array"].includes(type) ? "지원하지 않는 옵션 형식" : undefined };
  });
}
export function extensionOption(item: SettingIntent) {
  if (item.provider !== "claude" || item.path[0] !== "pluginConfigs" || item.path[2] !== "options" || item.path.length !== 4) return undefined;
  const extension = KNOWN_EXTENSIONS.find(e => e.id === item.path[1]);
  return extension ? optionDescriptors(extension.id, extension.options).find(d => d.path[3] === item.path[3]) : undefined;
}
export async function installedOptions(ctx: Pick<DoctorContext, "claudeHome">): Promise<SettingDescriptor[]> {
  const raw = await readProfileFile(ctx.claudeHome, "plugins/installed_plugins.json");
  const installed = raw ? JSON.parse(raw).plugins ?? {} : {};
  const result: SettingDescriptor[] = [];
  for (const [id, entries] of Object.entries(installed)) {
    if (!/^[\w.-]+@[\w.-]+$/.test(id)) continue;
    for (const entry of entries as { installPath?: string }[]) {
      if (!entry.installPath) continue;
      const relative = path.relative(ctx.claudeHome, path.join(entry.installPath, ".claude-plugin", "plugin.json")).split(path.sep).join("/");
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      await profileFile(ctx.claudeHome, relative);
      const text = await readProfileFile(ctx.claudeHome, relative);
      if (text) { const manifest = JSON.parse(text); if (manifest.userConfig && typeof manifest.userConfig === "object") result.push(...optionDescriptors(id, manifest.userConfig)); }
      break;
    }
  }
  return result;
}
