import path from "node:path";
import { TEMP_DIRS } from "../config.js";

export class PathScopeError extends Error {
  statusCode = 403;
}

/** v3에서 더한 정리 분류(M8). services/cleanup-targets.ts가 만드는 이름과 같아야 한다. */
export const V3_CLEANUP_CATEGORIES = ["broken-links", "duplicate-skills", "leftovers", "codex-logs"] as const;

export type CleanupArchiveCategory = "projects" | `temp/${string}` | (typeof V3_CLEANUP_CATEGORIES)[number];

function fail(label: string, value: string): never {
  throw new PathScopeError(`${label} is outside allowed scope: ${value}`);
}

export function assertInsideRoot(candidate: string, root: string, label: string): string {
  const resolved = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)) return resolved;
  return fail(label, resolved);
}

export function assertSafePathSegment(value: string, label: string): string {
  if (!value || value === "." || value === "..") return fail(label, value);
  if (path.isAbsolute(value)) return fail(label, value);
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    return fail(label, value);
  }
  return value;
}

export function assertSafeRelativePath(value: string, label: string): string {
  if (!value || path.isAbsolute(value)) return fail(label, value);
  const normalized = path.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    return fail(label, value);
  }
  return normalized.replaceAll("\\", "/");
}

export function assertCleanupCategory(value: string): CleanupArchiveCategory {
  if (value === "projects") return value;
  if ((V3_CLEANUP_CATEGORIES as readonly string[]).includes(value)) return value as CleanupArchiveCategory;
  for (const dir of TEMP_DIRS) {
    const allowed = `temp/${dir}` as CleanupArchiveCategory;
    if (value === allowed) return allowed;
  }
  return fail("cleanup category", value);
}
