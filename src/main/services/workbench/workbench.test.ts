import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { WorkbenchService } from "./service.js";
import { ChangeHistory } from "./history.js";
import { planInstallWith, runInstallWith } from "../install/engine.js";
import { runDoctorWith } from "../doctor/doctor.js";
import { withLock } from "../../lib/lock.js";
import { parseDefinition, validateComponent, ordinaryFiles } from "./definition.js";
import { SetupProfileStore } from "../setup-profiles.js";
import { readDocument, bundleProfile, parseBundle } from "../profile-document.js";
import type { InstallContext } from "../install/engine.js";
import type { NodeRuntimeState } from "../node-runtime.js";
import type { ComponentDefinition } from "@shared/workbench-types";
let root: string; let service: WorkbenchService; let ctx: InstallContext; let store: SetupProfileStore;
let running: boolean;
const component = (extra: Partial<ComponentDefinition> = {}): ComponentDefinition => ({ id: "review", name: "Review", kind: "skill", description: "review code", targets: ["claude", "codex"], source: { kind: "profile" }, files: { "SKILL.md": "---\nname: review\ndescription: review code\n---\nReview changes.\n" }, ...extra });
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-workbench-")); store = new SetupProfileStore(path.join(root, "state"));
  await store.create("test", "default"); const p = await store.active(); running = false;
  ctx = { home: root, repoRoot: null, templateRoot: p.root, setupProfile: p, profileDir: p.localDir, profile: "full", claudeHome: path.join(root, "claude"), claudeJson: path.join(root, "claude.json"), codexHome: path.join(root, "codex"), agentsSkillsDir: path.join(root, "agents", "skills"), documentsDir: path.join(root, "Documents"), gitScope: { file: path.join(root, "gitconfig") }, env: {}, findExecutable: async () => null, readVersion: async () => null, inspectNodeRuntime: async () => ({ state: "fresh", detail: "fixture", candidates: [], registrations: [], versions: [] } as unknown as NodeRuntimeState), refreshEnvironment: async () => false, now: () => new Date(), selfSource: "github", runner: { run: async () => { throw new Error("unexpected command"); } } };
  service = new WorkbenchService({ stateDir: path.join(root, "state"), context: async () => ctx, plugins: async () => ({ plugins: [], blocklist: [] }), providers: ["claude", "codex"].map(id => ({ id: id as "claude" | "codex", label: id, roots: { home: id === "claude" ? ctx.claudeHome : ctx.codexHome, configFiles: [] }, detectRunning: async () => running, listCatalog: async () => [], readMcpServers: async () => [] })) });
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
async function save(value = component()) { await service.apply((await service.save(value)).token); }
async function migrate() { await service.apply((await service.migrate(true)).token); }
it("merges CLI-only plugin skills by path, retains last success and invalidates changed content", async () => {
  ctx.findExecutable = async name => name === "codex" ? "codex" : null; ctx.readVersion = async () => "0.166.0";
  const first = path.join(ctx.codexHome, "skills", "same", "SKILL.md"), other = path.join(root, "plugin", "skills", "same", "SKILL.md");
  for (const file of [first, other]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, "Original"); }
  service.deps.providers[1]!.listCatalog = async () => [{ name: "same", path: first, description: "local", kind: "skill", size: 8, mtime: 0 }];
  service.deps.metadataTransport = async options => {
    options.onMessage!({ id: 1, result: {} }, () => {}, () => {});
    options.onMessage!({ id: 2, result: { data: [{ cwd: options.cwd, errors: [], skills: [{ name: "same", path: first, description: "local", enabled: true, scope: "user" }, { name: "same", path: other, description: "plugin", enabled: false, scope: "user", pluginId: "example@market" }] }] } }, () => {}, () => {});
    return "";
  };
  const snapshot = await service.recognizedSnapshot("global", true, new AbortController().signal, "codex");
  const rows = snapshot.components.filter(i => i.kind === "skill" && i.name === "same");
  expect(rows).toHaveLength(2);
  expect(rows.map(i => i.observations[0]?.recognition)).toEqual(["confirmed", "unverified"]);
  expect(rows[1]?.observations[0]).toMatchObject({ pluginId: "example@market", enabled: false });
  expect((await service.recognize("codex", "global", false)).stale).toBe(false);
  await fs.writeFile(other, "Changed plugin skill");
  expect((await service.recognize("codex", "global", false)).stale).toBe(true);
  service.deps.metadataTransport = async () => { throw new Error("failed metadata"); };
  const failed = await service.recognize("codex", "global", true);
  expect(failed).toMatchObject({ status: "error", stale: true }); expect(failed.skills).toHaveLength(2); expect(failed.lastSuccessAt).toBeTruthy();
  expect((await service.recognizedSnapshot("global", false, new AbortController().signal)).components.find(i => i.catalogPath === first)?.observations[0]?.recognition).toBe("unverified");
});
it("isolates global and project evidence, rejects unselected scopes and never calls Claude models", async () => {
  ctx.findExecutable = async () => "fixture"; ctx.readVersion = async () => "1.2.3";
  const project = path.join(root, "project"); await fs.mkdir(project);
  const selected = await service.projectScope(project);
  const transport = vi.fn(async () => ""); service.deps.metadataTransport = transport;
  expect((await service.recognize("claude", selected.id, true)).status).toBe("unsupported");
  expect((await service.recognize("claude", "global", false)).checkedAt).toBe("");
  expect(transport).not.toHaveBeenCalled();
  await expect(service.recognize("codex", project, true)).rejects.toMatchObject({ statusCode: 403 });
  expect(await fs.readdir(project)).toEqual([]);
});
it("discovers disabled plugin packages and prevents copying system or plugin skills", async () => {
  const installPath = path.join(root, "plugin"), file = path.join(installPath, "skills", "summary", "SKILL.md");
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, "---\nname: summary\ndescription: test\n---\nSummarize");
  service.deps.plugins = async () => ({ plugins: [{ id: "example@market", provider: "claude", enabledInSettings: false, installs: [{ installPath, version: "1.0.0", scope: "user", installedAt: "" }], blocked: false }], blocklist: [] });
  const item = (await service.snapshot()).components.find(i => i.catalogPath === file)!;
  expect(item.observations[0]).toMatchObject({ enabled: false, recognition: "unverified", pluginId: "example@market" });
  await expect(service.adopt(item.id, true)).rejects.toMatchObject({ statusCode: 422 });
});
it("reviews and applies a first edit without separate profile creation or migration", async () => {
  await store.select("default");
  const base = await store.active();
  ctx = { ...ctx, templateRoot: base.root, profileDir: base.localDir, setupProfile: base };
  service.deps.context = async () => { const active = await store.active(); return { ...ctx, templateRoot: active.root, profileDir: active.localDir, setupProfile: active }; };
  const plan = await service.prepare(component());
  expect((await store.active()).id).toBe("default");
  await expect(fs.stat(path.join(ctx.codexHome, "skills/review/SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(plan.scope).toBe("settings-and-pc");
  await service.apply(plan.token);
  const active = await store.active(); expect(active.id).not.toBe("default");
  expect(parseDefinition(await fs.readFile(path.join(active.root, "home/components.v2.json"), "utf8")).components[0]?.id).toBe("review");
  for (const home of [ctx.claudeHome, ctx.codexHome]) expect(await fs.readFile(path.join(home, "skills/review/SKILL.md"), "utf8")).toBe(component().files["SKILL.md"]);
  const record = (await service.historyList())[0]!;
  expect(record.files.some(f => f.path.endsWith("components.v2.json"))).toBe(true);
  await service.apply((await service.restorePreview(record.id)).token);
  expect((await store.active()).id).toBe("default");
  await expect(fs.stat(path.join(ctx.codexHome, "skills/review/SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("rolls back the first setup and keeps the original selection if a PC write fails", async () => {
  await store.select("default");
  service.deps.context = async () => { const active = await store.active(); return { ...ctx, templateRoot: active.root, profileDir: active.localDir, setupProfile: active }; };
  const plan = await service.prepare(component());
  const target = path.join(ctx.codexHome, "skills/review/SKILL.md");
  const rename = fs.rename;
  vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    if (to === target) throw new Error("simulated PC write failure");
    return rename(from, to);
  });
  await expect(service.apply(plan.token)).rejects.toThrow("simulated PC write failure");
  expect((await store.active()).id).toBe("default");
  for (const home of [ctx.claudeHome, ctx.codexHome]) await expect(fs.stat(path.join(home, "skills/review/SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await store.list()).profiles.filter(p => p.name === "내 설정")).toHaveLength(0);
});
it("updates and restores the baseline and both CLI files as one change", async () => {
  await migrate();
  await service.apply((await service.prepare(component())).token);
  const updated = component({ files: { "SKILL.md": "Updated" } });
  await service.apply((await service.prepare(updated)).token);
  expect((await service.snapshot()).components.find(i => i.definitionId === "review")?.observations.map(o => o.comparison)).toEqual(["match", "match"]);
  const record = (await service.historyList())[0]!;
  await service.apply((await service.restorePreview(record.id)).token);
  expect((await service.definition("review"))?.files["SKILL.md"]).toBe(component().files["SKILL.md"]);
  expect(await fs.readFile(path.join(ctx.codexHome, "skills/review/SKILL.md"), "utf8")).toBe(component().files["SKILL.md"]);
  await service.tick(); expect(service.automationStatus().detail).toContain("복원 후");
});
it("preserves the previous automatic policy when editing an existing setup", async () => {
  await service.apply((await service.prepare(component())).token);
  expect((await service.snapshot()).automatic).toBe(false);
  await service.apply((await service.migrate(true)).token);
  await service.apply((await service.prepare(component({ description: "Updated" }))).token);
  expect((await service.snapshot()).automatic).toBe(true);
});
it("keeps the old baseline and both providers intact when a reviewed target changes", async () => {
  await service.apply((await service.prepare(component())).token);
  const plan = await service.prepare(component({ files: { "SKILL.md": "Reviewed" } }));
  const target = path.join(ctx.codexHome, "skills/review/SKILL.md");
  await fs.writeFile(target, "User edit after preview");
  await expect(service.apply(plan.token)).rejects.toMatchObject({ statusCode: 409 });
  expect((await service.definition("review"))?.files["SKILL.md"]).toBe(component().files["SKILL.md"]);
  expect(await fs.readFile(path.join(ctx.claudeHome, "skills/review/SKILL.md"), "utf8")).toBe(component().files["SKILL.md"]);
  expect(await fs.readFile(target, "utf8")).toBe("User edit after preview");
});
it("records failed external installs and leaves the received baseline uncommitted", async () => {
  const profile = await store.active();
  const before = await readDocument(profile), document = structuredClone(before);
  const tools = JSON.parse(document.files["manifest/tools.json"]!); tools.tools = [tools.tools[0]]; tools.tools[0].name = "Claude Code changed";
  document.files["manifest/tools.json"] = JSON.stringify(tools);
  ctx.runner = { run: async () => ({ code: 1, notFound: false, timedOut: false }) };
  const packet = { profile, before, document, metadata: { path: path.join(store.stateDir, "profiles", profile.id, "github.json"), before: null, after: "{}\n" }, verify: async () => undefined, checkLocal: async () => undefined };
  const preview = await service.receivePreview(new AbortController().signal, packet);
  expect(preview.commands.length).toBeGreaterThan(0);
  await expect(service.apply(preview.token)).rejects.toThrow("저장은 보류");
  expect((await readDocument(profile)).files["manifest/tools.json"]).toBe(before.files["manifest/tools.json"]);
  const record = (await service.historyList())[0]!;
  expect(record.status).toBe("failed"); expect(record.detail).toContain("tools.claude");
});
it("does not resurrect retired instructions when the shared template changes in the same receive", async () => {
  await service.apply((await service.prepare(component({ kind: "instruction", files: { "instructions.md": "Retired component policy" } }))).token);
  for (const file of [path.join(ctx.claudeHome, "CLAUDE.md"), path.join(ctx.codexHome, "AGENTS.md")]) await fs.writeFile(file, "# Private\nKeep this text.\n" + await fs.readFile(file, "utf8"));
  const profile = await store.active(), before = await readDocument(profile), document = structuredClone(before);
  document.files["home/components.v2.json"] = JSON.stringify({ schemaVersion: 2, automatic: false, components: [] });
  document.files["home/claude/CLAUDE.md"] = "# Shared\nNew shared template.";
  document.files["home/agents/AGENTS.md"] = "# Shared\nNew shared template.";
  const packet = { profile, before, document, metadata: { path: path.join(store.stateDir, "profiles", profile.id, "github.json"), before: null, after: "{}\n" }, verify: async () => undefined, checkLocal: async () => undefined };
  const preview = await service.receivePreview(new AbortController().signal, packet);
  await service.apply(preview.token);
  for (const file of [path.join(ctx.claudeHome, "CLAUDE.md"), path.join(ctx.codexHome, "AGENTS.md")]) {
    const text = await fs.readFile(file, "utf8");
    expect(text).toContain("Keep this text."); expect(text).toContain("New shared template."); expect(text).not.toContain("Retired component policy");
  }
});
it("resolves profile context outside the mutation lock like the real app", async () => {
  service.deps.context = () => withLock(async () => ctx);
  await migrate(); await save(); await service.apply((await service.preview(["definition:review"])).token);
  expect(await fs.readFile(path.join(ctx.codexHome, "skills/review/SKILL.md"), "utf8")).toContain("Review changes");
}, 3000);
it("requires explicit migration, preserves v1 files, and exports a validated v2 bundle", async () => {
  const before = await readDocument(await store.active());
  await expect(service.save(component())).rejects.toMatchObject({ statusCode: 422 });
  await migrate(); const after = await readDocument(await store.active());
  for (const [key, value] of Object.entries(before.files)) expect(after.files[key]).toBe(value);
  expect(parseBundle(JSON.stringify(bundleProfile("test", after).bundle)).version).toBe(2);
  expect((await service.snapshot()).automatic).toBe(true);
});
it("applies both providers, is idempotent and restores new files to archive", async () => {
  await migrate(); await save(); const plan = await service.preview(["definition:review"]);
  expect(plan.files).toHaveLength(3); await service.apply(plan.token);
  for (const home of [ctx.claudeHome, ctx.codexHome]) expect(await fs.readFile(path.join(home, "skills/review/SKILL.md"), "utf8")).toBe(component().files["SKILL.md"]);
  expect((await service.preview(["definition:review"])).files).toHaveLength(0);
  const record = (await service.historyList()).find(r => r.title === "1개 구성요소 적용")!;
  await service.apply((await service.restorePreview(record.id)).token);
  await expect(fs.stat(path.join(ctx.claudeHome, "skills/review/SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await service.historyList()).find(r => r.id === record.id)?.status).toBe("restored");
});
it("rejects stale previews and preserves user edits on restore", async () => {
  await migrate(); await save(); const stale = await service.preview(["definition:review"]); await save(component({ description: "changed" }));
  await expect(service.apply(stale.token)).rejects.toMatchObject({ statusCode: 409 });
  await service.apply((await service.preview(["definition:review"])).token);
  const record = (await service.historyList()).find(r => r.title === "1개 구성요소 적용")!;
  const target = path.join(ctx.codexHome, "skills/review/SKILL.md"); await fs.writeFile(target, "user edit");
  await expect(service.apply((await service.restorePreview(record.id)).token)).rejects.toMatchObject({ statusCode: 409 });
  expect(await fs.readFile(target, "utf8")).toBe("user edit");
  expect(await fs.readFile(path.join(ctx.claudeHome, "skills/review/SKILL.md"), "utf8")).toBe(component().files["SKILL.md"]);
});
it("preserves unmanaged instructions and does not duplicate its marker on repeat apply", async () => {
  await migrate(); const file = path.join(ctx.codexHome, "AGENTS.md"); await fs.mkdir(ctx.codexHome, { recursive: true }); await fs.writeFile(file, "# Personal\nKeep this.\n");
  await save(component({ kind: "instruction", files: { "instructions.md": "Review carefully." } }));
  await service.apply((await service.preview(["definition:review"])).token);
  expect(await fs.readFile(file, "utf8")).toContain("Keep this.");
  expect((await service.preview(["definition:review"])).files).toHaveLength(0);
});
it("exposes v4 resources through the existing doctor/install contracts", async () => {
  await migrate(); await save();
  expect((await planInstallWith(ctx)).steps.find(s => s.id === "components.review")?.state).toBe("missing");
  const result = await runInstallWith(ctx, ["components.review"], () => undefined, new AbortController().signal);
  expect(result.results[0]?.outcome).toBe("done");
  expect((await runDoctorWith(ctx)).cards.flatMap(c => c.checks).find(c => c.id === "components.review")?.state).toBe("ok");
});
it("archives disabled skill targets and removes only its own instruction block", async () => {
  await migrate(); await save(); await service.apply((await service.preview(["definition:review"])).token);
  await save(component({ targets: ["claude"] }));
  await expect(fs.stat(path.join(ctx.codexHome, "skills/review/SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
  const file = path.join(ctx.codexHome, "AGENTS.md"); await fs.writeFile(file, "# Private\nKeep me.\n");
  const instruction = component({ id: "policy", kind: "instruction", files: { "instructions.md": "Shared policy." } });
  await save(instruction); await service.apply((await service.preview(["definition:policy"])).token);
  await save({ ...instruction, targets: ["claude"] });
  expect(await fs.readFile(file, "utf8")).toContain("Keep me."); expect(await fs.readFile(file, "utf8")).not.toContain("Shared policy.");
});
it("automatically applies ordinary profile edits, but defers code and local drift", async () => {
  await migrate(); await save(); await service.apply((await service.preview(["definition:review"])).token);
  await save(component({ files: { "SKILL.md": "Updated documentation" } })); await service.tick();
  const file = path.join(ctx.codexHome, "skills/review/SKILL.md"); expect(await fs.readFile(file, "utf8")).toBe("Updated documentation");
  await save(component({ files: { "SKILL.md": "Updated again", "run.js": "process.exit(0)" } })); await service.tick();
  expect(await fs.readFile(file, "utf8")).toBe("Updated documentation");
  await fs.writeFile(file, "user edit"); await save(component({ files: { "SKILL.md": "remote edit" } })); await service.tick(); expect(await fs.readFile(file, "utf8")).toBe("user edit");
});
it("defers automatic writes while a CLI is running or cannot be inspected", async () => {
  await migrate(); await save(); await service.apply((await service.preview(["definition:review"])).token);
  await save(component({ files: { "SKILL.md": "changed" } })); running = true; await service.tick();
  expect(service.automationStatus().detail).toContain("CLI 실행 중");
  service.deps.providers[0]!.detectRunning = async () => { throw new Error("inspection failed"); }; running = false; await service.tick();
  expect(service.automationStatus().detail).toContain("inspection failed");
  expect(await fs.readFile(path.join(ctx.claudeHome, "skills/review/SKILL.md"), "utf8")).toBe(component().files["SKILL.md"]);
});
it("keeps restored settings until the next manual apply and can resume normally", async () => {
  await migrate(); await save(); await service.apply((await service.preview(["definition:review"])).token);
  await save(component({ files: { "SKILL.md": "updated" } })); await service.tick();
  const record = (await service.historyList()).find(r => r.actor === "automatic" && r.files.some(f => f.path.endsWith("SKILL.md")))!;
  await service.apply((await service.restorePreview(record.id)).token); await service.tick();
  expect(service.automationStatus().detail).toContain("복원 후");
  const file = path.join(ctx.codexHome, "skills/review/SKILL.md"); expect(await fs.readFile(file, "utf8")).toBe(component().files["SKILL.md"]);
  await service.apply((await service.preview(["definition:review"])).token); expect(await fs.readFile(file, "utf8")).toBe("updated");
});
it("restores a removed managed file from the archived definition", async () => {
  await migrate(); await save(component({ files: { "SKILL.md": "skill", "notes.md": "keep notes" } }));
  await service.apply((await service.preview(["definition:review"])).token); await save(component({ files: { "SKILL.md": "skill" } }));
  const record = (await service.historyList()).find(r => r.title === "Review 프로필 저장")!;
  await expect(fs.stat(path.join(ctx.codexHome, "skills/review/notes.md"))).rejects.toMatchObject({ code: "ENOENT" });
  await service.apply((await service.restorePreview(record.id)).token);
  expect(await fs.readFile(path.join(ctx.codexHome, "skills/review/notes.md"), "utf8")).toBe("keep notes");
});
it("rejects traversal, duplicate case paths, unmanaged identifiers, and scripts from ordinary policy", async () => {
  expect(() => validateComponent(component({ files: { "SKILL.md": "x", "../outside.md": "x" } }))).toThrow();
  expect(() => validateComponent(component({ files: { "SKILL.md": "x", "skill.md": "x" } }))).toThrow();
  expect(() => parseDefinition('{"schemaVersion":3}')).toThrow();
  expect(ordinaryFiles(component({ files: { "SKILL.md": "x", "run.ps1": "x" } }))).toBe(false);
  await expect(service.preview(["unknown"])).rejects.toMatchObject({ statusCode: 404 });
});
it("rolls back a partial multi-file write and recovers an interrupted journal without overwriting edits", async () => {
  const a = path.join(root, "a"), b = path.join(root, "b"); await fs.writeFile(a, "old a"); await fs.writeFile(b, "old b");
  let visits = 0;
  const history = new ChangeHistory(path.join(root, "history"), async file => { if (file === b && ++visits === 2) throw new Error("simulated write failure"); });
  await expect(history.apply("test", "batch", [{ path: a, before: "old a", after: "new a" }, { path: b, before: "old b", after: "new b" }])).rejects.toThrow("simulated");
  expect(await fs.readFile(a, "utf8")).toBe("old a"); expect(await fs.readFile(b, "utf8")).toBe("old b");
  const good = new ChangeHistory(path.join(root, "history"), async () => undefined);
  const id = await good.apply("test", "interrupted", [{ path: a, before: "old a", after: "new a" }]);
  const file = path.join(root, "history", `${id}.json`); const record = JSON.parse(await fs.readFile(file, "utf8")); record.status = "pending"; await fs.writeFile(file, JSON.stringify(record));
  await good.restore(id, "test"); expect(await fs.readFile(a, "utf8")).toBe("old a");
});
