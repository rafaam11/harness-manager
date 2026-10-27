import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CommandRunner } from "../install/exec.js";

// config.ts가 import 시점에 HM_HOME을 읽으므로, 실제 ~/.harness-manager를 건드리지 않게 먼저 임시 홈을 건다.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "hm-repo-loc-"));
process.env.HM_HOME = home;
const { cloneRepo, discoverRepoRoot, REPO_CLONE_URL } = await import("./capture.js");
const { REPO_LOCATION_FILE } = await import("../../config.js");

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

function makeRepo(dir: string): void {
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "harness-manager" }));
  fs.writeFileSync(path.join(dir, ".claude-plugin", "marketplace.json"), "{}");
}

describe("discoverRepoRoot", () => {
  it("jinmin 마켓플레이스의 directory 소스를 먼저 본다", async () => {
    const root = fs.mkdtempSync(path.join(home, "disc-"));
    const repo = path.join(root, "somewhere", "hm");
    makeRepo(repo);
    const claudeHome = path.join(root, ".claude");
    fs.mkdirSync(path.join(claudeHome, "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(claudeHome, "plugins", "known_marketplaces.json"),
      JSON.stringify({ jinmin: { source: { source: "directory", path: repo } } }),
    );
    expect(await discoverRepoRoot({ home: root, claudeHome, roots: [] })).toBe(path.resolve(repo));
  });

  it("흔한 작업 폴더 아래 harness-manager를 찾고, 없으면 null", async () => {
    const root = fs.mkdtempSync(path.join(home, "disc-"));
    const claudeHome = path.join(root, ".claude");
    const devRoot = path.join(root, "dev");
    expect(await discoverRepoRoot({ home: root, claudeHome, roots: [devRoot] })).toBeNull();
    makeRepo(path.join(devRoot, "harness-manager"));
    expect(await discoverRepoRoot({ home: root, claudeHome, roots: [devRoot] })).toBe(path.join(devRoot, "harness-manager"));
  });
});

describe("cloneRepo", () => {
  const fakeRunner = (onRun: (args: string[]) => number): CommandRunner & { calls: string[][] } => {
    const calls: string[][] = [];
    return {
      calls,
      run: async (spec) => {
        calls.push([spec.command, ...spec.args]);
        return { code: onRun(spec.args), timedOut: false, notFound: false };
      },
    };
  };

  it("정해진 주소만 받고, 받은 위치를 기억한다", async () => {
    const target = path.join(home, "clone-ok", "harness-manager");
    const runner = fakeRunner((args) => {
      makeRepo(args[2]!);
      return 0;
    });
    expect(await cloneRepo(runner, target)).toBe(path.resolve(target));
    expect(runner.calls).toEqual([["git", "clone", REPO_CLONE_URL, target]]);
    expect(JSON.parse(fs.readFileSync(REPO_LOCATION_FILE, "utf8")).path).toBe(path.resolve(target));
  });

  it("이미 클론이 있으면 받지 않고 기억만 한다", async () => {
    const target = path.join(home, "clone-exists", "harness-manager");
    makeRepo(target);
    const runner = fakeRunner(() => 0);
    expect(await cloneRepo(runner, target)).toBe(path.resolve(target));
    expect(runner.calls).toEqual([]);
  });

  it("다른 파일이 든 폴더에는 받지 않는다", async () => {
    const target = path.join(home, "clone-busy", "harness-manager");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "mine.txt"), "x");
    const runner = fakeRunner(() => 0);
    await expect(cloneRepo(runner, target)).rejects.toMatchObject({ statusCode: 409 });
    expect(runner.calls).toEqual([]);
  });

  it("git이 실패하면 422로 알린다", async () => {
    const target = path.join(home, "clone-fail", "harness-manager");
    await expect(cloneRepo(fakeRunner(() => 128), target)).rejects.toMatchObject({ statusCode: 422 });
  });
});
