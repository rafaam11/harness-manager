import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 스타일 계약(M13). 색은 theme-colors.css 토큰으로만 쓰고, v2 별칭과 죽은 CSS가 다시 쌓이지 않게 한다.
 * typography·motion 계약과 같이 소스 파일을 직접 읽어 검사한다.
 */
const root = resolve("src/renderer/src");
const stylesheet = readFileSync(join(root, "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}
const code = sources(root).map((file) => readFileSync(file, "utf8")).join("\n");

/** v2 화면이 쓰던 색 별칭. 지금은 theme-colors.css 토큰을 직접 쓴다. */
const V2_ALIASES = [
  "--panel", "--card", "--border", "--accent", "--active-bg", "--editor-bg", "--hover", "--text-dim",
  "--shadow", "--on-accent", "--ok", "--ok-bg", "--warn", "--warn-bg", "--warn-border", "--err", "--err-bg", "--danger",
];

/**
 * 코드가 이름을 조립해 붙이는 클래스의 접두. 이 접두로 시작하는 선택자는 TSX에 그대로 나오지 않아도 된다.
 * 예: `toast-${tone}`, `bdg-${kind}`, provider-ui의 `provider-${id}`, UpdateBadge의 `update-status ${state}`.
 */
const DYNAMIC_PREFIXES = ["toast-", "bdg-", "provider-", "jse-", "md-body"];
const DYNAMIC_STATES = ["downloaded", "available", "error", "spinning", "ok", "warn", "fail", "info", "selected", "muted", "active", "open", "visible"];

describe("style contract", () => {
  it("index.css에는 색 리터럴이 없다(그림자의 검정 투명도만 예외)", () => {
    const literals = [...stylesheet.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)]
      .map(([value]) => value)
      .filter((value) => !/^rgb\(0 0 0 \/ \d+%\)$/.test(value));
    expect(literals).toEqual([]);
  });

  it("v2 색 별칭을 어디서도 쓰지 않는다", () => {
    const pattern = new RegExp(`var\\((${V2_ALIASES.join("|")})[,)]`, "g");
    expect([...stylesheet.matchAll(pattern)].map(([value]) => value)).toEqual([]);
    expect([...code.matchAll(pattern)].map(([value]) => value)).toEqual([]);
  });

  it("index.css의 클래스는 모두 코드 어딘가에서 쓰인다", () => {
    const classes = [...new Set([...stylesheet.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(([, name]) => name))];
    const unused = classes.filter((name) => {
      if (DYNAMIC_PREFIXES.some((prefix) => name.startsWith(prefix)) || DYNAMIC_STATES.includes(name)) return false;
      // 템플릿 문자열에서는 이름 바로 뒤에 `${…}`가 붙는다(`cat-master-item${active}`).
      return !new RegExp(`(["'\` ])${name.replace(/-/g, "\\-")}(["'\` $]|$)`, "m").test(code);
    });
    expect(unused).toEqual([]);
  });
});
