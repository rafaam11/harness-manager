import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SetupProfileStore } from "./setup-profiles.js";
import { loadManifests, type DoctorContext } from "./doctor/doctor.js";
import { planInstallWith, runInstallWith, type InstallContext } from "./install/engine.js";
import { applyCaptureWith, planCaptureWith } from "./capture/capture.js";
import type { CaptureContext } from "./capture/targets.js";
import { validateManifest } from "./manifest/validate.js";
let root: string;
let store: SetupProfileStore;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-profiles-"));
  store = new SetupProfileStore(path.join(root, "state"), path.join(root, "app"));
  await fs.mkdir(store.repoRoot);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it("starts with neutral defaults and keeps the existing personal template opt-in", async () => {
  const active = await store.active();
  expect(active.id).toBe("default");
  const manifests = await loadManifests({ repoRoot: store.repoRoot, templateRoot: active.root, profileDir: active.localDir } as DoctorContext);
  expect(manifests.claudeEnabled).toEqual([]);
  expect(manifests.codexEnabled).toEqual([]);
  expect(manifests.marketplaces).toEqual([]);
  expect(manifests.packages.map((entry) => entry.id)).toEqual(["git", "nvm"]);
  expect(manifests.tools.map((entry) => entry.id)).toEqual(["claude", "codex"]);
  expect((await validateManifest(active.root)).every((file) => file.ok)).toBe(true);
  expect((await store.list()).profiles.find((profile) => profile.id === "legacy")?.root).toBe(store.repoRoot);
});

it("installs only the active profile and captures back into that profile without changing the app repo", async () => {
  await store.create("work", "default"); const first = await store.active();
  await store.create("personal", "default"); const second = await store.active();
  const modelFile = (folder: string) => path.join(folder, "home/claude/settings.managed.json");
  await fs.writeFile(modelFile(first.root), '{"model":"first-model"}');
  await fs.writeFile(modelFile(second.root), '{"model":"second-model"}');
  const ctx = {
    repoRoot: store.repoRoot, templateRoot: second.root, profileDir: second.localDir,
    home: root, claudeHome: path.join(root, "claude"), claudeJson: path.join(root, "claude.json"), codexHome: path.join(root, "codex"),
    agentsSkillsDir: path.join(root, "skills"), documentsDir: path.join(root, "documents"), gitScope: { file: path.join(root, "gitconfig") },
    env: {}, profile: "core", selfSource: "directory", now: () => new Date(), findExecutable: async () => null, readVersion: async () => null,
    refreshEnvironment: async () => false, inspectNodeRuntime: async () => ({ state: "ready", detail: "existing node", candidates: [], versions: [], registrations: [] }), runner: { run: vi.fn() },
  } as unknown as InstallContext;
  const plan = await planInstallWith(ctx);
  expect(plan.steps.some((step) => step.id.includes("jinmin"))).toBe(false);
  await runInstallWith(ctx, ["claude.settings"], vi.fn(), new AbortController().signal);
  const live = path.join(ctx.claudeHome, "settings.json");
  expect(JSON.parse(await fs.readFile(live, "utf8")).model).toBe("second-model");
  await fs.writeFile(live, '{"model":"captured-model"}');
  const capture = { ...ctx, repoRoot: second.root, skillLock: path.join(root, "skills-lock.json"), privateTerms: [] } as CaptureContext;
  const preview = await planCaptureWith(capture, ["claude-settings"]);
  await applyCaptureWith(capture, ["claude-settings"], { "claude-settings": preview.items[0].fingerprint });
  expect(JSON.parse(await fs.readFile(modelFile(second.root), "utf8")).model).toBe("captured-model");
  expect(JSON.parse(await fs.readFile(modelFile(first.root), "utf8")).model).toBe("first-model");
  expect(await fs.readdir(store.repoRoot)).toEqual([]);
});

it("connects a separate profile clone and keeps local overlays outside its repository", async () => {
  const original = await store.active();
  const folder = path.join(root, "private-repo"); await fs.cp(original.root, folder, { recursive: true });
  await store.connect("my private profile", folder);
  const active = await store.active();
  expect(active.kind).toBe("linked");
  expect(active.root).toBe(await fs.realpath(folder));
  expect(active.localDir.startsWith(folder)).toBe(false);
  await expect(store.connect("duplicate", folder)).rejects.toMatchObject({ statusCode: 409 });
  await fs.writeFile(path.join(folder, "manifest/plugins.json"), "broken");
  await expect(store.active()).rejects.toMatchObject({ statusCode: 422 });
});

it("does not fall back to a different profile when the selected definition is missing", async () => {
  await store.create("one", "default");
  const active = await store.active();
  await fs.unlink(path.join(active.root, "manifest/tools.json"));
  await expect(store.active()).rejects.toMatchObject({ statusCode: 422 });
  expect((await store.list()).activeId).toBe(active.id);
});
