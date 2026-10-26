import { parse as parseToml } from "smol-toml";
import { MARKDOWN_BLOCK_END, MARKDOWN_BLOCK_START, getPath, normalizeNewlines, setPath, splitMarkdownSections } from "../capture/text.js";

/**
 * 사용자 설정 불가침(v3 원칙): 파일을 통째로 쓰지 않고 레포가 관리하는 부분만 바꾼다.
 * - JSON: 관리 키만 넣는다. 문자열 배열은 합친다(사용자가 더 넣은 항목은 남긴다).
 * - TOML: 관리 키의 줄만 바꾸거나 넣는다. 주석과 순서를 그대로 둔다.
 * - 텍스트: 마커 블록 안만 바꾼다.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 관리 키를 템플릿 값으로 맞춘 새 객체. 원본은 바꾸지 않는다. */
export function mergeManagedJson(
  current: Record<string, unknown>,
  keys: readonly string[],
  template: Record<string, unknown>,
  overlay: Record<string, unknown> = {},
): Record<string, unknown> {
  const next = structuredClone(current);
  for (const key of keys) {
    const expected = getPath(template, key);
    const extra = getPath(overlay, key);
    if (expected === undefined && extra === undefined) continue;
    if (Array.isArray(expected) || Array.isArray(extra)) {
      const have = getPath(next, key);
      const merged = Array.isArray(have) ? [...have] : [];
      for (const entry of [...((expected as unknown[]) ?? []), ...((extra as unknown[]) ?? [])]) {
        if (!merged.some((candidate) => same(candidate, entry))) merged.push(entry);
      }
      setPath(next, key, merged);
    } else {
      setPath(next, key, structuredClone(expected));
    }
  }
  return next;
}

// ───────────────────────────── TOML ─────────────────────────────

export type TomlScalar = string | number | boolean;

/** TOML 키 하나를 문법에 맞게 쓴다. 맨 키로 쓸 수 없으면 따옴표로 감싼다. */
function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function tomlValue(value: TomlScalar): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("TOML 숫자가 아닙니다");
  return String(value);
}

