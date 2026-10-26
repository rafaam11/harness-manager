import { describe, expect, it } from "vitest";
import {
  HASH_MARKERS,
  MARKDOWN_MARKERS,
  adoptSectionsIntoBlock,
  mergeManagedJson,
  parseTableHeader,
  patchTomlScalars,
  tomlEntriesFor,
  upsertMarkerBlock,
} from "./merge.js";

describe("mergeManagedJson", () => {
  it("관리 키만 바꾸고, 배열은 템플릿·로컬 항목을 더하며 사용자 항목과 다른 키는 남긴다", () => {
    const current = { model: "sonnet", theme: "dark", permissions: { allow: ["Bash(mine:*)", "Bash(ls:*)"], deny: ["x"] }, other: 1 };
    const next = mergeManagedJson(
      current,
      ["model", "permissions.allow", "language"],
      { model: "opus", permissions: { allow: ["Bash(ls:*)", "Bash(git:*)"] } },
      { permissions: { allow: ["Bash(local:*)"] } },
    );
    expect(next).toEqual({
      model: "opus",
      theme: "dark",
      permissions: { allow: ["Bash(mine:*)", "Bash(ls:*)", "Bash(git:*)", "Bash(local:*)"], deny: ["x"] },
      other: 1,
    });
    expect(current.model).toBe("sonnet");
  });
});

describe("patchTomlScalars", () => {
  const source = [
    "# 내 설정 — 주석은 남아야 한다",
    'model = "old" # 인라인 주석',
    "",
    "[windows]",
    'sandbox = "none"',
    "",
    "[projects.'d:\\dev\\x']",
    'trust_level = "trusted"',
    "",
  ].join("\n");

  it("관리 키 줄만 바꾸고 주석·순서·다른 표는 그대로 둔다", () => {
    const result = patchTomlScalars(source, [
      { path: ["model"], value: "gpt-x" },
      { path: ["windows", "sandbox"], value: "elevated" },
    ]);
    expect(result).toBe(source.replace('model = "old"', 'model = "gpt-x"').replace('sandbox = "none"', 'sandbox = "elevated"'));
  });

  it("없는 루트 키는 첫 표 앞에, 없는 표 키는 그 표 끝에, 없는 표는 파일 끝에 넣는다", () => {
    const result = patchTomlScalars(source, [
      { path: ["personality"], value: "pragmatic" },
      { path: ["windows", "extra"], value: true },
      { path: ["plugins", "a@b", "enabled"], value: true },
    ]);
    expect(result.split("\n")).toEqual([
      "# 내 설정 — 주석은 남아야 한다",
      'model = "old" # 인라인 주석',
      'personality = "pragmatic"',
      "",
      "[windows]",
      'sandbox = "none"',
      "extra = true",
      "",
      "[projects.'d:\\dev\\x']",
      'trust_level = "trusted"',
      "",
      '[plugins."a@b"]',
      "enabled = true",
      "",
    ]);
  });

  it("따옴표 친 표 머리를 키 배열로 읽는다", () => {
    expect(parseTableHeader('[plugins."jinmin-skills@jinmin"]')).toEqual(["plugins", "jinmin-skills@jinmin"]);
    expect(parseTableHeader("[projects.'d:\\dev\\x']")).toEqual(["projects", "d:\\dev\\x"]);
    expect(parseTableHeader("[[array]]")).toBeNull();
  });

  it("표·배열 관리 값은 줄 단위로 고치지 않는다", () => {
    expect(() => tomlEntriesFor(["windows"], { windows: { sandbox: "x" } })).toThrow("스칼라만");
    expect(tomlEntriesFor(["windows.sandbox", "absent"], { windows: { sandbox: "x" } })).toEqual([{ path: ["windows", "sandbox"], value: "x" }]);
  });
});

describe("마커 블록", () => {
  it("블록 안만 바꾸고 밖은 한 글자도 건드리지 않는다", () => {
    const text = `앞\n${MARKDOWN_MARKERS.start}\n옛 내용\n${MARKDOWN_MARKERS.end}\n뒤\n`;
    expect(upsertMarkerBlock(text, "새 내용\n", MARKDOWN_MARKERS)).toBe(`앞\n${MARKDOWN_MARKERS.start}\n새 내용\n${MARKDOWN_MARKERS.end}\n뒤\n`);
  });

  it("블록이 없으면 끝에 붙이고, 빈 파일이면 블록만 쓴다", () => {
    expect(upsertMarkerBlock("$x = 1\n", "Set-Alias g git", HASH_MARKERS)).toBe(
      `$x = 1\n\n${HASH_MARKERS.start}\nSet-Alias g git\n${HASH_MARKERS.end}\n`,
    );
    expect(upsertMarkerBlock("", "a", HASH_MARKERS)).toBe(`${HASH_MARKERS.start}\na\n${HASH_MARKERS.end}\n`);
  });

  it("마커 없던 AGENTS.md는 관리 제목의 섹션을 블록으로 옮기고 개인 섹션은 남긴다", () => {
    const text = "# 개인\n\n- 비밀\n\n## 규약\n\n- 옛 규칙\n";
    expect(adoptSectionsIntoBlock(text, ["규약"], "## 규약\n\n- 새 규칙\n")).toBe(
      `# 개인\n\n- 비밀\n\n${MARKDOWN_MARKERS.start}\n## 규약\n\n- 새 규칙\n${MARKDOWN_MARKERS.end}\n`,
    );
  });
});
