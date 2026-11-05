import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SetupProfileStore } from "./setup-profiles.js";
import { ProfileSync } from "./profile-sync.js";
import { readDocument, writeDocument } from "./profile-document.js";
import { processRunner, type CommandRunner } from "./install/exec.js";
import { WorkbenchService } from "./workbench/service.js";
import { randomUUID } from "node:crypto";
import type { PcStatusPreview } from "@shared/pc-status-types";
import type { InstallContext } from "./install/engine.js";
import type { NodeRuntimeState } from "./node-runtime.js";
vi.mock("./repo-sync/cloud.js", () => ({
  readCloudRoots: async () => [],
  isCloudSynced: () => false,
}));
let root: string,
  bare: string,
  store: SetupProfileStore,
  sync: ProfileSync,
  id: string,
  privateRepo: boolean,
  deny: boolean;
const signal = new AbortController().signal;
const git = (args: string[]) =>
  execFileSync("git", args, {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
function head() {
  try {
    return git(["--git-dir", bare, "rev-parse", "refs/heads/main"]);
  } catch {
    return null;
  }
}
const runner: CommandRunner = {
  run: async (spec, log, abort) => {
    if (spec.command === "gh") {
      if (deny) return { code: 1, notFound: false, timedOut: false };
      const value = spec.args.includes("view")
        ? JSON.stringify({
            isPrivate: privateRepo,
            defaultBranchRef: head() ? { name: "main" } : null,
          })
        : spec.args.includes(".sha")
          ? (head() ?? "")
          : spec.args.includes(".login")
            ? "tester"
            : JSON.stringify({ login: "tester", id: 123 });
      log("stdout", value);
      return { code: 0, notFound: false, timedOut: false };
    }
    return processRunner.run(
      {
        ...spec,
        args: spec.args.map((arg) =>
          arg === "https://github.com/test/profile.git" ? bare : arg,
        ),
      },
      log,
      abort,
    );
  },
};
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-sync-"));
  bare = path.join(root, "remote.git");
  git(["init", "--bare", "--initial-branch=main", bare]);
  store = new SetupProfileStore(path.join(root, "state"));
  await store.create("first", "default");
  id = (await store.active()).id;
  sync = new ProfileSync(store, runner);
  privateRepo = true;
  deny = false;
  await sync.connect(id, "test/profile", false, signal);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function model(value: string) {
  const p = await store.get(id),
    doc = await readDocument(p);
  doc.files["home/claude/settings.managed.json"] = JSON.stringify({
    model: value,
  });
  await writeDocument(p, doc);
}
async function send() {
  const p = await sync.preview(id, "send", signal);
  await sync.apply(id, p.token, {}, signal);
}
it("shares separate PC reports, rejects stale or public sends and leaves profile definitions untouched", async () => {
  await send();
  const document = await readDocument(await store.get(id));
  const preview = (alias: string): PcStatusPreview => ({ token: randomUUID(), report: { format: "harness-manager-pc-status", version: 1, pcId: randomUUID(), alias, reportedAt: new Date().toISOString(), cliVersions: { codex: "0.166.0" }, items: [] } });
  const first = preview("A"), second = preview("B");
  await sync.prepareStatus(id, first, signal); await sync.prepareStatus(id, second, signal);
  await sync.sendStatus(id, first.token, signal);
  await expect(sync.sendStatus(id, second.token, signal)).rejects.toMatchObject({ statusCode: 409 });
  const fresh = { ...second, token: randomUUID() }; await sync.prepareStatus(id, fresh, signal); await sync.sendStatus(id, fresh.token, signal);
  expect((await sync.statusReports(id, signal)).map(report => report.alias).sort()).toEqual(["A", "B"]);
  expect(await readDocument(await store.get(id))).toEqual(document);
  expect(git(["--git-dir", bare, "show", "main:profile.hmprofile.json"])).not.toContain("pc-status");
  const next = preview("C"); await sync.prepareStatus(id, next, signal); privateRepo = false;
  await expect(sync.sendStatus(id, next.token, signal)).rejects.toMatchObject({ statusCode: 409 });
});
it("returns resolved conflicts as a pending PC review with original local and remote checks", async () => {
  await model("base"); await send(); const original = id;
  await store.create("second", "default"); id = (await store.active()).id;
  await sync.connect(id, "test/profile", false, signal);
  const receive = await sync.preview(id, "receive", signal); await sync.apply(id, receive.token, {}, signal);
  await model("remote"); await send(); id = original; await model("local");
  const conflict = await sync.preview(id, "receive", signal);
  const choices = Object.fromEntries(conflict.conflicts.map(file => [file, "remote" as const]));
  const packet = await sync.prepareReceive(id, signal, conflict.token, choices);
  expect(JSON.parse(packet.document.files["home/claude/settings.managed.json"]!).model).toBe("remote");
  expect(JSON.parse((await readDocument(await store.get(id))).files["home/claude/settings.managed.json"]!).model).toBe("local");
  await packet.verify(signal); await model("changed-after-review");
  await expect(packet.checkLocal()).rejects.toMatchObject({ statusCode: 409 });
});
it("sends the first profile when GitHub reports an empty default branch name", async () => {
  sync = new ProfileSync(store, {
    run: async (spec, log, abort) => {
      if (spec.command === "gh" && spec.args.includes("view") && !head()) {
        log("stdout", JSON.stringify({ isPrivate: true, defaultBranchRef: { name: "" } }));
        return { code: 0, notFound: false, timedOut: false };
      }
      return runner.run(spec, log, abort);
    },
  });
  expect((await sync.status(id, signal)).available).toBe(true);
  const preview = await sync.preview(id, "send", signal);
  expect(preview.changes.length).toBeGreaterThan(0);
  expect(head()).toBeNull();
  await sync.apply(id, preview.token, {}, signal);
  expect(head()).not.toBeNull();
  expect((await sync.status(id, signal)).outgoing).toBe(false);
});

it("reports the failing Git operation and stderr without exposing credentials", async () => {
  const secret = "private-test-credential";
  const failing = new ProfileSync(store, {
    run: async (spec, log, abort) => {
      if (spec.command === "git") {
        log("stderr", `fatal: authentication failed; credential=${secret}`);
        return { code: 128, notFound: false, timedOut: false };
      }
      return runner.run(spec, log, abort);
    },
  }, { ...process.env, GH_TOKEN: secret });
  const error = await failing.preview(id, "send", signal).catch((e: Error) => e);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("git clone 실패 (종료 코드 128)");
  expect((error as Error).message).toContain("fatal: authentication failed");
  expect((error as Error).message).not.toContain(secret);
});

it("reviews remote settings and PC effects together, detects stale edits and restores both", async () => {
  await model("remote-model");
  const first = id;
  const source = await store.get(first), doc = await readDocument(source);
  doc.files["home/components.v2.json"] = JSON.stringify({ schemaVersion: 2, automatic: true, components: [{ id: "review", name: "Review", description: "Review", kind: "skill", targets: ["claude", "codex"], source: { kind: "profile" }, files: { "SKILL.md": "Remote review instructions" } }] });
  doc.files["home/cli-settings.v1.json"] = JSON.stringify({ schemaVersion: 1, settings: [{ provider: "codex", path: ["model"], operation: "set", value: "remote-codex" }], extensions: [] });
  await writeDocument(source, doc); await send();
  await store.create("second", "default"); id = (await store.active()).id;
  await sync.connect(id, "test/profile", false, signal);
  const profile = await store.active();
  const ctx: InstallContext = { home: root, repoRoot: null, templateRoot: profile.root, setupProfile: profile, profileDir: profile.localDir, profile: "full", claudeHome: path.join(root, "claude"), claudeJson: path.join(root, "claude.json"), codexHome: path.join(root, "codex"), agentsSkillsDir: path.join(root, "agents/skills"), documentsDir: path.join(root, "Documents"), gitScope: { file: path.join(root, "gitconfig") }, env: {}, findExecutable: async () => null, readVersion: async () => null, inspectNodeRuntime: async () => ({ state: "fresh", detail: "fixture", candidates: [], registrations: [], versions: [] } as unknown as NodeRuntimeState), refreshEnvironment: async () => false, now: () => new Date(), selfSource: "github", runner: { run: async () => { throw new Error("unrelated environment installation"); } } };
  const workbench = new WorkbenchService({ stateDir: store.stateDir, context: async () => ctx, providers: [], plugins: async () => ({ plugins: [], blocklist: [] }) });
  const file = path.join(ctx.codexHome, "skills/review/SKILL.md");
  let preview = await workbench.receivePreview(signal, await sync.prepareReceive(id, signal));
  expect(preview.files.some(f => f.path === file)).toBe(true);
  expect(preview.commands).toHaveLength(0);
  expect((await readDocument(profile)).files["home/components.v2.json"]).toBeUndefined();
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, "Concurrent edit");
  await expect(workbench.apply(preview.token)).rejects.toMatchObject({ statusCode: 409 });
  expect((await readDocument(profile)).files["home/components.v2.json"]).toBeUndefined();
  preview = await workbench.receivePreview(signal, await sync.prepareReceive(id, signal));
  await workbench.apply(preview.token);
  expect(await fs.readFile(file, "utf8")).toBe("Remote review instructions");
  expect(JSON.parse(await fs.readFile(path.join(ctx.claudeHome, "settings.json"), "utf8")).model).toBe("remote-model");
  expect(await fs.readFile(path.join(ctx.codexHome, "config.toml"), "utf8")).toContain("remote-codex");
  expect((await sync.status(id, signal)).changed).toBe(false);
  const record = (await workbench.historyList())[0]!;
  await workbench.apply((await workbench.restorePreview(record.id)).token);
  expect((await readDocument(profile)).files["home/components.v2.json"]).toBeUndefined();
  expect(await fs.readFile(file, "utf8")).toBe("Concurrent edit");
}, 40_000);
it("automatically receives ordinary v2 documentation but defers executable and settings changes", async () => {
  const first = id;
  const put = async (body: string, code = false) => {
    const p = await store.get(id), doc = await readDocument(p);
    doc.files["home/components.v2.json"] = JSON.stringify({ schemaVersion: 2, automatic: true, components: [{ id: "review", name: "review", description: "review", kind: "skill", targets: ["claude", "codex"], source: { kind: "profile" }, files: { "SKILL.md": body, ...(code ? { "run.js": "process.exit(0)" } : {}) } }] });
    await writeDocument(p, doc);
  };
  await put("base"); await send();
  await store.create("second", "default"); id = (await store.active()).id; const second = id;
  await sync.connect(id, "test/profile", false, signal); const initial = await sync.preview(id, "receive", signal); await sync.apply(id, initial.token, {}, signal);
  id = first; await put("remote update"); await send();
  expect(await sync.receiveAutomatic(second, signal)).toContain("수신 완료");
  expect((await readDocument(await store.get(second))).files["home/components.v2.json"]).toContain("remote update");
  await put("code update", true); await send();
  expect(await sync.receiveAutomatic(second, signal)).toContain("수동 수신");
  expect((await readDocument(await store.get(second))).files["home/components.v2.json"]).not.toContain("code update");
}, 40_000);
it("round trips through a private remote without app sources and preserves device-only data", async () => {
  await model("first");
  await send();
  expect(head()).not.toBe(null);
  await store.create("second", "default");
  const second = (await store.active()).id;
  await sync.connect(second, "test/profile", false, signal);
  const preview = await sync.preview(second, "receive", signal);
  await sync.apply(second, preview.token, {}, signal);
  expect(
    JSON.parse(
      (await readDocument(await store.get(second))).files[
        "home/claude/settings.managed.json"
      ],
    ).model,
  ).toBe("first");
  expect((await sync.status(second, signal)).changed).toBe(false);
});
it("blocks stale sends and requires explicit conflict choices", async () => {
  await model("base");
  await send();
  const original = id;
  await store.create("second", "default");
  id = (await store.active()).id;
  await sync.connect(id, "test/profile", false, signal);
  let p = await sync.preview(id, "receive", signal);
  await sync.apply(id, p.token, {}, signal);
  await model("remote");
  await send();
  id = original;
  await model("local");
  await expect(sync.preview(id, "send", signal)).rejects.toMatchObject({
    statusCode: 409,
  });
  p = await sync.preview(id, "receive", signal);
  expect(p.conflicts).toContain("files/home/claude/settings.managed.json");
  await expect(sync.apply(id, p.token, {}, signal)).rejects.toMatchObject({
    statusCode: 400,
  });
  await sync.apply(
    id,
    p.token,
    Object.fromEntries(p.conflicts.map((file) => [file, "remote" as const])),
    signal,
  );
  expect(
    JSON.parse(
      (await readDocument(await store.get(id))).files[
        "home/claude/settings.managed.json"
      ],
    ).model,
  ).toBe("remote");
});
it("rechecks privacy, local fingerprints, authentication and cancellation before writing", async () => {
  const p = await sync.preview(id, "send", signal);
  privateRepo = false;
  await expect(sync.apply(id, p.token, {}, signal)).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(head()).toBe(null);
  privateRepo = true;
  await model("changed");
  await expect(sync.apply(id, p.token, {}, signal)).rejects.toMatchObject({
    statusCode: 409,
  });
  deny = true;
  expect((await sync.status(id, signal)).available).toBe(false);
  expect((await store.active()).id).toBe(id);
  deny = false;
  const controller = new AbortController();
  controller.abort();
  await expect(sync.preview(id, "send", controller.signal)).rejects.toThrow(
    "취소",
  );
});
