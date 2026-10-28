import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRepairSource, assertPublishable } from "./source.js";
import { processRunner, type CommandRunner } from "../install/exec.js";
import type { InstallContext } from "../install/engine.js";
vi.mock("../repo-sync/cloud.js", () => ({ readCloudRoots: async () => [], isCloudSynced: () => false }));
let root: string;
let bare: string;
let repo: string;
let ctx: InstallContext;
let commands: string[][];
let npmFails: boolean;
let pushFails: boolean;
let pushAllowed: boolean;
let fork: string;
const remote = "https://github.com/rafaam11/harness-manager.git";
const git = (args: string[], cwd?: string) => execFileSync("git", ["-c", "core.hooksPath=", ...args], { cwd, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-source-")); bare = path.join(root, "remote.git"); repo = path.join(root, "repo");
  git(["init", "--bare", "--initial-branch=dev", bare]); git(["clone", bare, repo]);
  await fs.writeFile(path.join(repo, "package.json"), '{"name":"harness-manager"}');
  await fs.writeFile(path.join(repo, ".gitignore"), "node_modules/\nout/\n");
  await fs.mkdir(path.join(repo, "src")); await fs.writeFile(path.join(repo, "src/a.ts"), "export const value = 1;\n");
  git(["add", "."], repo); git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "initial"], repo); git(["push", "origin", "dev"], repo);
  git(["remote", "set-url", "origin", remote], repo);
  ctx = { contribution: "direct", repoRoot: repo, home: path.join(root, "home"), env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" } } as unknown as InstallContext;
  commands = []; npmFails = false; pushFails = false; pushAllowed = true; fork = path.join(root, "fork.git");
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const runner: CommandRunner = { run: async (spec, log, signal) => {
  commands.push([spec.command, ...spec.args]);
  if (spec.command === "gh") {
    if (spec.args.includes("fork") && !await fs.stat(fork).catch(() => null)) git(["clone", "--bare", bare, fork]);
    log("stdout", spec.args[0] === "pr" ? spec.args[1] === "list" ? "" : "https://github.com/rafaam11/harness-manager/pull/1" : spec.args.includes("user") ? JSON.stringify({ login: "test", id: 123 }) : JSON.stringify({ push: pushAllowed }));
    return { code: 0, notFound: false, timedOut: false };
  }
  if (spec.command === "npm") return { code: npmFails ? 1 : 0, notFound: false, timedOut: false };
  if (pushFails && spec.args.includes("push")) return { code: 1, notFound: false, timedOut: false };
  return processRunner.run({ ...spec, args: spec.args.map((arg) => spec.args.includes("clone") && arg === remote ? bare : arg === "https://github.com/test/harness-manager.git" ? fork : arg) }, log, signal);
} };

it("serializes source integration and revalidates concurrent changes before pushing", async () => {
  const prepare = createRepairSource(runner); const signal = new AbortController().signal;
  const first = await prepare(ctx, path.join(root, "state"), signal, vi.fn());
  const second = await prepare(ctx, path.join(root, "state"), signal, vi.fn());
  await fs.writeFile(path.join(first.cwd, "src/first.ts"), "export const first = true;\n");
  await fs.writeFile(path.join(second.cwd, "src/second.ts"), "export const second = true;\n");
  const results = await Promise.all([first.publish(signal, vi.fn()), second.publish(signal, vi.fn())]);
  expect(results.map((result) => result.state)).toEqual(["published", "published"]);
  expect(git(["--git-dir", bare, "ls-tree", "-r", "--name-only", "dev"])).toContain("src/second.ts");
  expect(git(["--git-dir", bare, "ls-tree", "-r", "--name-only", "dev"])).toContain("src/first.ts");
  expect(commands.filter((args) => args[0] === "npm" && args[1] === "test")).toHaveLength(3);
  expect(git(["status", "--porcelain"], repo)).toBe("");
  expect(git(["rev-list", "--count", "HEAD"], repo)).toBe("1");
});
it("retains the fix and never commits or pushes when validation fails", async () => {
  const signal = new AbortController().signal; const source = await createRepairSource(runner)(ctx, path.join(root, "state"), signal, vi.fn());
  await fs.writeFile(path.join(source.cwd, "src/a.ts"), "export const value = 2;\n"); npmFails = true;
  await expect(source.publish(signal, vi.fn())).rejects.toThrow("실패");
  expect(git(["--git-dir", bare, "rev-list", "--count", "dev"])).toBe("1");
  expect(commands.some((args) => args.includes("commit") || args.includes("push"))).toBe(false);
  expect(await fs.readFile(path.join(source.cwd, "src/a.ts"), "utf8")).toContain("2");
});
it("rejects profile files, home paths, private terms, and credentials", () => {
  expect(() => assertPublishable(["manifest/plugins.json"], ["{}"], root, {})).toThrow();
  expect(() => assertPublishable(["src/test.ts"], [root], root, {})).toThrow();
  expect(() => assertPublishable(["src/test.ts"], ["private-company"], root, {}, ["private-company"])).toThrow();
  expect(() => assertPublishable(["src/test.ts"], ["secret-value"], root, { API_KEY: "secret-value" })).toThrow();
  expect(() => assertPublishable(["src/test.ts"], ["export const x = 1"], root, {})).not.toThrow();
});
it("publishes an opted-in public contribution through a fork PR without changing upstream dev", async () => {
  ctx.contribution = "pr"; ctx.repoRoot = null;
  const signal = new AbortController().signal; const source = await createRepairSource(runner)(ctx, path.join(root,"state"),signal,vi.fn());
  await fs.writeFile(path.join(source.cwd,"src/a.ts"),"export const value = 2;\n");
  const result=await source.publish(signal,vi.fn());
  expect(result.url).toContain("/pull/1"); expect(git(["--git-dir",bare,"rev-list","--count","dev"])).toBe("1");
  expect(commands.some((args)=>args.includes("HEAD:refs/heads/dev"))).toBe(false);
  expect(git(["--git-dir",fork,"for-each-ref","--format=%(refname)"])).toContain("refs/heads/hm-repair/");
});
it("checks direct-push permission and resumes a failed push without duplicate commits", async () => {
  const signal=new AbortController().signal;pushAllowed=false;
  const denied=await createRepairSource(runner)(ctx,path.join(root,"denied"),signal,vi.fn());
  expect((await denied.publish(signal,vi.fn())).state).toBe("failed"); expect(commands.some((args)=>args.includes("clone"))).toBe(false);
  pushAllowed=true;const source=await createRepairSource(runner)(ctx,path.join(root,"state"),signal,vi.fn());
  await fs.writeFile(path.join(source.cwd,"src/a.ts"),"export const value = 2;\n");pushFails=true;
  await expect(source.publish(signal,vi.fn())).rejects.toThrow("실패");pushFails=false;
  expect((await source.publish(signal,vi.fn())).state).toBe("published");
  expect(git(["--git-dir",bare,"rev-list","--count","dev"])).toBe("2");
});
