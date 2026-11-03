// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import ProfileFields from "./ProfileFields";
import type { Value } from "./ProfileTables";

afterEach(cleanup);

/** 실제 화면처럼 파일 글자를 들고 렌더마다 다시 파싱해, 값 객체가 매번 새것이어도 입력이 유지되는지 본다. */
function setup(
  initial: Value,
  props: {
    label?: string;
    flatKeys?: boolean;
    disabled?: boolean;
  } = {},
) {
  const latest: { value: Value } = { value: initial };
  const onValue = vi.fn((next: Value) => {
    latest.value = next;
  });
  function Harness() {
    const [text, setText] = useState(JSON.stringify(initial));
    return (
      <ProfileFields
        {...props}
        value={JSON.parse(text) as Value}
        onChange={(next) => {
          onValue(next);
          setText(JSON.stringify(next));
        }}
      />
    );
  }
  render(<Harness />);
  return { latest, onValue };
}

const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const type = (name: string, value: string) =>
  fireEvent.change(input(name), { target: { value } });
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

const packages = (entry: Record<string, Value>) => ({
  schemaVersion: 1,
  packages: [
    {
      id: "a",
      source: "winget",
      name: "A",
      profiles: ["core"],
      ...entry,
    },
  ],
});

it("keeps unknown keys, unknown option values and schemaVersion when a cell changes", () => {
  const { latest } = setup(
    packages({
      source: "custom-source",
      profiles: ["core", "custom"],
      extra: { x: 1 },
    }),
  );
  expect(input("a 소스").value).toBe("custom-source");
  type("a 패키지 이름", "B");
  fireEvent.click(input("a 설치 범위 dev"));
  fireEvent.click(input("a 설치 범위 core"));
  expect(latest.value).toEqual({
    schemaVersion: 1,
    packages: [
      {
        id: "a",
        source: "custom-source",
        name: "B",
        profiles: ["dev", "custom"],
        extra: { x: 1 },
      },
    ],
  });
});

it("shows common attributes once in the table head instead of per row", () => {
  setup({
    schemaVersion: 1,
    packages: [
      { id: "a", source: "winget", name: "A", profiles: ["core"] },
      { id: "b", source: "winget", name: "B", profiles: ["dev"] },
    ],
  });
  expect(screen.getAllByRole("columnheader", { name: "core" })).toHaveLength(1);
  expect(screen.getAllByRole("columnheader", { name: "설치 범위" })).toHaveLength(
    1,
  );
  expect(input("a 설치 범위 core").checked).toBe(true);
  expect(input("b 설치 범위 core").checked).toBe(false);
});

it("shows an empty message for a table without rows and adds a row with focus", () => {
  const { latest } = setup({ schemaVersion: 1, packages: [] });
  expect(screen.getByText("항목이 없습니다.")).toBeTruthy();
  click("항목 추가");
  expect(document.activeElement).toBe(input("new-package 식별자"));
  expect(latest.value).toEqual({
    schemaVersion: 1,
    packages: [
      {
        id: "new-package",
        source: "winget",
        name: "Publisher.Package",
        profiles: ["core", "dev", "full"],
        bin: "command",
      },
    ],
  });
});

it("keeps focus while typing, even when the row name changes with the value", () => {
  setup(packages({}));
  const cell = input("a 식별자");
  cell.focus();
  type("a 식별자", "renamed");
  expect(input("renamed 식별자")).toBe(cell);
  expect(document.activeElement).toBe(cell);
});

it("removes an optional column key instead of saving an empty string", () => {
  const { latest } = setup(packages({ bin: "tool" }));
  type("a 실행 파일", "");
  expect(latest.value).toEqual(packages({}));
  type("a 실행 파일", "tool2");
  expect(latest.value).toEqual(packages({ bin: "tool2" }));
});

