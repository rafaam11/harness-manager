import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SetupProfile, SetupProfiles } from "@shared/setup-profile-types";
import { MANIFEST_FILES } from "@shared/manifest-types";
import { writeFileChecked } from "./capture/capture.js";
import { readAppSettings, updateAppSettings } from "./settings.js";
import { validateManifest } from "./manifest/validate.js";
import { RequestError } from "../ipc-validation.js";
import { withLock } from "../lib/lock.js";

const TEMPLATE_FILES = ["home/managed-keys.json", "home/agents/AGENTS.md", "home/claude/CLAUDE.md", "home/claude/settings.managed.json", "home/codex/config.managed.toml", "home/powershell/profile.ps1", "home/git/gitconfig.json", ...MANIFEST_FILES.map((name) => `manifest/${name}.json`)];
const LOCAL_FILES = ["AGENTS.local.md", "claude-settings.local.json", "codex-config.local.json", "manifest.local.json", "powershell.local.ps1", "gitconfig.local.json", "private-terms.json"];
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
  constructor(readonly stateDir: string, readonly repoRoot: string) {}
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
      return { activeId: settings.setupProfileId ?? "default", profiles: [await this.defaultProfile(), { id: "legacy", name: "기존 jinmin 개인 설정 · 명시적으로 선택", root: this.repoRoot, localDir: path.join(this.stateDir, "profile"), kind: "legacy" }, ...await this.registered()] };
    });
  }
  async active(): Promise<SetupProfile> {
    const { profiles, activeId } = await this.list();
    const selected = profiles.find((profile) => profile.id === activeId);
    if (!selected) throw new RequestError(409, "선택한 사용자 프로필이 없습니다. 위저드에서 다시 선택하세요.");
    const reports = await validateManifest(selected.root);
    const failures = reports.filter((report) => !report.ok);
    if (failures.length) throw new RequestError(422, `프로필 manifest 오류: ${failures.map((report) => `${report.path}: ${report.errors.join(", ")}`).join(" · ")}`);
    return selected;
  }
  async select(id: string): Promise<SetupProfiles> {
    const list = await this.list();
    const selected = list.profiles.find((profile) => profile.id === id);
    if (!selected) throw new RequestError(404, "사용자 프로필을 찾지 못했습니다");
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
        await writeFileChecked(path.join(root, file), null, await fs.readFile(from, "utf8"));
      }
      for (const file of LOCAL_FILES) {
        const from = path.join(base.localDir, file);
        const stat = await fs.lstat(from).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
        if (!stat) continue;
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error(`복사할 수 없는 로컬 프로필 파일: ${file}`);
        await writeFileChecked(path.join(localDir, file), null, await fs.readFile(from, "utf8"));
      }
      const terms = path.join(localDir, "private-terms.json");
      if (!await fs.stat(terms).catch(() => null)) await writeFileChecked(terms, null, json({ terms: [] }));
    });
  }
  async connect(name: string, folder: string): Promise<SetupProfiles> {
    const root = await fs.realpath(folder);
    const reports = await validateManifest(root);
    if (reports.some((report) => !report.ok)) throw new RequestError(422, "선택한 폴더에 유효한 manifest/*.json이 필요합니다");
    if (root.toLowerCase() === (await fs.realpath(this.repoRoot)).toLowerCase()) throw new RequestError(409, "HM 앱 레포는 기존 jinmin 프로필로 이미 등록되어 있습니다");
    const id = randomUUID();
    const localDir = path.join(this.stateDir, "profiles", id, "local");
    return this.register({ id, name, root, localDir, kind: "linked" }, async () => {
      await writeFileChecked(path.join(localDir, "private-terms.json"), null, json({ terms: [] }));
    });
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
