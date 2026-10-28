import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SetupProfileStore } from "./setup-profiles.js";
import {
  bundleProfile,
  parseBundle,
  readDocument,
  stringify,
  transferProblem,
  writeDocument,
} from "./profile-document.js";
import { applyCaptureWith, planCaptureWith } from "./capture/capture.js";
let root: string;
let store: SetupProfileStore;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-portable-"));
  store = new SetupProfileStore(path.join(root, "state"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
it("works without an app repository and repairs missing private terms without gating capture", async () => {
  expect((await store.list()).profiles.map((p) => p.id)).toEqual(["default"]);
  await store.create("personal", "default");
  const profile = await store.active();
  await fs.unlink(path.join(profile.localDir, "private-terms.json"));
  await store.active();
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(profile.localDir, "private-terms.json"),
        "utf8",
      ),
    ),
  ).toEqual({ terms: [] });
  const claudeHome = path.join(root, "claude");
  await fs.mkdir(claudeHome);
  await fs.writeFile(
    path.join(claudeHome, "settings.json"),
    '{"model":"my-model"}',
  );
  const ctx = {
    repoRoot: profile.root,
    profileDir: profile.localDir,
    claudeHome,
    home: root,
    codexHome: path.join(root, "codex"),
    claudeJson: path.join(root, "claude.json"),
    skillLock: path.join(root, "skills.json"),
    privateTerms: [],
    documentsDir: path.join(root, "Documents"),
    gitScope: { file: path.join(root, "gitconfig") },
  };
  const preview = await planCaptureWith(ctx, ["claude-settings"]);
  expect(preview.items[0].applicable).toBe(true);
  await applyCaptureWith(ctx, ["claude-settings"], {
    "claude-settings": preview.items[0].fingerprint,
  });
  expect(
    JSON.parse(
      (await readDocument(profile)).files["home/claude/settings.managed.json"],
    ).model,
  ).toBe("my-model");
});
it("keeps selected personal settings in a round trip and excludes credentials and machine paths", async () => {
  await store.create("one", "default");
  const profile = await store.active();
  const doc = await readDocument(profile);
  doc.personal = {
    "AGENTS.local.md": "Write in Korean",
    "gitconfig.local.json": '{"user.email":"person@example.invalid"}',
    "claude-settings.local.json": '{"apiKey":"sk-1234567890123456789012345"}',
    "powershell.local.ps1": "Set-Location C:\\work",
  };
  doc.portable = Object.keys(doc.personal);
  const { bundle, notes } = bundleProfile("one", doc);
  expect(Object.keys(bundle.personal)).toEqual([
    "AGENTS.local.md",
    "gitconfig.local.json",
  ]);
  expect(notes).toHaveLength(2);
  await store.importBundle(parseBundle(stringify(bundle)));
  const imported = await store.active();
  expect(imported.id).not.toBe(profile.id);
  expect((await readDocument(imported)).personal).toEqual(bundle.personal);
  expect(transferProblem("${API_KEY}")).toBe(null);
  expect(transferProblem('{"API_KEY":"${API_KEY}"}')).toBe(null);
});
it("rejects unsupported formats, path traversal, invalid manifests and stale previews", async () => {
  await store.create("one", "default");
  const editor = await store.editor((await store.active()).id);
  const bundle = bundleProfile("one", editor.document).bundle;
  expect(() => parseBundle(stringify({ ...bundle, version: 2 }))).toThrow();
  expect(() =>
    parseBundle(
      stringify({
        ...bundle,
        files: { ...bundle.files, "../auth.json": "{}" },
      }),
    ),
  ).toThrow();
  expect(() =>
    parseBundle(
      stringify({
        ...bundle,
        files: { ...bundle.files, "manifest/packages.json": "{}" },
      }),
    ),
  ).toThrow();
  const doc = structuredClone(editor.document);
  doc.files["home/claude/settings.managed.json"] = '{"model":"changed"}';
  const preview = await store.preview(
    editor.profile.id,
    editor.fingerprint,
    doc,
  );
  await fs.writeFile(
    path.join(editor.profile.root, "home/claude/settings.managed.json"),
    '{"model":"external"}',
  );
  await expect(
    store.apply(editor.profile.id, preview.token),
  ).rejects.toMatchObject({ statusCode: 409 });
});
it("preserves originals during legacy migration and archive/restore", async () => {
  const legacy = path.join(root, "old-repo");
  await fs.cp((await store.active()).root, legacy, { recursive: true });
  const old = new SetupProfileStore(store.stateDir, legacy);
  await fs.writeFile(
    path.join(store.stateDir, "settings.json"),
    '{"setupProfileId":"legacy"}',
  );
  const migrated = await old.active();
  expect(migrated.kind).toBe("local");
  expect(migrated.root).not.toBe(legacy);
  const doc = await readDocument(migrated);
  doc.files["home/claude/settings.managed.json"] = '{"model":"new"}';
  await writeDocument(migrated, doc);
  expect(
    await fs.readFile(
      path.join(legacy, "home/claude/settings.managed.json"),
      "utf8",
    ),
  ).toBe("{}\n");
  await old.update(migrated.id, "archive");
  expect((await old.list()).activeId).toBe("default");
  await old.update(migrated.id, "restore");
  await old.select(migrated.id);
  expect((await old.active()).id).toBe(migrated.id);
});
it("refuses a symlinked profile subdirectory", async () => {
  await store.create("one", "default");
  const p = await store.active();
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "AGENTS.md"), "do not touch");
  await fs.symlink(
    outside,
    path.join(p.root, "home/agents"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(readDocument(p)).rejects.toThrow("링크");
  expect(await fs.readFile(path.join(outside, "AGENTS.md"), "utf8")).toBe(
    "do not touch",
  );
});
