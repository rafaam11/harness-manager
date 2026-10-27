import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
let repo: string;

function write(file: string, content: string | object): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** 대상이 지워진 디렉터리 링크. junction은 관리자 권한 없이 만들 수 있다. */
function brokenLink(link: string): void {
  const target = path.join(home, "gone", path.basename(link));
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, "junction");
  fs.rmSync(target, { recursive: true });
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "hm-cleanup-"));
  repo = path.join(home, "repo");
  // config.ts가 HM_HOME을 import 시점에 읽는다. 실제 홈의 ~/.claude를 절대 건드리지 않게 모듈을 새로 읽는다.
  vi.stubEnv("HM_HOME", home);
  vi.stubEnv("CODEX_HOME", "");
  vi.resetModules();

  write(path.join(repo, "plugins", "jinmin-skills", "skills", "agents-md-sync", "SKILL.md"), "x");
  write(path.join(home, ".claude", "settings.json"), { enabledPlugins: { "jinmin-skills@jinmin": true } });
  write(path.join(home, ".claude", "skills", "agents-md-sync", "SKILL.md"), "old copy");
  write(path.join(home, ".claude", "skills", "keep-me", "SKILL.md"), "loose skill that no plugin provides");
  brokenLink(path.join(home, ".claude", "skills", "broken"));
  brokenLink(path.join(home, ".agents", "skills", "also-broken"));
  write(path.join(home, ".claude", "plugins", "cache", "claude-hud", "0.1.0", "x.js"), "x");
  write(path.join(home, ".harness-manager", "board.json"), "{}");
  const oldLog = path.join(home, ".codex", "log", "codex-tui.log");
  write(oldLog, "log");
  const old = new Date(Date.now() - 40 * 86_400_000);
  fs.utimesSync(oldLog, old, old);
  write(path.join(home, ".codex", "log", "fresh.log"), "log");
  write(path.join(home, ".codex", "sessions", "2026", "s.jsonl"), "session");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("v3 정리 후보와 아카이브 왕복", () => {
  it("깨진 링크·중복 스킬·남은 흔적·오래된 Codex 로그를 후보로 내고, 세션 기록과 남의 스킬은 건드리지 않는다", async () => {
    const { scanCandidates } = await import("./scan.js");
    const candidates = await scanCandidates({ repoRoot: repo });
    const byCategory = (category: string) => candidates.filter((candidate) => candidate.category === category).map((candidate) => path.relative(home, candidate.path));
    expect(byCategory("broken-links").sort()).toEqual([path.join(".agents", "skills", "also-broken"), path.join(".claude", "skills", "broken")].sort());
    expect(byCategory("duplicate-skills")).toEqual([path.join(".claude", "skills", "agents-md-sync")]);
    expect(byCategory("leftovers").sort()).toEqual([path.join(".claude", "plugins", "cache", "claude-hud"), path.join(".harness-manager", "board.json")].sort());
    expect(byCategory("codex-logs")).toEqual([path.join(".codex", "log", "codex-tui.log")]);
    expect(candidates.some((candidate) => candidate.path.includes("keep-me") || candidate.path.includes("sessions"))).toBe(false);
  });

  it("레포를 모르거나 플러그인이 꺼져 있으면 중복 스킬을 후보로 내지 않는다", async () => {
    const { scanCandidates } = await import("./scan.js");
    expect((await scanCandidates({ repoRoot: null })).some((candidate) => candidate.category === "duplicate-skills")).toBe(false);
    write(path.join(home, ".claude", "settings.json"), { enabledPlugins: { "jinmin-skills@jinmin": false } });
    expect((await scanCandidates({ repoRoot: repo })).some((candidate) => candidate.category === "duplicate-skills")).toBe(false);
  });

  it("아카이브로 옮긴 뒤 원위치로 복구하면 링크는 링크로, 폴더는 내용 그대로 돌아온다", async () => {
    const { scanCandidates } = await import("./scan.js");
    const { archiveItems, restoreItem, listManifests } = await import("../lib/archive.js");
    const candidates = await scanCandidates({ repoRoot: repo });
    const categories = [...new Set(candidates.map((candidate) => candidate.category))];
    const moved = [];
    for (const category of categories) {
      const items = candidates.filter((candidate) => candidate.category === category);
      moved.push(...(await archiveItems(items.map((item) => ({ path: item.path, reason: item.reason })), category)));
    }
    expect(moved).toHaveLength(candidates.length);
    for (const entry of moved) {
      expect(fs.existsSync(entry.original) || isLink(entry.original)).toBe(false);
      expect(entry.archived.startsWith(path.join(home, ".claude", "archive"))).toBe(true);
    }
    expect((await listManifests())[0]!.entries).toHaveLength(candidates.length);

    for (const entry of moved) await restoreItem(entry.archived);
    expect(isLink(path.join(home, ".claude", "skills", "broken"))).toBe(true);
    expect(isLink(path.join(home, ".agents", "skills", "also-broken"))).toBe(true);
    expect(fs.readFileSync(path.join(home, ".claude", "skills", "agents-md-sync", "SKILL.md"), "utf8")).toBe("old copy");
    expect(fs.existsSync(path.join(home, ".claude", "plugins", "cache", "claude-hud", "0.1.0", "x.js"))).toBe(true);
    expect(await listManifests()).toEqual([]);
  });

  it("정해진 분류 밖으로는 옮기지 않는다", async () => {
    const { archiveItems } = await import("../lib/archive.js");
    await expect(archiveItems([{ path: path.join(home, ".claude", "skills", "keep-me"), reason: "x" }], "anything")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

function isLink(target: string): boolean {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}
