import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PcStatusReport } from "@shared/pc-status-types";
import type { WorkbenchSnapshot } from "@shared/workbench-types";
import { sha256 } from "../../lib/safe-write.js";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../../storage/json-store.js";
import { profileFile } from "../profile-document.js";
import { RequestError } from "../../ipc-validation.js";

// Reports are untrusted remote data. Reject extra fields instead of stripping potential secrets.
const identifier = z.string().regex(/^[a-zA-Z0-9_:@./-]{1,180}$/).refine(value => !value.includes("..") && !value.startsWith("/") && !/^[a-z]:/i.test(value));
const semver = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/);
export const pcStatusSchema = z.object({
  format: z.literal("harness-manager-pc-status"), version: z.literal(1), pcId: z.string().uuid(),
  alias: z.string().min(1).max(40).refine(value => !/[\\/:@\r\n]/.test(value)), reportedAt: z.iso.datetime(),
  cliVersions: z.object({ codex: semver.optional(), claude: semver.optional() }).strict(),
  items: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), provider: z.enum(["claude", "codex"]), kind: z.enum(["skill", "instruction", "agent", "command", "memory", "mcp", "plugin", "mod", "environment"]), name: identifier, version: semver.optional(), recognition: z.enum(["confirmed", "unverified"]), enabled: z.boolean().nullable(), managed: z.boolean(), stale: z.boolean(), checkedAt: z.iso.datetime().optional(), source: z.object({ pluginId: identifier }).strict().optional(), origin: z.enum(["shared-user", "cli-user", "system", "plugin"]).optional(), contentDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()).max(10000),
}).strict();
export function parsePcStatus(raw: unknown): PcStatusReport { const result = pcStatusSchema.safeParse(raw); if (!result.success) throw new RequestError(422, "PC 상태 보고 형식 또는 민감 정보 제외 규칙을 확인하세요"); return result.data; }
function version(value?: string) { return value?.match(/\b\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?/)?.[0]; }
interface PcIdentity { id: string; alias: string }
const spec: JsonStoreSpec<PcIdentity> = {
  label: "pc identity", displayName: "PC 별칭", empty: () => ({ id: randomUUID(), alias: "내 PC" }), error: message => new Error(message), isContentError: e => e instanceof Error,
  parse(value) { const result = z.object({ id: z.string().uuid(), alias: pcStatusSchema.shape.alias }).strict().safeParse(value); if (!result.success) throw new Error("PC 식별 정보 오류"); return result.data; },
};
export class PcStatusService {
  private previews = new Map<string, { report: PcStatusReport; expires: number }>();
  constructor(private stateDir: string, private snapshot: () => Promise<WorkbenchSnapshot>) {}
  private async file() { return profileFile(this.stateDir, "workbench/pc-identity.v1.json"); }
  async identity() { const file = await this.file(); const current = await readJsonStore(spec, file); return current.source === "empty" ? updateJsonStore(spec, file, value => value) : current.value; }
  async current() { return (await this.preview((await this.identity()).alias)).report; }
  async preview(alias: string) {
    if (!pcStatusSchema.shape.alias.safeParse(alias).success) throw new RequestError(400, "PC 별칭은 1~40자이며 경로·이메일은 넣을 수 없습니다");
    const identity = await this.identity(), snapshot = await this.snapshot();
    const report: PcStatusReport = { format: "harness-manager-pc-status", version: 1, pcId: identity.id, alias, reportedAt: new Date().toISOString(), cliVersions: {}, items: [] };
    for (const evidence of snapshot.recognition ?? []) { const value = version(evidence.version); if (value && evidence.scope.kind === "global") report.cliVersions[evidence.provider] = value; }
    const seen = new Set<string>();
    for (const item of snapshot.components) for (const observation of item.observations) {
      // Export identifiers and status only; descriptions, paths and configuration stay local.
      const evidence = snapshot.recognition?.find(e => e.provider === observation.provider);
      if (evidence?.scope.kind === "project" || observation.scopeKind === "project") continue;
      const pluginId = observation.pluginId ?? (["plugin", "mod"].includes(item.kind) ? item.name : undefined);
      const name = item.definitionId ?? (identifier.safeParse(item.name).success ? item.name : item.id.startsWith("step:") ? item.id : undefined);
      if (!name) continue;
      if (!identifier.safeParse(name).success || (pluginId && !identifier.safeParse(pluginId).success)) continue;
      const source = pluginId ? { pluginId } : undefined;
      const origin = pluginId ? "plugin" as const : observation.system ? "system" as const : /(?:^|[\\/])\.agents[\\/]skills[\\/]/.test(observation.identityPath ?? "") ? "shared-user" as const : "cli-user" as const;
      const id = sha256(JSON.stringify([observation.provider, item.kind, source ?? origin, name]));
      if (seen.has(id)) continue; seen.add(id);
      report.items.push({ id, provider: observation.provider, kind: item.kind, name, version: version(observation.version), recognition: observation.recognition, enabled: observation.enabled, managed: item.managed, stale: observation.stale ?? evidence?.stale ?? true, checkedAt: observation.checkedAt || undefined, source, origin, contentDigest: observation.contentDigest });
    }
    const checked = parsePcStatus(report), token = randomUUID();
    if (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(token, { report: checked, expires: Date.now() + 15 * 60_000 });
    return { token, report: checked };
  }
  async reviewed(token: string) {
    const pending = this.previews.get(token); if (!pending || pending.expires < Date.now()) throw new RequestError(409, "PC 상태 전송 내용을 다시 검토하세요");
    return structuredClone(pending.report);
  }
  async sent(token: string) { const report = await this.reviewed(token); await updateJsonStore(spec, await this.file(), current => ({ ...current, alias: report.alias })); this.previews.delete(token); }
}
