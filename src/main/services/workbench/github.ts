import type { ComponentDefinition } from "@shared/workbench-types";
import { RequestError } from "../../ipc-validation.js";
import { safeRelative, validateComponent } from "./definition.js";
async function github(endpoint: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com/repos/${endpoint}`, { signal: AbortSignal.timeout(15_000), redirect: "error", headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new RequestError(422, `GitHub 조회 실패 (${response.status})`);
  const bytes = await response.arrayBuffer(); if (bytes.byteLength > 8 * 1024 * 1024) throw new RequestError(422, "GitHub 응답이 너무 큽니다");
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}
export function repositoryName(value: string) { if (!/^[\w-]+\/[\w.-]+$/.test(value)) throw new RequestError(422, "owner/repository 형식으로 입력하세요"); return value; }
export async function discoverSkills(repository: string): Promise<{ revision: string; directories: string[] }> {
  repositoryName(repository);
  const commit = await github(`${repository}/commits/HEAD`) as { sha: string };
  const tree = await github(`${repository}/git/trees/${commit.sha}?recursive=1`) as { truncated: boolean; tree: { path: string; type: string; mode: string }[] };
  if (tree.truncated) throw new RequestError(422, "저장소가 너무 커서 전체 파일을 확인할 수 없습니다");
  return { revision: commit.sha, directories: tree.tree.filter(f => f.type === "blob" && /(^|\/)SKILL\.md$/.test(f.path) && f.mode === "100644").map(f => f.path.slice(0, -8).replace(/\/$/, "")).filter(p => !p || safeRelative(p)) };
}
export async function fetchSkill(repository: string, directory: string, revision?: string): Promise<ComponentDefinition> {
  repositoryName(repository); if (directory && !safeRelative(directory)) throw new RequestError(422, "잘못된 스킬 폴더입니다");
  const sha = revision ?? (await discoverSkills(repository)).revision;
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new RequestError(422, "잘못된 커밋입니다");
  const tree = await github(`${repository}/git/trees/${sha}?recursive=1`) as { truncated: boolean; tree: { path: string; type: string; mode: string; sha: string; size: number }[] };
  if (tree.truncated) throw new RequestError(422, "전체 파일을 확인할 수 없습니다");
  const prefix = directory ? `${directory}/` : "";
  const entries = tree.tree.filter(f => f.type !== "tree" && f.path.startsWith(prefix));
  if (!entries.length || entries.length > 100 || entries.some(f => f.mode !== "100644") || entries.some(f => f.size > 1024 * 1024) || entries.reduce((n, f) => n + f.size, 0) > 1024 * 1024) throw new RequestError(422, "링크·실행 권한 파일·서브모듈·큰 패키지는 수동 설치하세요");
  const files: Record<string, string> = {};
  for (const entry of entries) {
    const relative = entry.path.slice(prefix.length); if (!safeRelative(relative)) throw new RequestError(422, "지원하지 않는 파일 경로입니다");
    const blob = await github(`${repository}/git/blobs/${entry.sha}`) as { encoding: string; content: string };
    const bytes = Buffer.from(blob.content, "base64"); const text = bytes.toString("utf8");
    if (blob.encoding !== "base64" || !Buffer.from(text).equals(bytes) || text.includes("\0")) throw new RequestError(422, "바이너리 파일은 지원하지 않습니다");
    files[relative] = text;
  }
  const id = (directory.split("/").pop() || repository.split("/")[1]!).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 80);
  return validateComponent({ id, name: id, description: `${repository}의 스킬`, kind: "skill", source: { kind: "github", repository, directory, revision: sha }, targets: ["claude", "codex"], files });
}
