import { describe, expect, it } from "vitest";
import { formatDomain, formatDomains, formatSkillCategory, formatTechnologyCategory } from "./labels.js";

describe("registry labels", () => {
  it.each([
    ["weather", "날씨"], ["public", "공공"], ["mobility", "교통"],
    ["geospatial", "공간정보"], ["statistics", "통계"],
  ])("formats domain %s", (value, label) => expect(formatDomain(value)).toBe(label));

  it.each([
    ["legal-documents", "법률 문서"], ["local-info", "지역 정보"],
    ["public-health", "공중보건"], ["real-estate", "부동산"], ["other", "기타"],
  ])("formats skill category %s", (value, label) => expect(formatSkillCategory(value)).toBe(label));

  it.each([
    ["protocol", "프로토콜"], ["format", "데이터 형식"],
    ["architecture", "아키텍처"], ["auth", "인증"],
  ])("formats technology category %s", (value, label) => expect(formatTechnologyCategory(value)).toBe(label));

  it("joins domains and preserves unknown values", () => {
    expect(formatDomains(["weather", "future-domain"])).toBe("날씨 · future-domain");
    expect(formatSkillCategory("future-category")).toBe("future-category");
  });
});
