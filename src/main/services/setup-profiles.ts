import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SetupProfile, SetupProfiles, ProfileDocument, ProfileEditor, ProfilePreview, ProfileBundle } from "@shared/setup-profile-types";
import { MANIFEST_FILES } from "@shared/manifest-types";
import { writeFileChecked } from "./capture/capture.js";
import { readAppSettings, updateAppSettings } from "./settings.js";
import { validateManifest } from "./manifest/validate.js";
import { RequestError } from "../ipc-validation.js";
import { withLock } from "../lib/lock.js";
import { ensurePrivateTerms, readDocument, writeDocument, validateDocument, documentFingerprint, readProfileFile } from "./profile-document.js";
import { unifiedDiff } from "./capture/text.js";

const edits = new Map<string, { id: string; root: string; fingerprint: string; doc: ProfileDocument }>();

const TEMPLATE_FILES = ["home/components.v2.json", "home/managed-keys.json", "home/agents/AGENTS.md", "home/claude/CLAUDE.md", "home/claude/settings.managed.json", "home/codex/config.managed.toml", "home/powershell/profile.ps1", "home/git/gitconfig.json", ...MANIFEST_FILES.map((name) => `manifest/${name}.json`)];
const LOCAL_FILES = ["AGENTS.local.md", "claude-settings.local.json", "codex-config.local.json", "manifest.local.json", "powershell.local.ps1", "gitconfig.local.json", "private-terms.json", "portability.json"];
const migrations = new Map<string, Promise<unknown>>();
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const BASE: Record<string, unknown> = {
  "manifest/packages.json": { schemaVersion: 1, packages: [
    { id: "git", source: "winget", name: "Git.Git", profiles: ["core", "dev", "full"], bin: "git" },
    { id: "nvm", source: "winget", name: "CoreyButler.NVMforWindows", profiles: ["core", "dev", "full"], bin: "node", description: "정상 Node를 보존하고 신규 환경만 Node 22를 설치합니다" },
  ] },
  "manifest/tools.json": { schemaVersion: 1, tools: [
    { id: "claude", name: "Claude Code", profiles: ["core", "dev", "full"], install: { kind: "powershell-script", ref: "https://claude.ai/install.ps1" }, verify: { command: "claude", args: ["--version"] } },
    { id: "codex", name: "Codex CLI", profiles: ["core", "dev", "full"], install: { kind: "npm", ref: "@openai/codex" }, verify: { command: "codex", args: ["--version"] } },
  ] },
  "manifest/plugins.json": { schemaVersion: 1, marketplaces: [], claude: { enabled: [] }, codex: { enabled: [] } },
  "manifest/mcp.json": { schemaVersion: 1, servers: [] },
  "manifest/skills.json": { schemaVersion: 1, external: [] },
  "home/managed-keys.json": { schemaVersion: 1, claudeSettings: ["model", "language", "effortLevel"], codexConfig: ["model", "model_reasoning_effort"], gitconfig: [] },
  "home/claude/settings.managed.json": {},
  "home/git/gitconfig.json": {},
};

