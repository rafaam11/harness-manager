import fs from "node:fs/promises";
import path from "node:path";
import type { RecognizedSkill, RecognitionScope, RecognitionReport } from "@shared/workbench-types";
import type { ProviderId } from "@shared/provider-types";
import { metadataProcess, type MetadataProcessOptions } from "./metadata-process.js";
import { RequestError } from "../../ipc-validation.js";
import { sha256 } from "../../lib/safe-write.js";
import { profileFile } from "../profile-document.js";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../../storage/json-store.js";
import { z } from "zod";

export type MetadataTransport = (options: MetadataProcessOptions) => Promise<string>;
export async function codexSkillList(executable: string, scope: RecognitionScope, env: NodeJS.ProcessEnv, signal: AbortSignal, transport: MetadataTransport = metadataProcess): Promise<RecognizedSkill[]> {
  let result: RecognizedSkill[] | undefined;
  await transport({ executable, args: ["app-server"], cwd: scope.cwd, env, signal,
    initialMessage: { id: 1, method: "initialize", params: { clientInfo: { name: "harness_manager", version: "1.0.0" } } },
    onMessage(raw, send, finish) {
      const message = raw as { id?: number; error?: { code: number }; result?: unknown; method?: string };
      if (message.error) { finish(new Error(message.error.code === -32601 ? "이 CLI 버전은 skills/list를 지원하지 않습니다" : "CLI 메타데이터 조회가 실패했습니다")); return; }
      if (message.id === 1) { send({ method: "initialized", params: {} }); send({ id: 2, method: "skills/list", params: { cwds: [scope.cwd], forceReload: true } }); }
      if (message.id !== 2) return;
      const value = message.result as { data?: unknown[] };
      if (!Array.isArray(value?.data)) throw new Error("invalid response");
      const row = value.data.find(raw => typeof raw === "object" && raw !== null && "cwd" in raw && path.resolve(String(raw.cwd)) === path.resolve(scope.cwd)) as { skills?: unknown[]; errors?: unknown[] } | undefined;
      if (!row || !Array.isArray(row.skills) || (row.errors && (!Array.isArray(row.errors) || row.errors.length))) throw new Error("incomplete skill discovery");
      result = row.skills.map(raw => {
        const skill = raw as Record<string, unknown>;
        if (typeof skill.name !== "string" || typeof skill.path !== "string" || !path.isAbsolute(skill.path) || typeof skill.enabled !== "boolean" || typeof skill.scope !== "string") throw new Error("invalid skill");
        return { name: skill.name, path: skill.path, enabled: skill.enabled, scope: skill.scope, description: typeof skill.description === "string" ? skill.description : "", pluginId: typeof skill.pluginId === "string" ? skill.pluginId : undefined };
      });
      finish();
    },
  });
  if (!result) throw new Error("CLI가 스킬 목록을 반환하지 않았습니다");
  return result;
}
const reportSchema = z.object({
  provider: z.enum(["claude", "codex"]), scope: z.object({ id: z.string(), kind: z.enum(["global", "project"]), cwd: z.string().refine(path.isAbsolute) }).strict(),
  version: z.string(), checkedAt: z.string(), status: z.enum(["success", "unsupported", "error", "cancelled"]), detail: z.string(),
  skills: z.array(z.object({ name: z.string(), description: z.string(), path: z.string().refine(path.isAbsolute), enabled: z.boolean(), scope: z.string(), pluginId: z.string().optional() }).strict()),
  fingerprint: z.string(), stale: z.boolean(), lastSuccessAt: z.string().optional(),
}).strict();
const spec: JsonStoreSpec<Record<string, RecognitionReport>> = {
  label: "recognition", displayName: "CLI 검사 기록", empty: () => ({}), error: message => new Error(message), isContentError: e => e instanceof Error,
  parse(value) {
    return z.record(z.string(), reportSchema).parse(value);
  },
};
export async function identityPath(file: string) { const resolved = await fs.realpath(file).catch(() => path.resolve(file)); return process.platform === "win32" ? resolved.toLowerCase() : resolved; }
/** Hash directory entries as well as content: additions, removals and symlink changes invalidate results. */
export async function recognitionFingerprint(roots: string[], metadata: unknown, signal?: AbortSignal): Promise<string> {
  const parts: string[] = [JSON.stringify(metadata)]; const seen = new Set<string>(); let count = 0;
  async function visit(file: string, depth: number): Promise<void> {
    if (signal?.aborted) throw new Error("검사를 취소했습니다");
    if (++count > 20000 || depth > 24) throw new Error("검사 지문 범위를 넘었습니다 · 재확인 필요");
    const real = await identityPath(file); parts.push(file, real);
    const stat = await fs.stat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat) { parts.push("missing"); return; }
    if (stat.isDirectory()) {
      if (seen.has(real)) return; seen.add(real);
      for (const name of (await fs.readdir(file)).sort()) { if ([".git", "node_modules"].includes(name)) continue; await visit(path.join(file, name), depth + 1); }
    } else if (stat.isFile()) {
      if (stat.size > 4 * 1024 * 1024) parts.push(String(stat.size), String(stat.mtimeMs), String(stat.ctimeMs));
      else parts.push(sha256(await fs.readFile(file)));
    }
  }
  for (const root of roots.sort()) await visit(root, 0);
  return sha256(JSON.stringify(parts));
}
export class RecognitionStore {
  constructor(private stateDir: string) {}
  private async file() { return profileFile(this.stateDir, "workbench/recognition.v1.json"); }
  async read(provider: ProviderId, scope: RecognitionScope): Promise<RecognitionReport | undefined> { return (await readJsonStore(spec, await this.file())).value[`${provider}:${scope.id}`]; }
  async save(report: RecognitionReport) { await updateJsonStore(spec, await this.file(), current => ({ ...current, [`${report.provider}:${report.scope.id}`]: report })); }
}
export function validateRecognitionRequest(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => !["provider", "scopeId", "refresh"].includes(key))) throw new RequestError(400, "검사 요청 형식 오류");
  const value = raw as Record<string, unknown>;
  if ((value.provider !== "codex" && value.provider !== "claude") || typeof value.scopeId !== "string" || typeof value.refresh !== "boolean") throw new RequestError(400, "검사 요청 형식 오류");
  return { provider: value.provider, scopeId: value.scopeId, refresh: value.refresh } as { provider: ProviderId; scopeId: string; refresh: boolean };
}
