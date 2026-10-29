import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { hookDiagnostics, compareProject } from "./diagnostics.js";
import type { ProviderAdapter } from "../../providers/types.js";
let root: string; let providers: ProviderAdapter[];
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-diagnostics-")); providers = ["claude", "codex"].map(id => ({ id: id as "claude" | "codex", label: id, roots: { home: path.join(root, id), configFiles: [] }, detectRunning: async () => false, listCatalog: async () => [], readMcpServers: async () => [] })); for (const p of providers) await fs.mkdir(p.roots.home); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
it("reports duplicate hooks, timeouts and MCW ownership without rewriting its profile", async () => {
  vi.stubEnv("HM_TEST_TOKEN", "super-secret-token");
  const hook = { matcher: "Bash", hooks: [{ command: "echo super-secret-token", timeout: 60 }] };
  await fs.writeFile(path.join(root, "claude/settings.json"), JSON.stringify({ hooks: { PreToolUse: [hook, hook] } }));
  const file = path.join(root, "codex/multi-cli-work.config.toml"), text = '[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ncommand="node stop.cjs"\ntimeout=5\n'; await fs.writeFile(file, text);
  const result = await hookDiagnostics(providers);
  expect(result[0]?.command).not.toContain("super-secret-token"); expect(result[0]?.issues.join(" ")).toContain("중복");
  expect(result.find(r => r.provider === "codex")?.issues.join(" ")).toContain("읽기 전용"); expect(await fs.readFile(file, "utf8")).toBe(text);
});
it("compares global/project instructions and detects same-name skills without changing files", async () => {
  const project = path.join(root, "project"); await fs.mkdir(path.join(project, ".claude/skills/review"), { recursive: true });
  await fs.mkdir(path.join(root, "claude/skills/review"), { recursive: true });
  await fs.writeFile(path.join(project, "CLAUDE.md"), "project rules"); await fs.writeFile(path.join(root, "claude/CLAUDE.md"), "global rules");
  await fs.writeFile(path.join(project, ".claude/skills/review/SKILL.md"), "project skill"); await fs.writeFile(path.join(root, "claude/skills/review/SKILL.md"), "global skill");
  const result = await compareProject(project, providers); expect(result.entries.find(e => e.file.endsWith("review/SKILL.md"))?.detail).toContain("범위 충돌");
  expect(await fs.readFile(path.join(project, "CLAUDE.md"), "utf8")).toBe("project rules");
});
it("inspects installed SDK hook definitions without executing modules", async () => {
  const installPath = path.join(root, "claude/plugins/cache/guard"); await fs.mkdir(path.join(installPath, "hooks"), { recursive: true });
  await fs.writeFile(path.join(installPath, "hooks/hooks.json"), JSON.stringify({ modules: ["./register.ts"] }));
  const result = await hookDiagnostics(providers, [{ id: "guard@jinmin", provider: "claude", blocked: false, enabledInSettings: true, installs: [{ scope: "user", version: "1", installedAt: "", installPath }] }]);
  expect(result.find(r => r.event === "SDK 모듈")?.issues.join(" ")).toContain("미검증");
});
