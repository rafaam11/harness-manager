import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { patchTomlValues } from "./toml.js";
import { settingCatalog, settingId } from "./catalog.js";
import { CLI_SETTINGS_FILE, parseCliSettings } from "./definition.js";
import { WorkbenchService } from "../workbench/service.js";
import { SetupProfileStore } from "../setup-profiles.js";
import { readDocument, bundleProfile, parseBundle } from "../profile-document.js";
import { runDoctorWith, loadManifests } from "../doctor/doctor.js";
import { planInstallWith, runInstallWith, type InstallContext } from "../install/engine.js";
import { planCaptureWith, applyCaptureWith } from "../capture/capture.js";
import { planPlugins, type CaptureContext } from "../capture/targets.js";
let root: string, store: SetupProfileStore, ctx: InstallContext, workbench: WorkbenchService;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-cli-settings-")); store = new SetupProfileStore(path.join(root, "state")); await store.create("test", "default");
  const p = await store.active();
  ctx = { home: root, repoRoot: null, templateRoot: p.root, profileDir: p.localDir, setupProfile: p, profile: "full", claudeHome: path.join(root, "claude"), claudeJson: path.join(root, "claude.json"), codexHome: path.join(root, "codex"), agentsSkillsDir: path.join(root, "agents/skills"), documentsDir: path.join(root, "Documents"), gitScope: { file: path.join(root, "gitconfig") }, env: {}, findExecutable: async () => null, readVersion: async () => null, inspectNodeRuntime: async () => ({ state: "fresh", candidates: [], registrations: [], versions: [], detail: "fixture" } as never), refreshEnvironment: async () => false, now: () => new Date(), selfSource: "github", runner: { run: async () => ({ code: 1, notFound: true, timedOut: false }) } };
  workbench = new WorkbenchService({ stateDir: store.stateDir, context: async () => ctx, providers: [], plugins: async () => ({ plugins: [], blocklist: [] }) });
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); });
const edit = async (provider: "claude" | "codex", keys: string[], value?: any, operation: "set" | "remove" | "release" = "set") => workbench.prepareSettings([{ provider, id: settingId(provider, keys), operation, ...(operation === "set" ? { value } : {}) }]);
async function write(provider: "claude" | "codex", text: string) { const dir = provider === "claude" ? ctx.claudeHome : ctx.codexHome; await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, provider === "claude" ? "settings.json" : "config.toml"), text); }