/** `[a."b.c"]` 같은 표 머리를 키 배열로 푼다. 배열 표(`[[...]]`)는 null. */
export function parseTableHeader(line: string): string[] | null {
  const match = /^\s*\[(?!\[)(.+)\]\s*(#.*)?$/.exec(line);
  if (!match) return null;
  return splitDottedKey(match[1]!.trim());
}

function splitDottedKey(text: string): string[] {
  const keys: string[] = [];
  let index = 0;
  while (index < text.length) {
    while (text[index] === " " || text[index] === "\t") index += 1;
    if (text[index] === '"' || text[index] === "'") {
      const quote = text[index]!;
      let end = index + 1;
      let raw = "";
      while (end < text.length && text[end] !== quote) {
        if (quote === '"' && text[end] === "\\") {
          raw += text.slice(end, end + 2);
          end += 2;
          continue;
        }
        raw += text[end];
        end += 1;
      }
      keys.push(quote === '"' ? (JSON.parse(`"${raw}"`) as string) : raw);
      index = end + 1;
    } else {
      let end = index;
      while (end < text.length && text[end] !== "." && text[end] !== " " && text[end] !== "=") end += 1;
      keys.push(text.slice(index, end));
      index = end;
    }
    while (text[index] === " " || text[index] === "\t") index += 1;
    if (text[index] === ".") index += 1;
    else break;
  }
  return keys;
}

/** 줄 머리의 `key =`에서 키를 읽는다. 키-값 줄이 아니면 null. */
function lineKey(line: string): string[] | null {
  if (/^\s*(#|\[|$)/.test(line)) return null;
  const eq = findAssignment(line);
  if (eq < 0) return null;
  return splitDottedKey(line.slice(0, eq).trim());
}

/** 따옴표 밖의 첫 `=` 위치. */
function findAssignment(line: string): number {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"') index += 1;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "=") return index;
  }
  return -1;
}

/** 값 뒤의 인라인 주석(따옴표 밖 `#`부터)을 돌려준다. 없으면 빈 문자열. */
function trailingComment(line: string, from: number): string {
  let quote: string | null = null;
  for (let index = from; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"') index += 1;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "#") return ` ${line.slice(index).trim()}`;
  }
  return "";
}

const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, index) => key === b[index]);

/**
 * 관리 키 줄만 바꾼다. 값이 이미 같으면 그대로 둔다. 표가 없으면 끝에 새 표를 붙이고, 키가 없으면
 * 그 표의 마지막 키 뒤에 넣는다. 결과를 다시 파싱해 모든 값이 의도대로 읽히는지 확인한다 — 줄 단위 편집이
 * 여러 줄 문자열 같은 드문 문법을 잘못 만지면 쓰기 전에 여기서 멈춘다.
 */
export function patchTomlScalars(text: string, entries: readonly { path: readonly string[]; value: TomlScalar }[]): string {
  const lines = normalizeNewlines(text).split("\n");
  for (const { path, value } of entries) {
    const table = path.slice(0, -1);
    const key = path.at(-1)!;
    const rendered = `${tomlKey(key)} = ${tomlValue(value)}`;
    // 표 구간 찾기: 루트는 첫 표 머리 전까지다.
    let start = -1;
    let end = lines.length;
    if (table.length === 0) {
      start = 0;
      const firstHeader = lines.findIndex((line) => /^\s*\[/.test(line));
      end = firstHeader < 0 ? lines.length : firstHeader;
    } else {
      for (let index = 0; index < lines.length; index += 1) {
        const header = parseTableHeader(lines[index]!);
        if (header && sameKeys(header, table)) {
          start = index + 1;
          end = lines.length;
          for (let next = index + 1; next < lines.length; next += 1) {
            if (/^\s*\[/.test(lines[next]!)) {
              end = next;
              break;
            }
          }
          break;
        }
      }
    }
    if (start < 0) {
      while (lines.length > 0 && lines.at(-1) === "") lines.pop();
      lines.push("", `[${table.map(tomlKey).join(".")}]`, rendered, "");
      continue;
    }
    const existing = lines.slice(start, end).findIndex((line) => {
      const found = lineKey(line);
      return found !== null && sameKeys(found, [key]);
    });
    if (existing >= 0) {
      const at = start + existing;
      const line = lines[at]!;
      lines[at] = `${line.match(/^\s*/)![0]}${rendered}${trailingComment(line, findAssignment(line) + 1)}`;
      continue;
    }
    // 표의 마지막 키-값 줄 뒤에 넣는다(표 끝의 빈 줄 앞).
    let insertAt = start;
    for (let index = start; index < end; index += 1) if (lineKey(lines[index]!) !== null) insertAt = index + 1;
    lines.splice(insertAt, 0, rendered);
  }
  const result = lines.join("\n");
  const parsed = parseToml(result) as Record<string, unknown>;
  for (const { path, value } of entries) {
    let cursor: unknown = parsed;
    for (const key of path) cursor = isRecord(cursor) ? cursor[key] : undefined;
    if (cursor !== value) throw new Error(`TOML 패치 결과를 확인하지 못했습니다: ${path.join(".")}`);
  }
  return result;
}

/** 관리 키 값이 모두 스칼라일 때 TOML 패치 목록으로 바꾼다. 표나 배열은 줄 단위로 안전하게 고칠 수 없다. */
export function tomlEntriesFor(keys: readonly string[], template: Record<string, unknown>): { path: string[]; value: TomlScalar }[] {
  return keys.flatMap((key) => {
    const value = getPath(template, key);
    if (value === undefined) return [];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`${key}: 표·배열 값은 아직 관리할 수 없습니다(스칼라만)`);
    }
    return [{ path: key.split("."), value }];
  });
}

// ───────────────────────────── 마커 블록 ─────────────────────────────

export interface MarkerPair {
  start: string;
  end: string;
}

/** capture가 공개 부분을 읽어 가는 마커와 같은 짝이어야 한다(왕복). */
export const MARKDOWN_MARKERS: MarkerPair = { start: MARKDOWN_BLOCK_START, end: MARKDOWN_BLOCK_END };

export const HASH_MARKERS: MarkerPair = {
  start: "# >>> harness-manager >>>",
  end: "# <<< harness-manager <<<",
};

/** 마커 블록 안을 content로 바꾼다. 블록이 없으면 끝에 붙인다. 블록 밖은 한 글자도 바꾸지 않는다. */
export function upsertMarkerBlock(text: string, content: string, markers: MarkerPair): string {
  const source = normalizeNewlines(text);
  const block = `${markers.start}\n${content.replace(/\s+$/, "")}\n${markers.end}`;
  const start = source.indexOf(markers.start);
  const end = source.indexOf(markers.end);
  if (start >= 0 && end > start) return source.slice(0, start) + block + source.slice(end + markers.end.length);
  if (source.trim() === "") return `${block}\n`;
  return `${source.replace(/\s+$/, "")}\n\n${block}\n`;
}

/**
 * 마커 없이 손으로 관리하던 AGENTS.md를 처음 맞출 때: 레포가 관리하는 제목의 섹션을 지우고 마커 블록 하나로
 * 옮긴다. 다른 섹션(개인 배경 등)은 그대로 둔다.
 */
export function adoptSectionsIntoBlock(text: string, managedHeadings: readonly string[], content: string): string {
  const source = normalizeNewlines(text);
  if (source.includes(MARKDOWN_MARKERS.start)) return upsertMarkerBlock(source, content, MARKDOWN_MARKERS);
  const kept = splitMarkdownSections(source)
    .filter((section) => section.heading === null || !managedHeadings.includes(section.heading))
    .map((section) => section.text.replace(/\s+$/, ""))
    .filter(Boolean)
    .join("\n\n");
  return upsertMarkerBlock(kept, content, MARKDOWN_MARKERS);
}
