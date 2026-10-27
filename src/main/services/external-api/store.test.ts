import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundledSkills } from "@shared/external-api/catalog";
import { checkOfficialLinks } from "./health.js";
import { loadExternalApi, refreshExternalApi, snapshotFile } from "./store.js";

let stateDir: string;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-external-api-"));
});
afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

/** k-skill 저장소 트리와 SKILL.md 두 개를 흉내 내는 가짜 GitHub. */
const fakeGitHub: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("/git/trees/")) {
    return new Response(JSON.stringify({ tree: [{ path: "korea-weather/SKILL.md", type: "blob" }, { path: "new-skill/SKILL.md", type: "blob" }] }));
  }
  const name = url.includes("korea-weather") ? "korea-weather" : "new-skill";
  return new Response(`---\nname: ${name}\ndescription: ${name} 설명\nmetadata:\n  category: weather\n---\n# ${name}\n`);
};

describe("외부 API 스냅샷", () => {
  it("저장된 사본이 없으면 번들 스냅샷으로 카탈로그를 만든다", async () => {
    const snapshot = await loadExternalApi(stateDir);
    expect(snapshot).toMatchObject({ skillsSource: "bundled", updatedAt: null });
    expect(snapshot.catalog.sources).toHaveLength(14);
    expect(snapshot.catalog.skills).toHaveLength(bundledSkills.length);
  });

  it("새로고침하면 받은 목록에 보정을 얹어 저장하고, 이후 그 사본이 번들보다 우선한다", async () => {
    const refreshed = await refreshExternalApi(stateDir, fakeGitHub, () => new Date("2026-10-27T00:00:00.000Z"));
    expect(refreshed).toMatchObject({ skillsSource: "refreshed", updatedAt: "2026-10-27T00:00:00.000Z" });
    expect(refreshed.catalog.skills.map((skill) => skill.id)).toEqual(["korea-weather", "new-skill"]);
    // 보정(skill-overrides)이 정보원 연결을 붙이고, 정보원 쪽 skillIds가 거꾸로 계산된다.
    expect(refreshed.catalog.sources.find((source) => source.id === "weather-kma")!.skillIds).toEqual(["korea-weather"]);
    expect((await loadExternalApi(stateDir)).skillsSource).toBe("refreshed");
  });

  it("저장된 사본이 깨졌으면 번들로 되돌리고 경고를 붙인다", async () => {
    fs.mkdirSync(path.dirname(snapshotFile(stateDir)), { recursive: true });
    fs.writeFileSync(snapshotFile(stateDir), JSON.stringify({ schemaVersion: 1, updatedAt: "x", skills: [{ id: "BAD ID" }] }));
    const snapshot = await loadExternalApi(stateDir);
    expect(snapshot.skillsSource).toBe("bundled");
    expect(snapshot.warning).toContain("저장된 k-skill 스냅샷");
  });

  it("받은 목록이 스키마에 맞지 않으면 저장하지 않는다", async () => {
    const broken: typeof fetch = async (input) =>
      String(input).includes("/git/trees/")
        ? new Response(JSON.stringify({ tree: [{ path: "x/SKILL.md", type: "blob" }] }))
        : new Response("no frontmatter");
    await expect(refreshExternalApi(stateDir, broken)).rejects.toThrow();
    expect(fs.existsSync(snapshotFile(stateDir))).toBe(false);
  });

  it("공식 링크 점검: 405는 정상, 실패와 오류는 따로 보인다", async () => {
    const { catalog } = await loadExternalApi(stateDir);
    let call = 0;
    const responses = [405, 200, 404];
    const results = await checkOfficialLinks(catalog, async () => {
      const status = responses[call++ % responses.length]!;
      if (call === 5) throw new Error("timeout");
      return new Response(null, { status });
    });
    expect(results).toHaveLength(14);
    expect(results.filter((result) => !result.ok).length).toBeGreaterThan(0);
    expect(results.some((result) => result.error === "timeout")).toBe(true);
  });
});