it("bundles the full official index and protects owned settings and credentials", async () => {
  expect(settingCatalog("claude").length).toBeGreaterThanOrEqual(247); expect(settingCatalog("codex").length).toBeGreaterThan(100);
  await expect(edit("codex", ["profiles"], {})).rejects.toThrow();
  await expect(edit("claude", ["env"], { SECRET: "private" })).rejects.toThrow();
  await write("codex", '[model_providers.custom]\nname="Custom"\napi_key="must-not-leak"\n');
  expect(JSON.stringify(await workbench.cliSettings.snapshot("codex"))).not.toContain("must-not-leak");
  expect(() => parseCliSettings('{"schemaVersion":1,"settings":[{"provider":"codex","path":["__proto__"],"operation":"remove"}],"extensions":[]}')).toThrow();
});
it("edits complex values and removes only the reviewed key while preserving unrelated config", async () => {
  await write("claude", '{"permissions":{"allow":["Read","Bash(git:*)"],"deny":["Read(.env)"]},"theme":"dark"}');
  const p = await edit("claude", ["permissions", "allow"], ["Read"]); await workbench.apply(p.token);
  let actual = JSON.parse(await fs.readFile(path.join(ctx.claudeHome, "settings.json"), "utf8")); expect(actual.permissions.allow).toEqual(["Read"]); expect(actual.permissions.deny).toEqual(["Read(.env)"]); expect(actual.theme).toBe("dark");
  await workbench.apply((await edit("claude", ["permissions", "allow"], undefined, "remove")).token);
  actual = JSON.parse(await fs.readFile(path.join(ctx.claudeHome, "settings.json"), "utf8")); expect(actual.permissions.allow).toBeUndefined(); expect(actual.permissions.deny).toEqual(["Read(.env)"]);
});
it("preserves TOML comments, root lists, quoted keys and multiline strings", () => {
  const original = '# private\nmodel="old" # retain\n[features]\nweb_search_request = true\n';
  const next = patchTomlValues(original, [{ provider: "codex", path: ["model"], operation: "set", value: "new\nline" }, { provider: "codex", path: ["notify"], operation: "set", value: ["my-tool", "arg"] }, { provider: "codex", path: ["plugins", "plugin.with.dots@market", "enabled"], operation: "set", value: false }]);
  expect(parseToml(next).model).toBe("new\nline"); expect(parseToml(next).notify).toEqual(["my-tool", "arg"]); expect(next).toContain('# retain'); expect(next).toContain('web_search_request = true');
});
it("replaces array tables and removes a managed table without serializing other sections", () => {
  const original = '# keep\n[[agents.extra]]\nname="first"\n[[agents.extra]]\nname="second"\n[unrelated]\nx=2 # untouched\n';
  const next = patchTomlValues(original, [{ provider: "codex", path: ["agents", "extra"], operation: "set", value: [{ name: "third" }] }]);
  expect((parseToml(next).agents as any).extra).toEqual([{ name: "third" }]); expect(next).toContain('x=2 # untouched');
  const removed = patchTomlValues(next, [{ provider: "codex", path: ["agents", "extra"], operation: "remove" }]); expect((parseToml(removed).agents as any)?.extra).toBeUndefined();
});
it("applies and restores the baseline and PC files together and exports bundle v3", async () => {
  await write("codex", '# personal\nmodel="old"\n');
  await workbench.apply((await edit("codex", ["model"], "new")).token);
  const doc = await readDocument(await store.active()); expect(parseBundle(JSON.stringify(bundleProfile("test", doc).bundle)).version).toBe(3);
  const record = (await workbench.historyList())[0]!; await workbench.apply((await workbench.restorePreview(record.id)).token);
  expect(await fs.readFile(path.join(ctx.codexHome, "config.toml"), "utf8")).toBe('# personal\nmodel="old"\n');
});
it("does not change the saved definition when a reviewed PC file changes", async () => {
  await write("codex", 'model="before"\n'); const plan = await edit("codex", ["model"], "after"); await write("codex", 'model="concurrent"\n');
  await expect(workbench.apply(plan.token)).rejects.toMatchObject({ statusCode: 409 }); expect((await readDocument(await store.active())).files[CLI_SETTINGS_FILE]).toBeUndefined();
});
it("feeds doctor/install/capture with the same desired state", async () => {
  await workbench.apply((await edit("codex", ["model"], "desired")).token); await write("codex", '# unchanged\nmodel="external"\n');
  expect((await runDoctorWith(ctx)).cards.flatMap(c => c.checks).find(c => c.id === "cli-settings.codex")?.state).toBe("drift");
  expect((await planInstallWith(ctx)).steps.find(s => s.id === "cli-settings.codex")?.actionable).toBe(true);
  await runInstallWith(ctx, ["cli-settings.codex"], () => undefined, new AbortController().signal); expect(parseToml(await fs.readFile(path.join(ctx.codexHome, "config.toml"), "utf8")).model).toBe("desired");
  await write("codex", 'model="captured"\n');
  const capture: CaptureContext = { ...ctx, repoRoot: ctx.templateRoot!, profileDir: ctx.profileDir, skillLock: path.join(root, "lock"), privateTerms: [] };
  const preview = await planCaptureWith(capture, ["codex-config"]); await applyCaptureWith(capture, ["codex-config"], { "codex-config": preview.items[0]!.fingerprint });
  expect((await readDocument(await store.active())).files[CLI_SETTINGS_FILE]).toContain("captured");
});
it("keeps a released value on this PC and prevents legacy templates from reclaiming it", async () => {
  await workbench.apply((await edit("claude", ["model"], "my-model")).token);
  await workbench.apply((await edit("claude", ["model"], undefined, "release")).token);
  const doc = await readDocument(await store.active()); expect(JSON.parse(doc.files["home/managed-keys.json"]!).claudeSettings).not.toContain("model");
  expect(JSON.parse(await fs.readFile(path.join(ctx.claudeHome, "settings.json"), "utf8")).model).toBe("my-model");
});
it("shows uninstalled known mods and writes options under pluginConfigs.options", async () => {
  const extensions = await workbench.cliSettings.extensions("claude"); expect(extensions).toHaveLength(5); expect(extensions.every(e => !e.installed)).toBe(true);
  const option = extensions.find(e => e.id === "jinmin-hud@jinmin")!.options.find(o => o.path.at(-1) === "maxRows")!;
  await workbench.apply((await workbench.prepareSettings([{ provider: "claude", id: option.id, operation: "set", value: 6 }])).token);
  expect(JSON.parse(await fs.readFile(path.join(ctx.claudeHome, "settings.json"), "utf8")).pluginConfigs["jinmin-hud@jinmin"].options.maxRows).toBe(6);
});
it("retains disabled extension intents and records installation failures without baseline writes", async () => {
  await workbench.apply((await workbench.prepareSettings([], { provider: "claude", id: "guard@jinmin", enabled: false })).token);
  expect((await loadManifests(ctx)).claudeEnabled.some(p => p.id === "guard@jinmin")).toBe(false);
  const before = (await readDocument(await store.active())).files[CLI_SETTINGS_FILE];
  await expect(workbench.apply((await workbench.prepareSettings([], { provider: "claude", id: "guard@jinmin", enabled: true })).token)).rejects.toThrow("실패");
  expect((await readDocument(await store.active())).files[CLI_SETTINGS_FILE]).toBe(before); expect((await workbench.historyList())[0]!.status).toBe("failed");
});
it("keeps PC paths local and leaves them out of portable bundles", async () => {
  const value = path.join(root, "my-logs");
  await workbench.apply((await edit("codex", ["log_dir"], value)).token);
  const doc = await readDocument(await store.active());
  expect(doc.files[CLI_SETTINGS_FILE]).not.toContain(value.replaceAll("\\", "\\\\"));
  expect(doc.personal["cli-settings.local.json"]).toContain("my-logs");
  const exported = bundleProfile("private", doc).bundle;
  expect(exported.version).toBe(3); expect(exported.personal["cli-settings.local.json"]).toBeUndefined();
  expect((await workbench.cliSettings.snapshot("codex")).settings.find(s => s.path[0] === "log_dir")?.desired?.value).toBe(value);
});
it("edits keys inside inline TOML tables without losing adjacent entries", () => {
  const initial = 'features = { a=true, b=false } # keep\n';
  const changed = patchTomlValues(initial, [{ provider: "codex", path: ["features", "a"], operation: "set", value: false }]);
  expect(changed).toContain('b=false');
  const removed = patchTomlValues(changed, [{ provider: "codex", path: ["features", "a"], operation: "remove" }]);
  expect((parseToml(removed).features as any)).toEqual({ b: false }); expect(removed).toContain('# keep');
});

