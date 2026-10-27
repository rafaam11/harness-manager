import { describe, expect, it } from "vitest";
import { GitHubRateLimitError, mergeSkills, parseSkillDocument, syncSkills } from "./sync.js";

const document = `---
name: weather-forecast
description: 기상 예보를 조회한다.
metadata:
  category: weather
---
# Weather

## Credential requirements
- \`DATA_GO_KR_API_KEY\`
`;

describe("k-skill synchronization", () => {
  it("parses frontmatter and derives runtime/auth metadata", () => {
    expect(parseSkillDocument("weather-forecast/SKILL.md", document)).toEqual(expect.objectContaining({
      id: "weather-forecast",
      name: "weather-forecast",
      description: "기상 예보를 조회한다.",
      category: "weather",
      upstreamPath: "weather-forecast/SKILL.md",
      auth: ["DATA_GO_KR_API_KEY"],
    }));
  });

  it("rejects malformed frontmatter", () => {
    expect(() => parseSkillDocument("broken/SKILL.md", "---\nname: [\n---")).toThrow(/frontmatter/i);
  });

  it("merges overrides and removes entries deleted upstream", () => {
    const upstream = [parseSkillDocument("weather-forecast/SKILL.md", document)];
    const merged = mergeSkills(upstream, {
      "weather-forecast": { sourceIds: ["weather-kma"], technologyIds: ["rest-api"] },
      deleted: { description: "must not be created" },
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(expect.objectContaining({ sourceIds: ["weather-kma"], technologyIds: ["rest-api"] }));
  });

  it("reflects added and changed upstream entries", () => {
    const changed = document.replace("기상 예보를 조회한다.", "기상 관측과 예보를 조회한다.");
    const records = mergeSkills([
      parseSkillDocument("weather-forecast/SKILL.md", changed),
      parseSkillDocument("air-quality/SKILL.md", document.replaceAll("weather-forecast", "air-quality")),
    ], {});
    expect(records.map(({ id }) => id)).toEqual(["air-quality", "weather-forecast"]);
    expect(records[1]?.description).toContain("관측과 예보");
  });

  it("surfaces GitHub rate limits without returning a partial snapshot", async () => {
    const fetcher: typeof fetch = async () => new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
    await expect(syncSkills({ fetcher })).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it("includes a repository-root SKILL.md in the complete snapshot", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        return Response.json({ tree: [{ path: "SKILL.md", type: "blob" }, { path: "weather-forecast/SKILL.md", type: "blob" }] });
      }
      return new Response(document);
    };
    const records = await syncSkills({ fetcher });
    expect(records).toHaveLength(2);
  });

  it("excludes test fixtures and gives legacy documents stable path IDs", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        return Response.json({ tree: [
          { path: "weather-forecast/SKILL.md", type: "blob" },
          { path: "legacy/unsupported-skills/weather-forecast/SKILL.md", type: "blob" },
          { path: "tools/qa/test/fixtures/skills/weather-forecast/SKILL.md", type: "blob" },
        ] });
      }
      return new Response(document);
    };
    const records = await syncSkills({ fetcher });
    expect(records.map(({ id }) => id)).toEqual(["legacy-weather-forecast", "weather-forecast"]);
  });
});
