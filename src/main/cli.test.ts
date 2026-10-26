import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSyncReport } from "@shared/repo-sync-types";
import { createRemoteFixture, type RemoteFixture } from "./services/repo-sync/test-fixtures.js";

let hmHome: string;

beforeEach(() => {
  hmHome = fs.mkdtempSync(path.join(os.tmpdir(), "hm-cli-home-"));
  vi.stubEnv("HM_HOME", hmHome);
  // config.ts가 HM_HOME을 import 시점에 읽는다.
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(hmHome, { recursive: true, force: true });
});

async function runCli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  const { main } = await import("./cli.js");
  const code = await main(argv);
  vi.restoreAllMocks();
  return { code, stdout, stderr };
}

describe("hm repos", () => {
  it("사용법 오류는 종료 코드 2와 stderr 안내다", async () => {
    expect((await runCli(["repos", "sync"])).code).toBe(2);
    const unknown = await runCli(["repos", "sync", "--paths", "x", "--bogus"]);
    expect(unknown).toMatchObject({ code: 2, stdout: "" });
    expect(unknown.stderr).toContain("--bogus");
    expect((await runCli(["nope"])).code).toBe(2);
  });

  it("stdin JSON 요청을 검증한다", async () => {
    const { applyStdinRequest, parseArgs } = await import("./cli.js");
    const base = parseArgs(["repos", "sync", "--stdin", "--json"]);
    expect(applyStdinRequest(base, '{"paths":["D:\\\\a b\\\\레포"],"force":true,"waitMs":3000}')).toMatchObject({
      paths: ["D:\\a b\\레포"],
      force: true,
      waitMs: 3000,
      json: true,
    });
    expect(() => applyStdinRequest(base, '{"paths":[]}')).not.toThrow();
    expect(() => applyStdinRequest(base, '{"paths":"x"}')).toThrow();
    expect(() => applyStdinRequest(base, "not json")).toThrow();
  });

  describe("실제 git", () => {
    let fx: RemoteFixture;
    beforeEach(() => {
      fx = createRemoteFixture();
    });
    afterEach(() => fx.cleanup());

    it("sync --json은 한 줄 JSON 보고서를 내고 HM_HOME 아래에 기록한다", async () => {
      fx.pushFromOther(1);
      const { code, stdout } = await runCli(["repos", "sync", "--json", "--label", "시험", "--paths", fx.work]);
      expect(code).toBe(0);
      expect(stdout.trim().split("\n")).toHaveLength(1);
      const report = JSON.parse(stdout) as RepoSyncReport;
      expect(report).toMatchObject({ schemaVersion: 1, label: "시험", pending: [] });
      expect(report.results[0]).toMatchObject({ status: "updated", commits: 1 });
      expect(report.summary).toContain("1개 최신화");
      expect(fs.existsSync(path.join(hmHome, ".harness-manager", "repo-sync", "state.json"))).toBe(true);

      const summary = await runCli(["repos", "summary", "--json", "--paths", fx.work]);
      expect(JSON.parse(summary.stdout).results[0]).toMatchObject({ status: "updated", cached: true });
    });
  });
});
