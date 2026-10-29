import path from "node:path";
import fs from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import type { HookDiagnostic, ProjectComparison } from "@shared/workbench-types";
import type { PluginInfo } from "@shared/api-types";
import type { ProviderAdapter } from "../../providers/types.js";
import { readProfileFile } from "../profile-document.js";
import { redactInstallText } from "../install/journal.js";
export async function hookDiagnostics(providers: ProviderAdapter[], plugins: PluginInfo[] = []): Promise<HookDiagnostic[]> {
  const result: HookDiagnostic[] = [];
  for (const provider of providers) {
    const names = provider.id === "claude" ? ["settings.json"] : ["config.toml", "hooks.json", "multi-cli-work.config.toml"];
    for (const plugin of plugins.filter(p => p.provider === provider.id)) for (const install of plugin.installs) {
      if (!install.installPath) continue;
      const relative = path.relative(provider.roots.home, install.installPath).split(path.sep).join("/");
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) { result.push({ provider: provider.id, event: "외부 플러그인", matcher: "", command: "", source: plugin.id, issues: ["CLI 홈 밖의 플러그인은 이 검사에서 읽지 않습니다 · 실행 미검증"] }); continue; }
      names.push(`${relative}/hooks/${provider.id === "claude" ? "hooks.json" : "codex.json"}`);
    }
    for (const name of names) {
    try {
      const text = await readProfileFile(provider.roots.home, name); if (!text) continue;
      const data = (name.endsWith("toml") ? parseToml(text) : JSON.parse(text)) as Record<string, unknown>;
      if (Array.isArray(data.modules)) { result.push({ provider: provider.id, event: "SDK 모듈", matcher: "모듈에서 결정", command: "모듈을 실행하지 않고 정의 파일만 확인함", source: name, issues: ["동적 이벤트 등록 · 실행 순서·신뢰·실행 결과 미검증"] }); continue; }
      if (!data.hooks || typeof data.hooks !== "object") continue;
      for (const [event, raw] of Object.entries(data.hooks)) {
        if (!Array.isArray(raw)) continue;
        for (const group of raw) {
          if (!group || typeof group !== "object") continue;
          for (const hook of Array.isArray(group.hooks) ? group.hooks : [group]) {
            if (!hook || typeof hook !== "object") continue;
            const timeout = typeof hook.timeout === "number" ? hook.timeout : undefined;
            const command = typeof hook.command === "string" ? hook.command : typeof hook.command_windows === "string" ? hook.command_windows : "명령이 아닌 hook";
            const issues: string[] = [];
            if (!timeout) issues.push("제한 시간 미지정");
            if (timeout && timeout > 30) issues.push("긴 제한 시간 · CLI 응답 지연 가능");
            if (name === "multi-cli-work.config.toml") issues.push("MCW 소유 · 읽기 전용");
            result.push({ provider: provider.id, event, matcher: typeof group.matcher === "string" ? group.matcher : "전체", command: redactInstallText(command, process.env), timeout, source: name, issues });
          }
        }
      }
    } catch (e) { result.push({ provider: provider.id, event: "검사 실패", matcher: "", command: "", source: name, issues: [(e as Error).message] }); }
  }
  }
  for (const row of result) if (result.filter(other => other.provider === row.provider && other.event === row.event && other.matcher === row.matcher && other.command === row.command).length > 1) row.issues.push("동일 이벤트·matcher·명령 중복");
  return result;
}
export async function compareProject(folder: string, providers: ProviderAdapter[]): Promise<ProjectComparison> {
  const entries: ProjectComparison["entries"] = [];
  for (const provider of providers) for (const [project, global] of provider.id === "claude" ? [["CLAUDE.md", "CLAUDE.md"], [".claude/settings.json", "settings.json"], [".mcp.json", "settings.json"]] : [["AGENTS.md", "AGENTS.md"], [".codex/config.toml", "config.toml"], [".codex/hooks.json", "hooks.json"]]) {
    const local = await readProfileFile(folder, project!); const shared = await readProfileFile(provider.roots.home, global!);
    entries.push({ provider: provider.id, file: project!, present: local !== null, detail: local === null ? "프로젝트 파일 없음 · 전역 설정 확인" : local === shared ? "전역과 동일한 파일" : "프로젝트 파일이 전역과 다릅니다 · CLI별 병합·우선순위 적용 (읽기 전용)" });
  }
  for (const provider of providers) {
    const relative = provider.id === "claude" ? ".claude/skills" : ".agents/skills";
    const skillFolder = await import("../profile-document.js").then(m => m.profileFile(folder, relative));
    for (const entry of (await fs.readdir(skillFolder, { withFileTypes: true }).catch(() => [])).slice(0, 100)) {
      if (!entry.isDirectory()) continue;
      const file = `${relative}/${entry.name}/SKILL.md`; const local = await readProfileFile(folder, file);
      if (local === null) continue;
      const global = await readProfileFile(provider.roots.home, `skills/${entry.name}/SKILL.md`);
      entries.push({ provider: provider.id, file, present: true, detail: global === null ? "프로젝트 전용 스킬 (읽기 전용)" : local === global ? "전역과 같은 스킬 중복" : "같은 이름의 전역 스킬과 내용이 다릅니다 · 범위 충돌 확인" });
    }
  }
  return { folder: path.resolve(folder), entries };
}
