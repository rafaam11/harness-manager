import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { PcStatusService, parsePcStatus } from "./pc-status.js";
import type { WorkbenchSnapshot } from "@shared/workbench-types";
const roots: string[] = [];
const snapshot: WorkbenchSnapshot = { profile: { id: "private-profile", name: "Private project", kind: "local" }, migrated: true, automatic: false, checkedAt: "2026-11-05T00:00:00Z", warnings: ["private-token"], components: [{ id: "private-absolute-path", name: "summary", description: "PRIVATE INSTRUCTIONS", kind: "skill", source: "C:/Users/private-name/plugin", catalogPath: "C:/Users/private-name/SKILL.md", managed: true, stepIds: [], observations: [{ provider: "codex", installed: true, enabled: true, recognition: "confirmed", execution: "unverified", compatibility: "native", detail: "secret prompt and logs", checkedAt: "2026-11-05T00:00:00Z", version: "codex-cli 0.166.0", identityPath: "C:/Users/private-name/SKILL.md", pluginId: "summary@market" }] }] };
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 3 }); });
async function service(value = snapshot) { const root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-pc-status-")); roots.push(root); return new PcStatusService(root, async () => value); }
it("shares only explicit metadata with random stable PC IDs and no automatic host alias", async () => {
  const store = await service(), identity = await store.identity();
  expect(await store.identity()).toEqual(identity); expect(identity.alias).toBe("내 PC");
  const preview = await store.preview("Workstation A"), raw = JSON.stringify(preview.report);
  for (const secret of ["private-name", "Private project", "private-profile", "PRIVATE INSTRUCTIONS", "secret prompt", "private-token", "C:/"]) expect(raw).not.toContain(secret);
  expect(preview.report.items[0]).toMatchObject({ source: { pluginId: "summary@market" }, version: "0.166.0" });
  await expect(store.preview("C:/private")).rejects.toMatchObject({ statusCode: 400 });
  await expect(store.reviewed("arbitrary")).rejects.toMatchObject({ statusCode: 409 });
});
it("excludes project scope and rejects remote extra fields and sensitive paths", async () => {
  const global = await (await service()).preview("A");
  for (const report of [{ ...global.report, prompt: "private" }, { ...global.report, items: [{ ...global.report.items[0], path: "private" }] }, { ...global.report, items: [{ ...global.report.items[0], name: "C:/Users/private" }] }]) expect(() => parsePcStatus(report)).toThrow();
  const project = { ...snapshot, recognition: [{ provider: "codex" as const, scope: { id: "project", kind: "project" as const, cwd: "private-project" }, version: "1.2.3", checkedAt: snapshot.checkedAt, status: "success" as const, detail: "", skills: [], fingerprint: "digest", stale: false }] };
  expect((await (await service(project)).preview("A")).report.items).toEqual([]);
});
it("includes global instructions and MCP status while excluding project MCP and all connection values", async () => {
  const value = structuredClone(snapshot), base = value.components[0]!;
  value.components.push({ ...base, id: "definition:policy", definitionId: "policy", name: "Private policy name", kind: "instruction", description: "private instructions", observations: [{ ...base.observations[0]!, pluginId: undefined }] });
  value.components.push({ ...base, id: "mcp:global", name: "github", kind: "mcp", description: "https://private-url token=secret", observations: [{ ...base.observations[0]!, pluginId: undefined, scopeKind: "global" }] });
  value.components.push({ ...base, id: "mcp:project", name: "private-project", kind: "mcp", observations: [{ ...base.observations[0]!, scopeKind: "project" }] });
  const report = (await (await service(value)).preview("A")).report;
  expect(report.items.map(item => item.name)).toEqual(["summary", "policy", "github"]);
  expect(JSON.stringify(report)).not.toMatch(/private-project|private-url|token=secret|private instructions|Private policy/);
});
