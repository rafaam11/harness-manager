import { parseTOML, getStaticTOMLValue } from "toml-eslint-parser";
import { parse, stringify } from "smol-toml";
import type { SettingIntent, JsonValue } from "@shared/cli-settings-types";
import { getValue, setValue } from "./definition.js";
const keyText = (key: string) => /^[\w-]+$/.test(key) ? key : JSON.stringify(key);
function valueText(value: JsonValue): string {
  if (Array.isArray(value)) return "[" + value.map(valueText).join(", ") + "]";
  if (value && typeof value === "object") return "{ " + Object.entries(value).map(([key, v]) => `${keyText(key)} = ${valueText(v)}`).join(", ") + " }";
  if (value === null) throw new Error("TOML은 null을 지원하지 않습니다. 기본값 사용을 선택하세요.");
  return JSON.stringify(value);
}
/** AST가 가리키는 값 범위만 고친다. 다른 설정과 주석은 직렬화하지 않는다. */
export function patchTomlValues(text: string, items: SettingIntent[]): string {
  let result = text;
  for (const item of items) {
    const before = parse(result) as Record<string, any>, next = structuredClone(before); setValue(next, item);
    if (JSON.stringify(before) === JSON.stringify(next)) continue;
    const ast = parseTOML(result, { tomlVersion: "1.0.0" });
    const top = ast.body[0];
    const nodes = top.body as any[];
    let match: any, table: any;
    const visit = (entry: any, prefix: string[]) => {
      if (entry.type !== "TOMLKeyValue") return;
      const keys = [...prefix, ...(getStaticTOMLValue(entry.key) as unknown as string[])];
      if (JSON.stringify(keys) === JSON.stringify(item.path)) match = entry;
      if (entry.value.type === "TOMLInlineTable") for (const child of entry.value.body) visit(child, keys);
    };
    for (const node of nodes) {
      const prefix = node.type === "TOMLTable" ? node.resolvedKey as string[] : [];
      if (node.type === "TOMLTable" && JSON.stringify(prefix) === JSON.stringify(item.path.slice(0, -1))) table = node;
      for (const entry of node.type === "TOMLTable" ? node.body : [node]) {
        visit(entry, prefix);
      }
    }
    if (match) {
      let start = item.operation === "remove" ? match.range[0] : match.value.range[0];
      let end = item.operation === "remove" ? match.range[1] : match.value.range[1];
      if (item.operation === "remove" && match.parent?.type === "TOMLInlineTable") {
        const siblings = match.parent.body, index = siblings.indexOf(match);
        if (siblings[index + 1]) end = siblings[index + 1].range[0];
        else if (siblings[index - 1]) start = siblings[index - 1].range[1];
      }
      result = result.slice(0, start) + (item.operation === "remove" ? "" : valueText(item.value!)) + result.slice(end);
    } else {
      // 복합 표·배열 표를 선택한 경우 그 표와 하위 표만 교체한다.
      const owned = nodes.filter(n => n.type === "TOMLTable" && item.path.every((key, i) => n.resolvedKey[i] === key));
      if (owned.length) for (const node of [...owned].reverse()) {
        const comments = result.slice(node.range[0], node.range[1]).split(/\r?\n/).filter(line => line.trimStart().startsWith("#")).join("\n");
        result = result.slice(0, node.range[0]) + (comments ? comments + "\n" : "") + result.slice(node.range[1]);
      }
      if (item.operation === "set") {
        const assignment = `${keyText(item.path.at(-1)!)} = ${valueText(item.value!)}\n`;
        if (table && !owned.length) result = result.slice(0, table.range[1]) + "\n" + assignment + result.slice(table.range[1]);
        else {
          const rendered: Record<string, any> = {}; setValue(rendered, item);
          const addition = stringify(rendered);
          // 루트 키는 첫 표보다 앞에 있어야 한다.
          result = !addition.trimStart().startsWith("[") ? addition + "\n" + result : result.trimEnd() + "\n\n" + addition;
        }
      }
    }
    const actual = parse(result);
    if (item.operation === "remove") for (let depth = item.path.length - 1; depth > 0; depth--) {
      const parent = item.path.slice(0, depth), expected = getValue(next, parent);
      if (expected && typeof expected === "object" && !Object.keys(expected).length && getValue(actual, parent) === undefined) setValue(next, { ...item, path: parent });
    }
    if (JSON.stringify(actual) !== JSON.stringify(next)) {
      // 객체의 키 순서는 의미가 없으므로 값 단위로 대조한다.
      const stable = (v: any): string => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}" : JSON.stringify(v);
      if (stable(actual) !== stable(next)) throw new Error("TOML 부분 편집을 검증하지 못했습니다. 원본은 변경하지 않았습니다.");
    }
  }
  return result;
}
