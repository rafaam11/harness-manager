import { createPatch } from "diff";

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** 앞의 빈 줄을 없애고 끝 줄바꿈을 하나로 맞춘다. 빈 문자열은 빈 문자열이다. */
export function withTrailingNewline(text: string): string {
  const trimmed = text.replace(/^(\s*\n)+/, "").replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n` : "";
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function unifiedDiff(displayPath: string, before: string | null, after: string): string {
  if ((before ?? "") === after) return "";
  const patch = createPatch(displayPath, before ?? "", after, before === null ? "(없음)" : "레포", "이 PC", { context: 3 });
  // createPatch가 앞에 붙이는 "Index:"·"===" 줄은 화면에서 잡음일 뿐이다.
  return patch
    .split("\n")
    .filter((line, index) => !(index < 2 && (line.startsWith("Index:") || /^=+$/.test(line))))
    .join("\n");
}

export interface MarkdownSection {
  /** 제목 줄(`## 세션 인계`)의 제목 텍스트. 머리말(첫 제목 앞)은 null. */
  heading: string | null;
  /** 제목 줄을 포함한 원문. */
  text: string;
}

/**
 * 제목 줄(`#`~`######`)마다 자른다. 수준과 상관없이 다음 제목에서 끊는다 — 공개·개인 구분은 섹션 단위라
 * 하위 제목이 상위 섹션에 딸려 가면 개인 섹션 안의 공개 제목을 못 가른다. 코드 블록 안의 `#`은 제목이 아니다.
 */
export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { heading: null, text: "" };
  let inFence = false;
  for (const line of normalizeNewlines(markdown).split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = inFence ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      sections.push(current);
      current = { heading: match[1]!, text: `${line}\n` };
    } else {
      current.text += `${line}\n`;
    }
  }
  sections.push(current);
  return sections.filter((section) => section.heading !== null || section.text.trim().length > 0);
}

export const MARKDOWN_BLOCK_START = "<!-- >>> harness-manager >>> -->";
export const MARKDOWN_BLOCK_END = "<!-- <<< harness-manager <<< -->";

/** 마커 블록이 있으면 안쪽(공개)과 바깥(개인)을 나눠 준다. 없으면 null. */
export function splitMarkerBlock(markdown: string): { inside: string; outside: string } | null {
  const text = normalizeNewlines(markdown);
  const start = text.indexOf(MARKDOWN_BLOCK_START);
  const end = text.indexOf(MARKDOWN_BLOCK_END);
  if (start < 0 || end < start) return null;
  return {
    inside: text.slice(start + MARKDOWN_BLOCK_START.length, end),
    outside: text.slice(0, start) + text.slice(end + MARKDOWN_BLOCK_END.length),
  };
}

/** `a.b.c` 경로로 값을 읽는다. 없으면 undefined. */
export function getPath(root: unknown, dotted: string): unknown {
  let current: unknown = root;
  for (const key of dotted.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function setPath(root: Record<string, unknown>, dotted: string, value: unknown): void {
  const keys = dotted.split(".");
  let current = root;
  keys.slice(0, -1).forEach((key) => {
    const next = current[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) current[key] = {};
    current = current[key] as Record<string, unknown>;
  });
  current[keys.at(-1)!] = value;
}