it("captures a PC-specific path into the local definition without dropping management", async () => {
  await workbench.apply((await edit("codex", ["log_dir"], path.join(root, "initial"))).token);
  await write("codex", `log_dir=${JSON.stringify(path.join(root, "changed"))}\n`);
  const capture: CaptureContext = { ...ctx, repoRoot: ctx.templateRoot!, profileDir: ctx.profileDir, skillLock: path.join(root, "lock"), privateTerms: [] };
  const preview = await planCaptureWith(capture, ["codex-config"]);
  await applyCaptureWith(capture, ["codex-config"], { "codex-config": preview.items[0]!.fingerprint });
  const doc = await readDocument(await store.active());
  expect(doc.personal["cli-settings.local.json"]).toContain("changed");
  expect(doc.files[CLI_SETTINGS_FILE]).not.toContain("changed");
  expect((await runDoctorWith(ctx)).cards.flatMap(c => c.checks).find(c => c.id === "cli-settings.codex")?.state).toBe("ok");
});
it("verifies native installation before committing and rebases only the selected plugin flag", async () => {
  let installed = false;
  ctx.runner = { run: async spec => {
    if (spec.args[1] === "install") { installed = true; await write("claude", '{"enabledPlugins":{"guard@jinmin":true}}'); }
    return { code: 0, notFound: false, timedOut: false };
  } };
  const bench = new WorkbenchService({ stateDir: store.stateDir, context: async () => ctx, providers: [], plugins: async () => ({ plugins: installed ? [{ id: "guard@jinmin", provider: "claude", enabledInSettings: true, installs: [{ scope: "user", version: "0.1.0" }] }] : [], blocklist: [] } as never) });
  await bench.apply((await bench.prepareSettings([], { provider: "claude", id: "guard@jinmin", enabled: true })).token);
  expect((await readDocument(await store.active())).files[CLI_SETTINGS_FILE]).toContain("guard@jinmin");
  const capture: CaptureContext = { ...ctx, repoRoot: ctx.templateRoot!, profileDir: ctx.profileDir, skillLock: path.join(root, "lock"), privateTerms: [] };
  const preview = await planPlugins(capture);
  expect(JSON.parse(preview.files.find(f => f.displayPath === "manifest/plugins.json")!.after).claude.enabled).not.toContain("guard@jinmin");
});
it("does not commit when a native command reports success without installing anything", async () => {
  ctx.runner = { run: async () => ({ code: 0, notFound: false, timedOut: false }) };
  await expect(workbench.apply((await workbench.prepareSettings([], { provider: "claude", id: "guard@jinmin", enabled: true })).token)).rejects.toThrow("실패");
  expect((await readDocument(await store.active())).files[CLI_SETTINGS_FILE]).toBeUndefined();
});

