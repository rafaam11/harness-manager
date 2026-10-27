import { describe, expect, it } from "vitest";
import { catalogSchema, validateCatalog } from "./schema.js";

const source = {
  id: "weather-kma",
  name: "기상청",
  operator: "기상청",
  summary: "예보와 관측 정보를 제공한다.",
  officialUrl: "https://www.weather.go.kr/",
  docsUrl: "https://apihub.kma.go.kr/",
  domains: ["weather"],
  data: [{ name: "단기예보", fields: ["기온", "강수확률"] }],
  delivery: ["open-api"],
  formats: ["JSON", "XML"],
  auth: "api-key",
  cost: "free",
  cors: "server-only",
  updateFrequency: "매시간",
  realtime: "hourly",
  geography: ["nationwide"],
  termsUrl: "https://www.weather.go.kr/w/guide/copyright.do",
  technologyIds: ["rest-api"],
  home: { x: 40, y: 30, lines: ["weather"] },
  previewAdapterId: "weather",
  skillIds: [],
  blueprintIds: ["commute-condition"],
  keywords: ["날씨"],
  lastVerifiedAt: "2026-07-17",
};

const blueprint = {
  id: "commute-condition",
  name: "출퇴근 컨디션",
  problem: "출발 전 날씨와 교통 상태를 함께 확인한다.",
  users: ["대중교통 통근자"],
  inputs: ["출발지", "도착지"],
  outputs: ["이동 컨디션 요약"],
  sourceIds: ["weather-kma"],
  flow: ["서버에서 예보 조회", "정규화", "요약 표시"],
  stack: ["TypeScript", "서버 함수"],
  mvpSteps: ["예보 연결", "교통 연결"],
  risks: ["API 장애"],
  privacy: ["좌표는 요청 처리 후 저장하지 않음"],
  fallback: ["공식 예보 링크 제공"],
  examples: { node: "process.env.DATA_GO_KR_API_KEY", python: "os.environ['DATA_GO_KR_API_KEY']" },
};

const technology = { id: "rest-api", name: "REST API", category: "protocol", summary: "HTTP 기반 데이터 호출" };

describe("catalog schema", () => {
  it("accepts a complete catalog", () => {
    expect(catalogSchema.parse({ sources: [source], skills: [], blueprints: [blueprint], technologies: [technology] })).toBeTruthy();
  });

  it.each([
    ["invalid URL", { ...source, officialUrl: "weather" }],
    ["invalid date", { ...source, lastVerifiedAt: "17-07-2026" }],
    ["invalid coordinates", { ...source, home: { ...source.home, x: 101 } }],
  ])("rejects %s", (_label, invalidSource) => {
    expect(() => catalogSchema.parse({ sources: [invalidSource], skills: [], blueprints: [blueprint], technologies: [technology] })).toThrow();
  });

  it("rejects duplicate IDs and broken relationships", () => {
    const result = validateCatalog({ sources: [source, source], skills: [], blueprints: [{ ...blueprint, sourceIds: ["missing"] }], technologies: [technology] });
    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toMatch(/duplicate source id/i);
    expect(result.errors.join(" ")).toMatch(/missing source/i);
  });

  it("rejects verification dates older than the configured age", () => {
    const result = validateCatalog({ sources: [{ ...source, lastVerifiedAt: "2025-01-01" }], skills: [], blueprints: [blueprint], technologies: [technology] }, { today: "2026-07-17", maxAgeDays: 365 });
    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toMatch(/stale/i);
  });
});