export class SetupProfileStore {
  constructor(readonly stateDir: string, readonly repoRoot: string | null = null) {}
  private get registryFile() { return path.join(this.stateDir, "setup-profiles.json"); }
  private get settingsFile() { return path.join(this.stateDir, "settings.json"); }
  private async registered(): Promise<SetupProfile[]> {
    const raw = await fs.readFile(this.registryFile, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return "[]"; throw error; });
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => item && typeof item.id === "string" && typeof item.root === "string" && typeof item.localDir === "string" && typeof item.name === "string" && ["local", "linked"].includes(item.kind))) throw new Error("프로필 목록이 손상되었습니다");
    return parsed;
  }
  private async defaultProfile(): Promise<SetupProfile> {
    const root = path.join(this.stateDir, "profiles", "default", "definition");
    for (const [file, value] of Object.entries(BASE)) {
      const target = path.join(root, file);
      const before = await fs.readFile(target, "utf8").catch(() => null);
      if (before !== json(value)) await writeFileChecked(target, before, json(value));
    }
    return { id: "default", name: "공통 기본 · Git / Node / Claude / Codex", root, localDir: path.join(this.stateDir, "profiles", "default", "local"), kind: "builtin" };
  }
  async list(): Promise<SetupProfiles> {
    // doctor와 install이 동시에 초기화해도 같은 파일을 경합해서 만들지 않는다.
    return withLock(async () => {
      const settings = await readAppSettings(this.settingsFile);
      const profiles: SetupProfile[] = [await this.defaultProfile(), ...(this.repoRoot ? [{ id: "legacy", name: "기존 레포에서 가져오기", root: this.repoRoot, localDir: path.join(this.stateDir, "profile"), kind: "legacy" as const }] : []), ...await this.registered()];
      for (const profile of profiles) await ensurePrivateTerms(profile.localDir);
      return { activeId: settings.setupProfileId ?? "default", profiles };
    });
  }
  async active(): Promise<SetupProfile> {
    const { profiles, activeId } = await this.list();
    const selected = profiles.find((profile) => profile.id === activeId && !profile.archived);
    if (!selected) throw new RequestError(409, "선택한 사용자 프로필이 없습니다. 위저드에서 다시 선택하세요.");
    if (selected.kind === "legacy") {
      let pending = migrations.get(this.stateDir);
      if (!pending) { pending = this.create("이전 개인 프로필", "legacy").finally(() => migrations.delete(this.stateDir)); migrations.set(this.stateDir, pending); }
      await pending; return this.active();
    }
    const reports = await validateManifest(selected.root);
    const failures = reports.filter((report) => !report.ok);
    if (failures.length) throw new RequestError(422, `프로필 manifest 오류: ${failures.map((report) => `${report.path}: ${report.errors.join(", ")}`).join(" · ")}`);
    await readDocument(selected);
    return selected;
  }
  async select(id: string): Promise<SetupProfiles> {
    const list = await this.list();
    const selected = list.profiles.find((profile) => profile.id === id && !profile.archived);
    if (!selected) throw new RequestError(404, "사용자 프로필을 찾지 못했습니다");
    if (id === "legacy") return this.create("이전 개인 프로필", id);
    const reports = await validateManifest(selected.root);
    if (reports.some((report) => !report.ok)) throw new RequestError(422, "프로필 manifest를 확인하세요");
    await withLock(() => updateAppSettings(this.settingsFile, { setupProfileId: id }));
    return { ...list, activeId: id };
  }
  async create(name: string, baseId: string): Promise<SetupProfiles> {
    const { profiles } = await this.list();
    const base = profiles.find((profile) => profile.id === baseId);
    if (!base) throw new RequestError(404, "복사할 프로필을 찾지 못했습니다");
    const id = randomUUID();
    const root = path.join(this.stateDir, "profiles", id, "definition");
    const localDir = path.join(this.stateDir, "profiles", id, "local");
    return this.register({ id, name, root, localDir, kind: "local" }, async () => {
      for (const file of TEMPLATE_FILES) {
        const from = path.join(base.root, file);
        const stat = await fs.lstat(from).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
        if (!stat) continue;
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error(`복사할 수 없는 프로필 파일: ${file}`);
        await writeFileChecked(path.join(root, file), null, (await readProfileFile(base.root, file))!);
      }
      for (const file of LOCAL_FILES) {
        const from = path.join(base.localDir, file);
        const stat = await fs.lstat(from).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
        if (!stat) continue;
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error(`복사할 수 없는 로컬 프로필 파일: ${file}`);
        await writeFileChecked(path.join(localDir, file), null, (await readProfileFile(base.localDir, file))!);
      }
      const terms = path.join(localDir, "private-terms.json");
      if (!await fs.stat(terms).catch(() => null)) await writeFileChecked(terms, null, json({ terms: [] }));
    });
  }
  /** 첫 편집의 검토에는 사본 생성도 포함한다. 승인 전에는 선택이나 파일을 바꾸지 않는다. */
  async preparePersonalCopy() {
    const base = await this.active();
    const id = randomUUID();
    const profile: SetupProfile = { id, name: "내 설정", kind: "local", root: path.join(this.stateDir, "profiles", id, "definition"), localDir: path.join(this.stateDir, "profiles", id, "local") };
    const files: { path: string; before: string | null; after: string | null }[] = [];
    for (const file of TEMPLATE_FILES) {
      const text = await readProfileFile(base.root, file);
      if (text !== null) files.push({ path: path.join(profile.root, file), before: null, after: text });
    }
    for (const file of LOCAL_FILES) {
      const text = await readProfileFile(base.localDir, file);
      if (text !== null) files.push({ path: path.join(profile.localDir, file), before: null, after: text });
    }
    const registry = await fs.readFile(this.registryFile, "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    const settings = await fs.readFile(this.settingsFile, "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    return { profile, files, activation: [
      { path: this.registryFile, before: registry, after: json([...await this.registered(), profile]) },
      { path: this.settingsFile, before: settings, after: json({ ...JSON.parse(settings ?? "{}"), setupProfileId: id }) },
    ] };
  }
  async connect(name: string, folder: string): Promise<SetupProfiles> {
    const root = await fs.realpath(folder);
    const reports = await validateManifest(root);
    if (reports.some((report) => !report.ok)) throw new RequestError(422, "선택한 폴더에 유효한 manifest/*.json이 필요합니다");
    if (this.repoRoot && root.toLowerCase() === (await fs.realpath(this.repoRoot)).toLowerCase()) throw new RequestError(409, "HM 앱 레포는 기존 프로필 가져오기로 복사하세요");
    const id = randomUUID();
    const localDir = path.join(this.stateDir, "profiles", id, "local");
    return this.register({ id, name, root, localDir, kind: "linked" }, async () => {
      await writeFileChecked(path.join(localDir, "private-terms.json"), null, json({ terms: [] }));
    });
  }
  async get(id: string): Promise<SetupProfile> {
    const profile = (await this.list()).profiles.find((entry) => entry.id === id);
    if (!profile) throw new RequestError(404, "프로필을 찾지 못했습니다");
    return profile;
  }
  async editor(id: string): Promise<ProfileEditor> {
    const profile = await this.get(id); const document = await readDocument(profile);
    return { profile, document, fingerprint: documentFingerprint(document) };
  }
  async preview(id: string, fingerprint: string, value: unknown): Promise<ProfilePreview> {
    validateDocument(value);
    const before = await this.editor(id);
    if (before.profile.kind === "builtin" || before.profile.kind === "legacy" || before.profile.archived) throw new RequestError(409, "개인 프로필을 만들거나 복원한 뒤 편집하세요");
    if (before.fingerprint !== fingerprint) throw new RequestError(409, "프로필이 변경되었습니다. 다시 불러오세요.");
    // 부분 문서 저장으로 기존 관리 파일이 사라지지 않게 한다.
    const doc = { ...value, files: { ...before.document.files, ...value.files }, personal: { ...before.document.personal, ...value.personal } };
    const changes = [];
    for (const group of ["files", "personal"] as const) for (const [file, after] of Object.entries(doc[group])) {
      const original = before.document[group][file] ?? null;
      if (original !== after) changes.push({ file: `${group}/${file}`, diff: unifiedDiff(file, original, after) });
    }
    if (JSON.stringify(doc.privateTerms) !== JSON.stringify(before.document.privateTerms)) changes.push({ file: "비공개 낱말", diff: unifiedDiff("private-terms", json(before.document.privateTerms), json(doc.privateTerms)) });
    if (JSON.stringify(doc.portable) !== JSON.stringify(before.document.portable)) changes.push({ file: "개인 설정 이동 선택", diff: unifiedDiff("portable", json(before.document.portable), json(doc.portable)) });
    const token = randomUUID();
    if (edits.size >= 30) edits.delete(edits.keys().next().value!);
    edits.set(token, { id, root: before.profile.root, fingerprint, doc });
    return { token, changes, notes: ["프로필만 저장합니다. 실제 PC 반영은 설치 화면에서 미리보기 후 실행하세요."] };
  }
  async apply(id: string, token: string): Promise<ProfileEditor> {
    const plan = edits.get(token);
    if (!plan || plan.id !== id) throw new RequestError(409, "편집 미리보기를 다시 만드세요");
    const current = await this.editor(id);
    await withLock(async () => {
      if (current.profile.root !== plan.root || documentFingerprint(await readDocument(current.profile)) !== plan.fingerprint) throw new RequestError(409, "미리보기 이후 프로필이 변경되었습니다");
      await writeDocument(current.profile, plan.doc); edits.delete(token);
    });
    return this.editor(id);
  }
  async update(id: string, action: "rename" | "archive" | "restore", name?: string): Promise<SetupProfiles> {
    const profile = await this.get(id);
    if (profile.kind === "builtin" || profile.kind === "legacy") throw new RequestError(409, "공통 프로필은 변경할 수 없습니다");
    if (action === "rename" && (!name?.trim() || name.length > 80)) throw new RequestError(400, "이름은 1~80자여야 합니다");
    await withLock(async () => {
      const entries = await this.registered();
      const next = entries.map((p) => p.id === id ? { ...p, ...(action === "rename" ? { name: name!.trim() } : { archived: action === "archive" }) } : p);
      const before = await fs.readFile(this.registryFile, "utf8");
      await writeFileChecked(this.registryFile, before, json(next));
      if (action === "archive" && (await readAppSettings(this.settingsFile)).setupProfileId === id) await updateAppSettings(this.settingsFile, { setupProfileId: "default" });
    });
    return this.list();
  }
  async importBundle(bundle: ProfileBundle): Promise<SetupProfiles> {
    const id = randomUUID();
    const profile: SetupProfile = { id, name: bundle.name, root: path.join(this.stateDir, "profiles", id, "definition"), localDir: path.join(this.stateDir, "profiles", id, "local"), kind: "local" };
    return this.register(profile, () => writeDocument(profile, { files: bundle.files, personal: bundle.personal, portable: Object.keys(bundle.personal), privateTerms: [] }));
  }
  private async register(profile: SetupProfile, prepare: () => Promise<void>): Promise<SetupProfiles> {
    if (!profile.name.trim() || profile.name.length > 80) throw new RequestError(400, "프로필 이름은 1~80자여야 합니다");
    await withLock(async () => {
      const profiles = await this.registered();
      if (profiles.some((entry) => entry.root.toLowerCase() === profile.root.toLowerCase())) throw new RequestError(409, "이미 연결한 프로필 폴더입니다");
      await prepare();
      const before = await fs.readFile(this.registryFile, "utf8").catch(() => null);
      await writeFileChecked(this.registryFile, before, json([...profiles, profile]));
      await updateAppSettings(this.settingsFile, { setupProfileId: profile.id });
    });
    return this.list();
  }
}