it("keeps legacy sibling keys managed when a nested setting changes ownership", async () => {
  const managedFile = path.join(ctx.templateRoot!, "home/managed-keys.json");
  const managed = JSON.parse(await fs.readFile(managedFile, "utf8")); managed.claudeSettings = ["permissions"];
  await fs.writeFile(managedFile, JSON.stringify(managed));
  await fs.writeFile(path.join(ctx.templateRoot!, "home/claude/settings.managed.json"), '{"permissions":{"allow":["Read"],"deny":["Write"]}}');
  await write("claude", '{"permissions":{"allow":["Read"],"deny":["Write"]}}');
  await workbench.apply((await edit("claude", ["permissions", "allow"], ["Read", "Glob"])).token);
  expect(JSON.parse((await readDocument(await store.active())).files["home/managed-keys.json"]!).claudeSettings).toEqual(["permissions.deny"]);
  await workbench.apply((await edit("claude", ["permissions"], { allow: ["Read"] })).token);
  await expect(edit("claude", ["permissions", "allow"], [])).rejects.toThrow("상위 설정");
});

it("includes the selected provider in an existing jinmin marketplace when receiving extension intents", async () => {
  const manifest = path.join(ctx.templateRoot!, "manifest/plugins.json");
  const plugins = JSON.parse(await fs.readFile(manifest, "utf8"));
  plugins.marketplaces = [{ name: "jinmin", source: { kind: "self" }, providers: ["claude"] }];
  await fs.writeFile(manifest, JSON.stringify(plugins));
  await fs.writeFile(path.join(ctx.templateRoot!, CLI_SETTINGS_FILE), JSON.stringify({ schemaVersion: 1, settings: [], extensions: [{ provider: "codex", id: "jinmin-codex@jinmin", enabled: true }] }));
  const loaded = await loadManifests(ctx);
  expect(loaded.marketplaces.find(m => m.entry.name === "jinmin")!.entry.providers).toContain("codex");
  expect(loaded.codexEnabled.map(e => e.id)).toContain("jinmin-codex@jinmin");
  expect(loaded.claudeEnabled.map(e => e.id)).not.toContain("jinmin-codex@jinmin");
});
