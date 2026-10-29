import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SetupProfileStore } from "./setup-profiles.js";
import { ProfileSync } from "./profile-sync.js";
import { readDocument, writeDocument } from "./profile-document.js";
import { processRunner, type CommandRunner } from "./install/exec.js";
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
