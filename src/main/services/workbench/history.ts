import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChangeRecord } from "@shared/workbench-types";
import { writeFileChecked } from "../capture/capture.js";
import { sha256 } from "../../lib/safe-write.js";
import { RequestError } from "../../ipc-validation.js";
import { profileFile } from "../profile-document.js";
export interface FileChange { path: string; before: string | null; after: string | null }
interface StoredChange extends ChangeRecord { changes: FileChange[] }
export const readText = async (file: string): Promise<string | null> => fs.readFile(file).then(bytes => {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) throw new RequestError(422, "UTF-8이 아닌 파일은 자동 변경하지 않습니다");
  return text;
}).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
export class ChangeHistory {
  constructor(private directory: string, private allow: (file: string) => Promise<void>) {}
  private file(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new RequestError(400, "잘못된 이력 ID입니다"); return path.join(this.directory, `${id}.json`); }
  private async save(record: StoredChange) {
    await profileFile(this.directory, `${record.id}.json`);
    const file = this.file(record.id); await writeFileChecked(file, await readText(file), JSON.stringify(record, null, 2));
  }
  async list(): Promise<ChangeRecord[]> {
    const names = await fs.readdir(this.directory).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
    const records = await Promise.all(names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(async n => {
      await profileFile(this.directory, n);
      const { changes: _changes, ...record } = JSON.parse((await readText(path.join(this.directory, n)))!) as StoredChange; return record;
    }));
    return records.sort((a, b) => b.at.localeCompare(a.at));
  }
  async load(id: string): Promise<StoredChange> {
    await profileFile(this.directory, `${id}.json`);
    const raw = await readText(this.file(id)); if (!raw) throw new RequestError(404, "이력을 찾지 못했습니다");
    return JSON.parse(raw) as StoredChange;
  }
  async recordCommand(profileId: string, title: string, detail: string, failed: boolean, actor: "user" | "automatic" = "user") {
    const record: StoredChange = { id: randomUUID(), title, at: new Date().toISOString(), actor, profileId, status: failed ? "failed" : "done", files: [], changes: [], detail, restorable: false };
    await this.save(record); return record;
  }
  async apply(profileId: string, title: string, input: FileChange[], actor: "user" | "automatic" = "user"): Promise<string> {
    const changes = input.filter(f => f.before !== f.after);
    if (new Set(changes.map(f => path.resolve(f.path).toLowerCase())).size !== changes.length) throw new RequestError(422, "변경 대상 파일이 겹칩니다");
    for (const f of changes) { await this.allow(f.path); if (await readText(f.path) !== f.before) throw new RequestError(409, "미리보기 이후 파일이 변경되었습니다"); }
    const record: StoredChange = { id: randomUUID(), title, at: new Date().toISOString(), actor, profileId, status: "pending", changes, files: changes.map(f => ({ path: f.path, beforeHash: f.before === null ? null : sha256(f.before), afterHash: f.after === null ? null : sha256(f.after) })), detail: "적용 중", restorable: changes.length > 0 };
    await this.save(record);
    try {
      for (const f of changes) { await this.allow(f.path); if (f.after === null) { if (await readText(f.path) !== f.before) throw new RequestError(409, "보관 전 파일이 변경되었습니다"); await this.archive(record.id, f.path); } else await writeFileChecked(f.path, f.before, f.after); }
      record.status = "done"; record.detail = `${changes.length}개 파일 적용`; await this.save(record);
    } catch (e) {
      record.status = "failed"; record.detail = (e as Error).message;
      try { await this.rollback(record); record.restorable = false; } catch (rollback) { record.status = "recovery-needed"; record.detail += ` · 복구 필요: ${(rollback as Error).message}`; }
      await this.save(record); throw e;
    }
    return record.id;
  }
  private async archive(id: string, file: string) {
    const archive = path.join(this.directory, "retired", id, sha256(file));
    await profileFile(this.directory, `retired/${id}/${sha256(file)}`);
    await fs.mkdir(path.dirname(archive), { recursive: true }); await fs.rename(file, archive);
  }
  private async rollback(record: StoredChange) {
    // 적용 이후 사용자가 바꾼 파일은 건드리지 않는다. 새 파일도 버리지 않고 이력 옆에 보관한다.
    for (const f of [...record.changes].reverse()) {
      await this.allow(f.path); const current = await readText(f.path);
      if (current === f.before) continue;
      if (current !== f.after) throw new RequestError(409, `${path.basename(f.path)}: 적용 이후 변경이 있어 복원할 수 없습니다`);
      if (f.before === null) {
        await this.archive(record.id, f.path);
      } else await writeFileChecked(f.path, current, f.before);
    }
  }
  async restore(id: string, profileId: string) {
    const record = await this.load(id);
    if (record.profileId !== profileId || !record.restorable || !["done", "pending", "recovery-needed"].includes(record.status)) throw new RequestError(409, "현재 프로필에서 복원할 수 없는 이력입니다");
    // 모든 파일을 먼저 검사해 충돌 때문에 일부만 복원되는 일을 막는다.
    for (const f of record.changes) { await this.allow(f.path); const current = await readText(f.path); if (current !== f.after && current !== f.before) throw new RequestError(409, "이후 변경이 있어 복원을 보류합니다"); }
    await this.rollback(record); record.status = "restored"; record.restorable = false; record.actor = "user"; record.at = new Date().toISOString(); record.detail = "이전 설정으로 복원됨 · 다음 수동 적용 전까지 자동 쓰기 보류"; await this.save(record);
  }
}