it("keeps optional detail keys out of the file until they have a value", () => {
  const { latest } = setup(packages({}));
  click("a 상세 열기");
  expect(screen.getByRole("button", { name: "a 상세 닫기" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  type("a 설명", "설명 값");
  expect(latest.value).toEqual(packages({ description: "설명 값" }));
  type("a 설명", "");
  expect(latest.value).toEqual(packages({}));
});

it("edits nested columns and detail values without disturbing each other", () => {
  const tool = {
    id: "t",
    name: "T",
    profiles: ["core"],
    install: { kind: "manual", ref: "old", extra: 1 },
    verify: { command: "t", args: ["--version"] },
  };
  const { latest } = setup({ schemaVersion: 1, tools: [tool] });
  type("t 설치 주소", "new");
  click("t 상세 열기");
  type("t 설치 확인 명령", "t2");
  type("t 설치 확인 인자 1", "-v");
  expect(latest.value).toEqual({
    schemaVersion: 1,
    tools: [
      {
        ...tool,
        install: { kind: "manual", ref: "new", extra: 1 },
        verify: { command: "t2", args: ["-v"] },
      },
    ],
  });
});

it("masks secrets in row details and keeps dotted env keys flat", () => {
  const server = {
    name: "s",
    command: "npx",
    args: ["-y"],
    env: { API_TOKEN: "hidden", PLACEHOLDER_TOKEN: "${TOKEN}" },
    targets: ["claude"],
    profiles: ["core"],
  };
  const { latest } = setup({ schemaVersion: 1, servers: [server] });
  click("s 상세 열기");
  expect(input("s API_TOKEN").type).toBe("password");
  expect(input("s PLACEHOLDER_TOKEN").type).toBe("text");
  type("s API_TOKEN", "changed");
  type("s 환경변수 (값은 ${이름} 사용) 새 키", "MY.KEY");
  click("키 추가");
  expect(latest.value).toEqual({
    schemaVersion: 1,
    servers: [
      {
        ...server,
        env: {
          API_TOKEN: "changed",
          PLACEHOLDER_TOKEN: "${TOKEN}",
          "MY.KEY": "",
        },
      },
    ],
  });
});

it("masks secrets on flattened paths", () => {
  setup({ auth: { password: "hidden" }, apiToken: "hidden", name: "shown" });
  expect(input("auth.password").type).toBe("password");
  expect(input("apiToken").type).toBe("password");
  expect(input("이름").type).toBe("text");
  // 툴팁은 잘린 값을 보여 주는 용도이므로 가린 값이 그쪽으로 새면 안 된다.
  expect(input("이름").title).toBe("shown");
  expect(input("auth.password").title).toBe("");
  expect(input("apiToken").title).toBe("");
});

it("flattens nested settings and removes emptied parents", () => {
  const { latest } = setup({
    model: "old",
    worktree: { baseRef: "main" },
    keep: {},
  });
  expect(input("모델").value).toBe("old");
  type("worktree.baseRef", "dev");
  expect(latest.value).toEqual({
    model: "old",
    worktree: { baseRef: "dev" },
    keep: {},
  });
  click("worktree.baseRef 관리 해제");
  expect(latest.value).toEqual({ model: "old", keep: {} });
  expect(screen.getByText("빈 객체")).toBeTruthy();
});

it("splits new keys on dots and blocks forbidden or existing paths", () => {
  const { latest } = setup({ model: "old" }, { label: "설정" });
  const add = () => screen.getByRole("button", { name: "키 추가" });
  for (const blocked of [
    "__proto__",
    "a.constructor.b",
    "prototype",
    "model",
    "model.child",
    "a..b",
  ]) {
    type("설정 새 키", blocked);
    expect(add()).toBeDisabled();
  }
  type("설정 새 키", "worktree.baseRef");
  fireEvent.click(add());
  expect(latest.value).toEqual({
    model: "old",
    worktree: { baseRef: "" },
  });
});

it("keeps dotted keys whole in flat-key files such as the git config", () => {
  const { latest } = setup(
    { "user.name": "old" },
    { label: "Git", flatKeys: true },
  );
  type("user.name", "new");
  type("Git 새 키", "core.editor");
  click("키 추가");
  expect(latest.value).toEqual({ "user.name": "new", "core.editor": "" });
  click("user.name 관리 해제");
  expect(latest.value).toEqual({ "core.editor": "" });
});

it("does not offer add or remove on documents with a fixed schema", () => {
  setup({ schemaVersion: 1, model: "old" }, { label: "설정" });
  expect(input("모델").value).toBe("old");
  expect(screen.queryByLabelText("설정 새 키")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "model 관리 해제" }),
  ).toBeNull();
});

it("builds a plugin table from both providers and keeps a fully unchecked row", () => {
  const { latest } = setup({
    schemaVersion: 1,
    marketplaces: [],
    claude: { enabled: ["a@m", "b@m"], other: 1 },
    codex: { enabled: ["b@m", "c@m"] },
  });
  expect(screen.getByRole("columnheader", { name: "플러그인 3" })).toBeTruthy();
  expect(input("a@m Claude").checked).toBe(true);
  expect(input("a@m Codex").checked).toBe(false);
  expect(input("b@m Codex").checked).toBe(true);
  expect(input("c@m Claude").checked).toBe(false);
  fireEvent.click(input("a@m Claude"));
  expect(input("a@m Claude").checked).toBe(false);
  expect(latest.value).toMatchObject({
    claude: { enabled: ["b@m"], other: 1 },
  });
  // 오조작을 되돌리면 파일이 원래 순서로 돌아와 변경으로 세지 않는다.
  fireEvent.click(input("a@m Claude"));
  expect(latest.value).toEqual({
    schemaVersion: 1,
    marketplaces: [],
    claude: { enabled: ["a@m", "b@m"], other: 1 },
    codex: { enabled: ["b@m", "c@m"] },
  });
});

it("adds a plugin to one provider and refuses duplicates", () => {
  const { latest } = setup({
    schemaVersion: 1,
    claude: { enabled: ["a@m"] },
    codex: { enabled: [] },
  });
  type("추가할 플러그인", "a@m");
  expect(screen.getByRole("button", { name: "Claude에 추가" })).toBeDisabled();
  type("추가할 플러그인", "github@openai-curated");
  click("Codex에 추가");
  expect(latest.value).toEqual({
    schemaVersion: 1,
    claude: { enabled: ["a@m"] },
    codex: { enabled: ["github@openai-curated"] },
  });
  expect(input("github@openai-curated Codex").checked).toBe(true);
});

it("recognizes the same plugin structure below another key", () => {
  const { latest } = setup({
    plugins: { claude: { enabled: ["a@m"] }, codex: { enabled: [] } },
  });
  fireEvent.click(input("a@m Codex"));
  expect(latest.value).toEqual({
    plugins: { claude: { enabled: ["a@m"] }, codex: { enabled: ["a@m"] } },
  });
});

it("changes only the keys of the chosen marketplace source kind", () => {
  const { latest } = setup({
    schemaVersion: 1,
    marketplaces: [
      {
        name: "m",
        source: { kind: "github", repo: "o/r", extra: 1 },
        providers: ["claude"],
      },
    ],
  });
  const source = () =>
    (latest.value as { marketplaces: { source: Value }[] }).marketplaces[0]
      .source;
  type("m 저장소 또는 주소", "o/r2");
  expect(source()).toEqual({ kind: "github", repo: "o/r2", extra: 1 });
  type("m 소스 종류", "git");
  expect(source()).toEqual({ extra: 1, kind: "git", url: "" });
  type("m 저장소 또는 주소", "https://example.com/r.git");
  expect(source()).toEqual({
    extra: 1,
    kind: "git",
    url: "https://example.com/r.git",
  });
  type("m 소스 종류", "self");
  expect(source()).toEqual({ extra: 1, kind: "self" });
  expect(input("m 저장소 또는 주소")).toBeDisabled();
});

it("shows arrays of objects without a known shape as a table", () => {
  const { latest } = setup({
    schemaVersion: 1,
    items: [
      { id: "a", count: 1, flag: true, profiles: ["core"] },
      { id: "b", count: 2, flag: false, profiles: [] },
    ],
  });
  type("a count", "5");
  fireEvent.click(input("b flag"));
  fireEvent.click(input("b 설치 범위 full"));
  expect(latest.value).toEqual({
    schemaVersion: 1,
    items: [
      { id: "a", count: 5, flag: true, profiles: ["core"] },
      { id: "b", count: 2, flag: true, profiles: ["full"] },
    ],
  });
});

it("lays out key lists side by side and edits each list alone", () => {
  const { latest } = setup({
    schemaVersion: 1,
    claudeSettings: ["a"],
    codexConfig: ["b", "c"],
  });
  click("Codex 관리 키 1 빼기");
  type("Claude 관리 키 1", "z");
  expect(latest.value).toEqual({
    schemaVersion: 1,
    claudeSettings: ["z"],
    codexConfig: ["c"],
  });
});

it("keeps line breaks of multi-line strings", () => {
  const { latest } = setup({ note: "a\nb" });
  const area = screen.getByLabelText("note");
  expect(area.tagName).toBe("TEXTAREA");
  fireEvent.change(area, { target: { value: "a\nc" } });
  expect(latest.value).toEqual({ note: "a\nc" });
});

it("leaves TOML dates untouched when another value changes", () => {
  const at = new Date("2026-01-02T03:04:05.000Z");
  const onChange = vi.fn();
  render(
    <ProfileFields
      value={{ at, model: "old" } as unknown as Value}
      onChange={onChange}
    />,
  );
  expect(screen.getByText(at.toISOString())).toBeTruthy();
  type("모델", "new");
  expect(onChange.mock.calls[0][0].at).toBe(at);
  expect(onChange.mock.calls[0][0].model).toBe("new");
});

it("disables every editor but still lets read-only users open row details", () => {
  setup(packages({ description: "설명 값" }), { disabled: true });
  for (const control of [
    input("a 식별자"),
    input("a 소스"),
    input("a 설치 범위 core"),
    screen.getByRole("button", { name: "a 빼기" }),
    screen.getByRole("button", { name: "항목 추가" }),
  ])
    expect(control).toBeDisabled();
  click("a 상세 열기");
  expect(input("a 설명")).toBeDisabled();
  expect(input("a 설명").value).toBe("설명 값");
});
