import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest, validateManifestValue } from "./validate.js";

describe("manifest 검사", () => {
  it("레포에 커밋된 manifest/*.json은 모두 통과한다", async () => {
    const reports = await validateManifest(path.resolve(__dirname, "../../../.."));
    for (const report of reports) expect(report, report.path).toMatchObject({ ok: true, errors: [] });
  });

  it("모르는 키는 경고, 형식 오류는 오류다", () => {
    const report = validateManifestValue("packages", {
      schemaVersion: 1,
      packages: [
        { id: "git", source: "winget", name: "Git.Git", profiles: ["core"], future: true },
        { id: "git", source: "brew", name: "", profiles: [] },
      ],
      extra: 1,
    });
    expect(report.ok).toBe(false);
    expect(report.warnings).toEqual(["$: 모르는 키 extra(무시)", "$.packages[0]: 모르는 키 future(무시)"]);
    expect(report.errors).toEqual([
      "$.packages[1].source: winget | scoop | npm | cargo | uv 중 하나여야 합니다",
      "$.packages[1].name: 비어 있지 않은 문자열이어야 합니다",
      "$.packages[1].profiles: 하나 이상 필요합니다",
      "$.packages: 중복: git",
    ]);
  });

  it("공개 레포 원칙: MCP command의 절대경로와 directory 마켓플레이스 소스를 막는다", () => {
    const mcp = validateManifestValue("mcp", {
      schemaVersion: 1,
      servers: [{ name: "x", command: "C:\\Tools\\x.exe", args: [], targets: ["claude"], profiles: ["dev"] }],
    });
    expect(mcp.errors).toEqual(["$.servers[0].command: 절대경로는 쓸 수 없습니다(`~`로 시작하게 쓰세요)"]);
    const plugins = validateManifestValue("plugins", {
      schemaVersion: 1,
      marketplaces: [{ name: "m", source: { kind: "directory", path: "D:\\x" }, providers: ["claude"] }],
      claude: { enabled: ["bad-id"] },
      codex: { enabled: [] },
    });
    expect(plugins.errors).toEqual([
      "$.marketplaces[0].source.kind: self | github | git 중 하나여야 합니다",
      "$.claude.enabled: bad-id은(는) 플러그인@마켓플레이스 형식이 아닙니다",
    ]);
  });

  it("도구 설치 확인은 명령 또는 ~/ 경로 중 하나다", () => {
    const tool = (verify: unknown) => ({ id: "x", name: "X", profiles: ["dev"], install: { kind: "manual", ref: "https://x" }, verify });
    const report = validateManifestValue("tools", {
      schemaVersion: 1,
      tools: [
        tool({ path: "~/AppData/Local/Programs/X/X.exe" }),
        { ...tool({ path: "C:\\Programs\\X.exe" }), id: "y" },
        { ...tool({ path: "~/x", command: "x" }), id: "z" },
      ],
    });
    expect(report.errors).toEqual(["$.tools[1].verify.path: ~/로 시작하는 홈 기준 경로만 씁니다"]);
    expect(report.warnings).toEqual(["$.tools[2].verify: 모르는 키 command(무시)"]);
  });
});
