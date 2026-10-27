import { describe, expect, it } from "vitest";
import { catalog } from "./catalog.js";
import { validateCatalog } from "./schema.js";

describe("curated catalog", () => {
  it("contains the fixed first-release inventory", () => {
    expect(catalog.sources).toHaveLength(14);
    expect(catalog.blueprints).toHaveLength(6);
    expect(catalog.skills.length).toBeGreaterThan(100);
    expect(catalog.sources.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "data-go-kr", "kosis", "seoul-open-data", "localdata", "weather-kma", "airkorea", "tago", "topis",
      "vworld", "juso", "kakao-local-mobility", "naver-search-map", "e-gen", "culture-kopis",
    ]));
  });

  it("has valid bidirectional relationships and fresh verification dates", () => {
    expect(validateCatalog(catalog, { today: "2026-07-17", maxAgeDays: 365 })).toEqual(expect.objectContaining({ success: true }));
    for (const blueprint of catalog.blueprints) {
      for (const sourceId of blueprint.sourceIds) {
        expect(catalog.sources.find(({ id }) => id === sourceId)?.blueprintIds).toContain(blueprint.id);
      }
    }

    const linkedSkills = catalog.skills.filter(({ sourceIds }) => sourceIds.length > 0);
    expect(linkedSkills.length).toBeGreaterThanOrEqual(12);
    for (const skill of linkedSkills) {
      for (const sourceId of skill.sourceIds) {
        expect(catalog.sources.find(({ id }) => id === sourceId)?.skillIds).toContain(skill.id);
      }
    }
  });

  it("keeps all secret-bearing examples on server environment variables", () => {
    for (const blueprint of catalog.blueprints) {
      expect(blueprint.examples.node).toMatch(/process\.env\./);
      expect(blueprint.examples.python).toMatch(/os\.environ/);
      expect(`${blueprint.examples.node}${blueprint.examples.python}`).not.toMatch(/[A-Za-z0-9_-]{32,}/);
    }
  });
});
