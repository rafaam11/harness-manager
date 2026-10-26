import type { ProviderFilter } from "@shared/provider-types";

/**
 * 렌더러가 보낸 IPC 인자를 main이 믿고 쓸 수 있는 값으로 바꾼다. 모양이 틀리면 400으로 던진다 —
 * 렌더러가 무엇을 보내든 서비스까지 날것으로 가지 않는다.
 */
export class RequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function fail(message: string): never {
  throw new RequestError(400, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 정확히 허용된 키만 가진 object인지 검사한다. 모르는 키가 섞여 있으면 거절한다. */
export function exactObject(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail(`${label} contains unknown fields: ${unknown.join(", ")}`);
  return value;
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

/** 빈 문자열도 허용한다(설정 파일 본문처럼 비어 있을 수 있는 값). */
export function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} must be a string`);
  return value;
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}

export function nonEmptyStringArray(value: unknown, label: string, max = 10_000): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  if (value.length > max) fail(`${label} has too many entries`);
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
}

export function providerFilter(value: unknown): ProviderFilter {
  if (value === "all" || value === "claude" || value === "codex") return value;
  fail("provider filter must be all, claude or codex");
}

/** http/https URL만 통과시킨다(OS 브라우저로 넘길 외부 링크). */
export function externalUrl(value: unknown): string {
  const raw = nonEmptyString(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail("url is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail("url must be http or https");
  return parsed.href;
}
