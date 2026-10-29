import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PluginsSnapshot } from "@shared/api-types";
import type { ProviderId } from "@shared/provider-types";
import { MOD_PARITY } from "@shared/mod-parity";
import type { AutomationStatus, ComponentDefinition, ComponentKind, ManagedComponent, VersionLock, WorkbenchPlan, WorkbenchSnapshot, UpdateCandidate } from "@shared/workbench-types";
import { APP_STATE_DIR } from "../../config.js";
import { RequestError } from "../../ipc-validation.js";
import { sha256 } from "../../lib/safe-write.js";
import { withLock } from "../../lib/lock.js";
import { detectProcess } from "../../lib/process-detect.js";
import { getProviders } from "../../providers/registry.js";
import type { ProviderAdapter } from "../../providers/types.js";
import { getAllPlugins } from "../plugins.js";
import { defaultInstallContext, planInstallWith, previewManagedProfileFiles, runInstallWith, type InstallContext } from "../install/engine.js";
import { SetupProfileStore } from "../setup-profiles.js";
import { ProfileSync } from "../profile-sync.js";
import { profileFile, readProfileFile, stringify, transferProblem, writeDocument } from "../profile-document.js";
import { unifiedDiff } from "../capture/text.js";
import { upsertMarkerBlock } from "../install/merge.js";
import { DEFINITION_FILE, ordinaryFiles, parseDefinition, validateComponent } from "./definition.js";
import { ChangeHistory, readText, type FileChange } from "./history.js";
import { writeFileChecked } from "../capture/capture.js";
import { probeMcp, type McpProbeResult } from "./mcp-probe.js";
import { powershellProfilePath } from "../dotfiles.js";
import { PROFILE_FILES, PERSONAL_FILES, type SetupProfile } from "@shared/setup-profile-types";
import { discoverSkills, fetchSkill } from "./github.js";
import { CliSettingsService, type CliChange } from "../cli-settings/service.js";
import { projectCliSettings } from "../cli-settings/projection.js";
import { CLI_SETTINGS_FILE, CLI_SETTINGS_LOCAL } from "../cli-settings/definition.js";
import type { SettingsEdit, ExtensionEdit } from "@shared/cli-settings-types";

interface Pending { profileId: string; definition: string | null; files: FileChange[]; stepIds: string[]; title: string; automatic: boolean; restore?: string; installDigest?: string; candidate?: ComponentDefinition[]; destination?: SetupProfile; verify?(signal: AbortSignal): Promise<void>; checkLocal?(): Promise<void>; stagedContext?: InstallContext; cli?: CliChange; probe?: { id: string; fingerprint: string } }
export interface WorkbenchDependencies {
  stateDir: string; context(): Promise<InstallContext>; providers: ProviderAdapter[]; plugins(): Promise<PluginsSnapshot>;
  receiveRemote?(profileId: string, signal: AbortSignal): Promise<string>;
}
export const defaultWorkbenchDependencies = (repoRoot: string | null): WorkbenchDependencies => ({ stateDir: APP_STATE_DIR, context: () => defaultInstallContext(repoRoot), providers: getProviders().map(p => ({ ...p, detectRunning: () => detectProcess(process.platform === "win32" ? [`${p.id}.exe`] : [p.id], true) })), plugins: getAllPlugins, receiveRemote: (id, signal) => new ProfileSync(new SetupProfileStore(APP_STATE_DIR, repoRoot)).receiveAutomatic(id, signal) });
export class WorkbenchService {
  private plans = new Map<string, Pending>();
  private lastPoll = 0;
  private probes = new Map<string, { fingerprint: string; result: McpProbeResult; at: string }>();
  private lastDefinition = "";
  private status: AutomationStatus = { running: false, detail: "아직 자동 확인하지 않았습니다", pending: [] };
  constructor(readonly deps: WorkbenchDependencies) {}
  get cliSettings() { return new CliSettingsService(this.deps); }
  async prepareSettings(edits: SettingsEdit[], extension?: ExtensionEdit) {
    const c = await this.context();
    const change = await this.cliSettings.prepare(edits, extension);
    return { ...this.remember({ profileId: c.profile.id, definition: c.definition, files: change.files, stepIds: [], title: change.title, automatic: false, destination: change.destination, cli: change, verify: change.verify, checkLocal: change.verify }, change.notes, change.commands.map(spec => `${spec.command} ${spec.args.join(" ")}`)), scope: "settings-and-pc" as const };
  }
  private async context() {
    const ctx = await this.deps.context();
    const root = ctx.templateRoot ?? ctx.repoRoot;
    if (!root) throw new RequestError(422, "프로필을 선택하세요");
    const profile = ctx.setupProfile ?? { id: "legacy", name: "기존 프로필", root };
    return { ctx, root, profile, definition: await readProfileFile(root, DEFINITION_FILE) };
  }
  private lockFile(profileId: string) { return path.join(this.deps.stateDir, "workbench", `lock-${sha256(profileId)}.json`); }
  private async lock(profileId: string): Promise<VersionLock> {
    await profileFile(this.deps.stateDir, `workbench/${path.basename(this.lockFile(profileId))}`);
    const raw = await readText(this.lockFile(profileId));
    return raw ? JSON.parse(raw) : { schemaVersion: 1, profileId, at: "", entries: [] };
  }
  private async targetFiles(ctx: InstallContext, component: ComponentDefinition): Promise<string[]> {
    const result: string[] = [];
    for (const provider of component.targets) for (const relative of Object.keys(component.files)) {
      const root = provider === "claude" ? ctx.claudeHome : ctx.codexHome;
      result.push(await profileFile(root, component.kind === "skill" ? `skills/${component.id}/${relative}` : provider === "claude" ? "CLAUDE.md" : "AGENTS.md"));
    }
    return result;
  }
  private async history(archivedDefinitions: ComponentDefinition[] = [], destination?: SetupProfile) {
    const original = await this.context();
    const c = destination ? { ...original, root: destination.root, profile: destination, definition: await readProfileFile(destination.root, DEFINITION_FILE) } : original;
    const definition = parseDefinition(c.definition);
    const allowed = new Set([await profileFile(c.root, DEFINITION_FILE), this.lockFile(c.profile.id)]);
    const localDir = "localDir" in c.profile && typeof c.profile.localDir === "string" ? c.profile.localDir : c.ctx.profileDir;
    for (const file of PROFILE_FILES) allowed.add(await profileFile(c.root, file));
    if (localDir) for (const file of [...PERSONAL_FILES, "private-terms.json", "portability.json"]) allowed.add(await profileFile(localDir, file));
    for (const file of ["setup-profiles.json", "settings.json"]) allowed.add(await profileFile(this.deps.stateDir, file));
    const syncMetadata = await profileFile(this.deps.stateDir, `profiles/${c.profile.id}/github.json`);
    allowed.add(syncMetadata);
    allowed.add(powershellProfilePath(c.ctx.documentsDir));
    for (const [root, name] of [[c.ctx.claudeHome, "CLAUDE.md"], [c.ctx.claudeHome, "settings.json"], [c.ctx.codexHome, "AGENTS.md"], [c.ctx.codexHome, "config.toml"]]) allowed.add(await profileFile(root!, name!));
    for (const item of [...definition.components, ...archivedDefinitions]) for (const file of await this.targetFiles(c.ctx, { ...item, targets: ["claude", "codex"] })) allowed.add(file);
    // 복원 경로는 현재 설정과 검증된 후보에서 파일 단위로 파생한다.
    return new ChangeHistory(path.join(this.deps.stateDir, "workbench", "history"), async file => {
      if (!allowed.has(file)) throw new RequestError(403, "현재 프로필에서 허용하지 않는 복원 경로입니다");
      if (file === path.join(c.root, DEFINITION_FILE)) await profileFile(c.root, DEFINITION_FILE);
      else if (file.startsWith(c.root + path.sep)) await profileFile(c.root, path.relative(c.root, file).split(path.sep).join("/"));
      else if (localDir && file.startsWith(localDir + path.sep)) await profileFile(localDir, path.relative(localDir, file).split(path.sep).join("/"));
      else if (["setup-profiles.json", "settings.json"].some(name => file === path.join(this.deps.stateDir, name))) await profileFile(this.deps.stateDir, path.basename(file));
      else if (file === syncMetadata) await profileFile(this.deps.stateDir, `profiles/${c.profile.id}/github.json`);
      else if (file === powershellProfilePath(c.ctx.documentsDir)) await profileFile(c.ctx.documentsDir, "WindowsPowerShell/Microsoft.PowerShell_profile.ps1");
      else if (file === this.lockFile(c.profile.id)) await profileFile(this.deps.stateDir, `workbench/${path.basename(file)}`);
      else for (const root of [c.ctx.claudeHome, c.ctx.codexHome]) if (file.startsWith(root + path.sep)) await profileFile(root, path.relative(root, file).split(path.sep).join("/"));
    });
  }
  async snapshot(): Promise<WorkbenchSnapshot> {
    const c = await this.context(); const definition = parseDefinition(c.definition); const at = new Date().toISOString();
    const items: ManagedComponent[] = []; const warnings: string[] = [];
    const bindings = new Map<string, ManagedComponent>();
    const paths = new Set<string>();
    for (const item of definition.components) {
      const observations = [];
      for (const provider of ["claude", "codex"] as const) {
        const targets = await this.targetFiles(c.ctx, { ...item, targets: [provider] });
        const present = await Promise.all(targets.map(readText));
        const enabled = item.targets.includes(provider);
        const matches = enabled && present.every((text, i) => item.kind === "instruction" ? text?.includes(Object.values(item.files)[i]!.trim()) : text === Object.values(item.files)[i]);
        observations.push({ provider, installed: present.every(p => p !== null), enabled, comparison: !enabled ? "outside" as const : matches ? "match" as const : present.some(p => p === null) ? "missing" as const : "different" as const, recognition: "unverified" as const, execution: "unverified" as const, compatibility: "native" as const, checkedAt: at, detail: !enabled ? "적용 대상 아님" : matches ? "내 설정과 일치 · 세션 인식은 별도 검사" : "설정 차이 또는 설치 필요" });
        if (enabled) for (const target of targets) paths.add(target);
      }
      items.push({ id: `definition:${item.id}`, definitionId: item.id, name: item.name, description: item.description, kind: item.kind, source: item.source.kind === "github" ? `${item.source.repository}@${item.source.revision?.slice(0, 8)}` : "내 설정", managed: true, observations, stepIds: [], issue: observations.some(o => o.enabled && o.comparison !== "match") ? "내 설정과 다름" : undefined });
    }
    for (const provider of this.deps.providers) {
      try {
        for (const item of await provider.listCatalog()) {
          if (paths.has(item.path)) continue;
          items.push({ id: `catalog:${provider.id}:${sha256(item.path)}`, name: item.name, description: item.description, kind: item.kind, source: item.path.includes(`${path.sep}plugins${path.sep}`) ? "설치된 플러그인" : "기존 로컬 파일", managed: false, catalogPath: item.path, stepIds: [], issue: item.warn, observations: [{ provider: provider.id, installed: true, enabled: null, recognition: "unverified", execution: "unverified", compatibility: "unverified", detail: "파일 발견 · 활성·인식은 미검증", checkedAt: at }] });
        }
        for (const server of await provider.readMcpServers()) {
          const item: ManagedComponent = { id: `mcp:${provider.id}:${sha256(JSON.stringify([server.scope, server.projectPath, server.name]))}`, name: server.name, description: `${server.transport} · ${server.scope === "user" ? "전역" : "프로젝트 (읽기 전용)"}`, kind: "mcp", source: "CLI 설정", managed: false, stepIds: [], observations: [{ provider: provider.id, installed: true, enabled: null, recognition: "unverified", execution: "unverified", compatibility: "unverified", checkedAt: at, detail: "설정 발견 · 실제 연결은 검사하지 않음" }] };
          items.push(item); if (server.scope === "user") bindings.set(`mcp.${server.name}.${provider.id}`, item);
          const probe = this.probes.get(item.id);
          if (probe?.fingerprint === sha256(stringify(server))) { const observation = item.observations[0]!; observation.execution = probe.result.ok ? "confirmed" : "unverified"; observation.detail = probe.result.detail; observation.checkedAt = probe.at; }
        }
      } catch (e) { warnings.push(`${provider.label}: ${(e as Error).message}`); }
    }
    try {
      const plugins = await this.deps.plugins(); warnings.push(...plugins.warnings ?? []);
      for (const p of plugins.plugins) {
        const mod = p.id.endsWith("@jinmin") && (p.id.startsWith("jinmin-codex@") || MOD_PARITY.some(m => p.id.startsWith(`${m.claude}@`)));
        const compatibility = p.provider === "codex" && mod ? p.id.includes("jinmin-codex") ? "alternative" as const : "unsupported" as const : "unverified" as const;
        const item: ManagedComponent = { id: `plugin:${p.id}`, name: p.id, description: mod ? "hook·상태·가드 확장" : "설치된 플러그인 패키지", source: p.id.split("@")[1] ?? "CLI 플러그인", kind: mod ? "mod" : "plugin", managed: false, stepIds: [], observations: [{ provider: p.provider ?? "claude", installed: p.installs.length > 0, enabled: p.enabledInSettings, recognition: "unverified", execution: "unverified", compatibility, detail: p.blocked ? "차단 목록에 있음" : compatibility === "unsupported" ? "Claude hook 형식은 Codex에서 실행되지 않음" : "hook 신뢰·실행은 별도 검토", checkedAt: at, version: p.installs[0]?.version }] };
        const existing = items.find(i => i.id === item.id); if (existing) existing.observations.push(...item.observations); else items.push(item);
        bindings.set(`plugins.${p.provider ?? "claude"}.${p.id}`, existing ?? item);
      }
    } catch (e) { warnings.push((e as Error).message); }
    const plan = await planInstallWith(c.ctx);
    for (const step of plan.steps) {
      if (step.id.startsWith("components.")) continue;
      const existing = bindings.get(step.id);
      if (existing) { existing.managed = true; existing.stepIds.push(step.id); if (!["ok", "info", "skipped"].includes(step.state)) existing.issue = step.detail; continue; }
      const kind: ComponentKind = step.section === "mcp" ? "mcp" : step.section === "plugins" ? "plugin" : step.section === "skills" ? "skill" : /claude-md|agents-md/.test(step.id) ? "instruction" : "environment";
      const provider: ProviderId | null = /(^claude\.|\.claude\.|\.claude$)/.test(step.id) ? "claude" : /(^codex\.|\.codex\.|\.codex$)/.test(step.id) ? "codex" : null;
      items.push({ id: `step:${step.id}`, name: step.title, description: step.detail, kind, source: "내 설정의 설치 항목", managed: true, stepIds: [step.id], issue: ["ok", "info", "skipped"].includes(step.state) ? undefined : step.detail, observations: (provider ? [provider] : ["claude", "codex"] as const).map(target => ({ provider: target, installed: step.state === "missing" ? false : step.state === "ok" ? true : null, enabled: step.state === "skipped" ? false : null, comparison: step.state === "skipped" ? "outside" : "unknown", recognition: "unverified", execution: "unverified", compatibility: "unverified", detail: step.detail, checkedAt: at })) });
    }
    return { profile: { id: c.profile.id, name: c.profile.name, kind: c.profile.id === "default" ? "builtin" : "local" }, migrated: c.definition !== null, automatic: definition.automatic, components: items, warnings, checkedAt: at };
  }
  async definition(id: string) { return parseDefinition((await this.context()).definition).components.find(c => c.id === id) ?? null; }
  private async mcp(id: string) {
    for (const provider of this.deps.providers) for (const server of await provider.readMcpServers()) if (server.scope === "user" && id === `mcp:${provider.id}:${sha256(JSON.stringify([server.scope, server.projectPath, server.name]))}`) return server;
    throw new RequestError(422, "발견한 전역 MCP만 연결 검사할 수 있습니다");
  }
  async probePreview(id: string) {
    const server = await this.mcp(id); const c = await this.context();
    return this.remember({ profileId: c.profile.id, definition: c.definition, files: [], stepIds: [], automatic: false, title: `${server.name} 연결 검사`, probe: { id, fingerprint: sha256(stringify(server)) } }, ["등록된 MCP 프로세스를 시작하거나 서버에 연결합니다. 초기화만 검사하고 도구 호출·모델 요청은 보내지 않습니다.", "10초 제한 · 프로젝트 MCP는 읽기 전용입니다."], [server.transport === "stdio" ? `등록된 실행 파일: ${server.command} · ${server.args?.length ?? 0}개 인자 (비밀 인자는 표시하지 않음)` : `등록된 ${server.transport} 서버에 초기화 요청`]);
  }
  async versionLock() { return this.lock((await this.context()).profile.id); }
  private remember(pending: Pending, notes: string[] = [], commands: string[] = []): WorkbenchPlan {
    if (this.plans.size >= 20) void this.discard(this.plans.keys().next().value!);
    const token = randomUUID(); this.plans.set(token, pending);
    return { token, title: pending.title, files: pending.files.map(f => ({ path: f.path, diff: unifiedDiff(f.path, f.before ?? "", f.after ?? "") })), commands, notes, automatic: pending.automatic };
  }
  private async cleanupPreview(pending: Pending) {
    if (!pending.stagedContext?.templateRoot) return;
    const stage = path.dirname(pending.stagedContext.templateRoot);
    const parent = path.resolve(this.deps.stateDir, "workbench", "previews");
    // 앱이 만든 임시 사본만 지운다. 연결된 사용자 폴더는 이 경로를 통과할 수 없다.
    if (path.dirname(stage) !== parent || !/^[a-f0-9-]{36}$/.test(path.basename(stage))) return;
    await profileFile(this.deps.stateDir, `workbench/previews/${path.basename(stage)}`);
    await fs.rm(stage, { recursive: true, force: true, maxRetries: 3 });
  }
  async discard(token: string) {
    const pending = this.plans.get(token); this.plans.delete(token);
    if (pending) await this.cleanupPreview(pending).catch(() => undefined);
  }
  async migrate(automatic: boolean): Promise<WorkbenchPlan> {
    const c = await this.context(); if (c.profile.id === "default") throw new RequestError(422, "공통 기본에서 개인 프로필 사본을 먼저 만드세요");
    const definition = parseDefinition(c.definition); definition.automatic = automatic;
    return { ...this.remember({ profileId: c.profile.id, definition: c.definition, files: [{ path: await profileFile(c.root, DEFINITION_FILE), before: c.definition, after: stringify(definition) }], stepIds: [], title: "문서 자동 적용 정책 변경", automatic: false }, ["일반 문서만 자동 적용하며 권한·hook·MCP·플러그인은 검토를 기다립니다."]), scope: "settings" };
  }
  /** 기준 파일과 PC 파일을 한 저널에 넣어 저장/적용 사이의 중간 상태를 없앤다. */
  async prepare(value: unknown): Promise<WorkbenchPlan> {
    const item = validateComponent(value);
    const issue = transferProblem(JSON.stringify(item)); if (issue) throw new RequestError(422, issue);
    const c = await this.context();
    const copy = c.profile.id === "default" ? await new SetupProfileStore(this.deps.stateDir, c.ctx.repoRoot).preparePersonalCopy() : null;
    const destination = copy?.profile;
    const root = destination?.root ?? c.root;
    const profileId = destination?.id ?? c.profile.id;
    const definition = parseDefinition(c.definition);
    const previous = definition.components.find(i => i.id === item.id);
    if (previous && previous.kind !== item.kind) throw new RequestError(422, "기존 항목의 종류는 변경할 수 없습니다");
    definition.components = [...definition.components.filter(i => i.id !== item.id), item];
    if (!c.definition) definition.automatic = c.profile.id === "default";
    parseDefinition(stringify(definition));
    const files = await this.componentChanges(c.ctx, previous ? [previous] : [], [item]);
    const definitionPath = await profileFile(root, DEFINITION_FILE);
    const bootstrap = (copy?.files ?? []).filter(f => f.path !== definitionPath);
    const lock = await this.lock(profileId);
    const appliedHashes: Record<string, string> = {};
    for (const file of await this.targetFiles(c.ctx, item)) {
      const text = files.find(f => f.path === file)?.after ?? await readText(file);
      if (text !== null) appliedHashes[file] = sha256(text);
    }
    const entries = [...lock.entries.filter(e => e.id !== item.id), { id: item.id, source: item.source, digest: sha256(stringify(item.files)), appliedHashes }];
    const plan = this.remember({ profileId: c.profile.id, definition: c.definition, destination, candidate: [item, ...(previous ? [previous] : [])], stepIds: [], automatic: false, title: `${item.name} 변경`, files: [
      ...bootstrap,
      { path: definitionPath, before: destination ? null : c.definition, after: stringify(definition) },
      ...files,
      { path: this.lockFile(profileId), before: await readText(this.lockFile(profileId)), after: stringify({ ...lock, entries, at: new Date().toISOString() }) },
      ...(copy?.activation ?? []),
    ] }, [...(copy ? ["일반 문서 자동 적용을 켭니다. 앱 설정에서 바꿀 수 있습니다."] : []), ...(ordinaryFiles(item) ? [] : ["실행 파일이 포함되어 있습니다. 자세히에서 내용을 확인하세요."])]);
    return { ...plan, targets: item.targets, scope: "settings-and-pc" };
  }
  async receivePreview(signal: AbortSignal, prepared?: Awaited<ReturnType<ProfileSync["prepareReceive"]>>) {
    const c = await this.context();
    const packet = prepared ?? await new ProfileSync(new SetupProfileStore(this.deps.stateDir, c.ctx.repoRoot)).prepareReceive(c.profile.id, signal);
    if (packet.profile.id !== c.profile.id) throw new RequestError(409, "내 설정이 바뀌었습니다. 다시 검토하세요.");
    const stage = path.join(this.deps.stateDir, "workbench", "previews", randomUUID());
    const stagedProfile: SetupProfile = { ...packet.profile, root: path.join(stage, "definition"), localDir: path.join(stage, "local") };
    await writeDocument(stagedProfile, packet.document);
    const stagedContext = { ...c.ctx, templateRoot: stagedProfile.root, profileDir: stagedProfile.localDir };
    const files: FileChange[] = [];
    const changed: string[] = [];
    for (const group of ["files", "personal"] as const) for (const key of new Set([...Object.keys(packet.before[group]), ...Object.keys(packet.document[group])])) {
      const before = packet.before[group][key] ?? null, after = packet.document[group][key] ?? null;
      if (before !== after) { changed.push(key); files.push({ path: await profileFile(group === "files" ? c.root : packet.profile.localDir, key), before, after }); }
    }
    if (stringify(packet.before.portable) !== stringify(packet.document.portable)) {
      const file = await profileFile(packet.profile.localDir, "portability.json");
      files.push({ path: file, before: await readText(file), after: stringify({ portable: packet.document.portable }) });
    }
    const previous = parseDefinition(c.definition).components;
    const next = parseDefinition(packet.document.files[DEFINITION_FILE] ?? null).components;
    const pcFiles = await this.componentChanges(c.ctx, previous, next);
    for (const file of await previewManagedProfileFiles(stagedContext, changed)) {
      const index = pcFiles.findIndex(f => f.path === file.absPath);
      const adjusted = { path: file.absPath, before: file.before, after: file.after };
      // 공통 지침과 개별 지침이 같은 파일을 쓰면 두 관리 블록을 모두 보존한다.
      const own = pcFiles[index];
      if (own) {
        let after = adjusted.after;
        for (const item of previous.filter(i => i.kind === "instruction")) if ((await this.targetFiles(c.ctx, item)).includes(file.absPath)) after = after.replace(new RegExp(`\\n?<!-- >>> harness-manager:${item.id} >>> -->[\\s\\S]*?<!-- <<< harness-manager:${item.id} <<< -->\\n?`), "\n");
        for (const item of next.filter(i => i.kind === "instruction")) if ((await this.targetFiles(c.ctx, item)).includes(file.absPath)) after = upsertMarkerBlock(after, Object.values(item.files)[0]!, { start: `<!-- >>> harness-manager:${item.id} >>> -->`, end: `<!-- <<< harness-manager:${item.id} <<< -->` });
        pcFiles[index] = { ...adjusted, after };
      } else pcFiles.push(adjusted);
    }
    for (const file of (await projectCliSettings(stagedContext, undefined, pcFiles)).files) {
      const index = pcFiles.findIndex(f => f.path === file.path);
      if (index >= 0) pcFiles[index] = file; else pcFiles.push(file);
    }
    const install = await planInstallWith(stagedContext);
    const commandChanged = (id: string) =>
      (changed.includes("manifest/packages.json") && id.startsWith("packages.")) ||
      (changed.includes("manifest/tools.json") && id.startsWith("tools.")) ||
      ((changed.includes("manifest/plugins.json") || changed.includes("manifest.local.json")) && id.startsWith("plugins.")) ||
      ((changed.includes("manifest/mcp.json") || changed.includes("manifest.local.json")) && id.startsWith("mcp.")) ||
      ((changed.includes("manifest/skills.json") || changed.includes("manifest.local.json")) && id.startsWith("skills.")) ||
      (["home/git/gitconfig.json", "gitconfig.local.json", "home/managed-keys.json"].some(file => changed.includes(file)) && id === "dotfiles.git");
    const steps = install.steps.filter(s => commandChanged(s.id) && s.actionable && s.actions.some(a => a.kind === "command"));
    const lock = await this.lock(c.profile.id);
    const entries = [];
    for (const item of next) {
      const appliedHashes: Record<string, string> = {};
      for (const file of await this.targetFiles(c.ctx, item)) { const text = pcFiles.find(f => f.path === file)?.after ?? await readText(file); if (text !== null) appliedHashes[file] = sha256(text); }
      entries.push({ id: item.id, source: item.source, digest: sha256(stringify(item.files)), appliedHashes });
    }
    const plan = this.remember({ profileId: c.profile.id, definition: c.definition, files: [...files, ...pcFiles, { path: this.lockFile(c.profile.id), before: await readText(this.lockFile(c.profile.id)), after: stringify({ ...lock, entries, at: new Date().toISOString() }) }, packet.metadata], stepIds: steps.map(s => s.id), installDigest: sha256(stringify(steps)), stagedContext, verify: packet.verify, checkLocal: packet.checkLocal, candidate: [...previous, ...next], title: "다른 PC의 변경 받기", automatic: false }, ["다른 PC의 변경을 내 설정과 이 PC에 함께 적용합니다.", ...(steps.length ? ["외부 설치 명령은 자동 복원되지 않습니다. 실패하면 기준 설정 저장을 보류하고 완료·실패 항목을 기록합니다."] : [])], steps.flatMap(s => s.actions.map(a => a.summary)));
    return { ...plan, scope: "settings-and-pc" as const, targets: ["claude", "codex"] as ProviderId[] };
  }
  private async componentChanges(ctx: InstallContext, previous: ComponentDefinition[], next: ComponentDefinition[]) {
    const files = new Map<string, FileChange>();
    const original = async (file: string) => files.get(file)?.after ?? await readText(file);
    const put = async (file: string, after: string | null) => {
      const before = files.get(file)?.before ?? await readText(file);
      files.set(file, { path: file, before, after });
    };
    for (const old of previous) {
      const replacement = next.find(i => i.id === old.id);
      const retained = replacement ? await this.targetFiles(ctx, replacement) : [];
      for (const file of await this.targetFiles(ctx, old)) if (!retained.includes(file)) {
        const before = await original(file);
        if (before !== null) await put(file, old.kind === "instruction" ? before.replace(new RegExp(`\\n?<!-- >>> harness-manager:${old.id} >>> -->[\\s\\S]*?<!-- <<< harness-manager:${old.id} <<< -->\\n?`), "\n") : null);
      }
    }
    for (const item of next) for (const provider of item.targets) {
      const targets = await this.targetFiles(ctx, { ...item, targets: [provider] });
      for (const [index, text] of Object.values(item.files).entries()) {
        const target = targets[index]!;
        const after = item.kind === "instruction" ? upsertMarkerBlock(await original(target) ?? "", text, { start: `<!-- >>> harness-manager:${item.id} >>> -->`, end: `<!-- <<< harness-manager:${item.id} <<< -->` }) : text;
        await put(target, after);
      }
    }
    return [...files.values()].filter(f => f.before !== f.after);
  }
  async save(value: unknown): Promise<WorkbenchPlan> {
    const item = validateComponent(value); const c = await this.context();
    if (c.profile.id === "default") throw new RequestError(422, "공통 기본은 읽기 전용입니다. 개인 사본을 만드세요");
    if (!c.definition) throw new RequestError(422, "먼저 개인 프로필을 v4로 전환하세요");
    const definition = parseDefinition(c.definition);
    const issue = transferProblem(JSON.stringify(item)); if (issue) throw new RequestError(422, issue);
    const previous = definition.components.find(i => i.id === item.id);
    if (previous && previous.kind !== item.kind) throw new RequestError(422, "기존 항목의 종류는 변경할 수 없습니다");
    const retired: FileChange[] = [];
    if (previous) for (const file of await this.targetFiles(c.ctx, previous)) if (!(await this.targetFiles(c.ctx, item)).includes(file)) {
      const before = await readText(file);
      if (before !== null) retired.push({ path: file, before, after: previous.kind === "instruction" ? before.replace(new RegExp(`\\n?<!-- >>> harness-manager:${previous.id} >>> -->[\\s\\S]*?<!-- <<< harness-manager:${previous.id} <<< -->\\n?`), "\n") : null });
    }
    definition.components = [...definition.components.filter(i => i.id !== item.id), item];
    parseDefinition(stringify(definition));
    return this.remember({ profileId: c.profile.id, definition: c.definition, files: [{ path: await profileFile(c.root, DEFINITION_FILE), before: c.definition, after: stringify(definition) }, ...retired], stepIds: [], title: `${item.name} 프로필 저장`, automatic: false }, ["프로필 저장과 PC 적용은 별도입니다. 다음 단계에서 실제 파일 변경을 검토하세요.", ...(retired.length ? ["적용 대상에서 빠진 관리 파일은 이력 보관 폴더로 옮깁니다."] : [])]);
  }
  async adopt(id: string, unified = false): Promise<WorkbenchPlan> {
    const item = (await this.snapshot()).components.find(i => i.id === id);
    if (!item?.catalogPath || !["skill", "instruction"].includes(item.kind)) throw new RequestError(422, "일반 로컬 스킬·지침만 가져올 수 있습니다");
    if (item.source === "설치된 플러그인") throw new RequestError(422, "플러그인은 패키지 단위로 관리합니다");
    const provider = this.deps.providers.find(p => p.id === item.observations[0]?.provider)!;
    const relative = path.relative(provider.roots.home, item.catalogPath).split(path.sep).join("/");
    await profileFile(provider.roots.home, relative);
    const body = await readText(item.catalogPath); if (body === null) throw new RequestError(409, "파일이 사라졌습니다");
    // 스크립트가 있는 스킬을 문서만 복사해 불완전한 설치로 만들지 않는다.
    if (item.kind === "skill" && (await fs.readdir(path.dirname(item.catalogPath))).some(p => p !== "SKILL.md")) throw new RequestError(422, "추가 파일이 있는 스킬은 GitHub 소스로 패키지 전체를 가져오세요");
    return this[unified ? "prepare" : "save"]({ id: item.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 80), name: item.name, kind: item.kind, description: item.description, targets: ["claude", "codex"], source: { kind: "profile" }, files: { [item.kind === "skill" ? "SKILL.md" : "instructions.md"]: body } });
  }
  async preview(ids: string[]): Promise<WorkbenchPlan> {
    const c = await this.context(); const definition = parseDefinition(c.definition); const lock = await this.lock(c.profile.id);
    const files: FileChange[] = []; const notes: string[] = []; const stepIds: string[] = []; const commands: string[] = [];
    const snapshot = await this.snapshot(); const install = await planInstallWith(c.ctx);
    for (const id of [...new Set(ids)]) {
      const item = snapshot.components.find(i => i.id === id); if (!item) throw new RequestError(404, "구성요소가 바뀌었습니다");
      if (item.definitionId) {
        const def = definition.components.find(i => i.id === item.definitionId)!;
        for (const provider of def.targets) {
          const targets = await this.targetFiles(c.ctx, { ...def, targets: [provider] });
          for (const [index, text] of Object.values(def.files).entries()) {
            const target = targets[index]!; const before = await readText(target);
            const after = def.kind === "instruction" ? upsertMarkerBlock(before ?? "", Object.values(def.files)[0]!, { start: `<!-- >>> harness-manager:${def.id} >>> -->`, end: `<!-- <<< harness-manager:${def.id} <<< -->` }) : text;
            if (before !== after) files.push({ path: target, before, after });
          }
        }
        if (!ordinaryFiles(def)) notes.push(`${def.name}: 실행 코드 포함 · 자동 적용 제외`);
      } else {
        if (!item.stepIds.length) throw new RequestError(422, "현재 프로필로 가져온 뒤 관리하세요");
        for (const stepId of item.stepIds) {
          const step = install.steps.find(s => s.id === stepId)!; stepIds.push(stepId);
          commands.push(...step.actions.map(a => a.summary)); notes.push("기존 설치 엔진을 실행합니다. 패키지 작업은 자동 복원되지 않습니다.");
        }
      }
    }
    if (files.length && stepIds.length) throw new RequestError(422, "문서 파일과 패키지 작업은 각각 검토·적용하세요");
    const needsLock = ids.some(id => { const def = definition.components.find(i => `definition:${i.id}` === id); const previous = lock.entries.find(e => e.id === def?.id); return def && (!previous || previous.digest !== sha256(stringify(def.files)) || stringify(previous.source) !== stringify(def.source)); });
    if (files.length || needsLock) {
      const entries = [...lock.entries];
      for (const id of ids) {
        const def = definition.components.find(i => `definition:${i.id}` === id); if (!def) continue;
        const appliedHashes: Record<string, string> = {};
        for (const file of await this.targetFiles(c.ctx, def)) { const text = files.find(f => f.path === file)?.after ?? await readText(file); if (text !== null) appliedHashes[file] = sha256(text); }
        const entry = { id: def.id, source: def.source, digest: sha256(stringify(def.files)), appliedHashes }; const index = entries.findIndex(e => e.id === def.id); if (index >= 0) entries[index] = entry; else entries.push(entry);
      }
      files.push({ path: this.lockFile(c.profile.id), before: await readText(this.lockFile(c.profile.id)), after: stringify({ ...lock, entries, at: new Date().toISOString() }) });
    }
    return this.remember({ profileId: c.profile.id, definition: c.definition, files, stepIds, title: `${ids.length}개 구성요소 적용`, automatic: false, installDigest: stepIds.length ? sha256(stringify(install.steps.filter(s => stepIds.includes(s.id)))) : undefined }, notes, commands);
  }
  async apply(token: string, signal = new AbortController().signal, actor: "user" | "automatic" = "user") {
    const pending = this.plans.get(token); this.plans.delete(token);
    if (!pending) throw new RequestError(409, "변경 미리보기를 다시 만드세요");
    try { await this.applyPrepared(pending, signal, actor); }
    finally { await this.cleanupPreview(pending).catch(() => undefined); }
  }
  private async applyPrepared(pending: Pending, signal: AbortSignal, actor: "user" | "automatic") {
    const c = await this.context();
    if (pending.profileId !== c.profile.id || pending.definition !== c.definition) throw new RequestError(409, "내 설정이 변경되었습니다. 다시 검토하세요");
    signal.throwIfAborted();
    await pending.verify?.(signal);
    if (pending.cli?.commands.length) {
      const detail: string[] = [];
      let failed = false;
      for (const spec of pending.cli.commands) {
        signal.throwIfAborted();
        const result = await c.ctx.runner.run({ ...spec, env: { ...c.ctx.env, CLAUDE_CONFIG_DIR: c.ctx.claudeHome, CODEX_HOME: c.ctx.codexHome } }, () => undefined, signal);
        detail.push(`${spec.command} ${spec.args.join(" ")}: ${result.code === 0 ? "완료" : "실패"}`);
        if (result.code !== 0 || result.timedOut || result.notFound) { failed = true; break; }
      }
      if (!failed) {
        const snapshot = await this.deps.plugins();
        for (const extension of pending.cli.effective.extensions) {
          const installed = snapshot.plugins.find(p => p.provider === extension.provider && p.id === extension.id);
          if (extension.enabled && !installed?.installs.length || extension.provider === "claude" && installed && installed.enabledInSettings !== extension.enabled) { failed = true; detail.push("설치·활성 상태 재검증 실패"); }
        }
      }
      await (await this.history()).recordCommand(c.profile.id, pending.title, detail.join("\n"), failed);
      if (failed) throw new RequestError(422, "확장 작업이 실패했습니다. 기준 저장은 보류했습니다. 변경 기록을 확인하고 다시 검토하세요.");
      await this.cliSettings.rebaseNative(pending.cli, c.ctx);
    }

    if (pending.stagedContext && pending.stepIds.length) {
      const steps = (await planInstallWith(pending.stagedContext)).steps.filter(s => pending.stepIds.includes(s.id));
      if (sha256(stringify(steps)) !== pending.installDigest) throw new RequestError(409, "설치 계획이 변경되었습니다. 다시 검토하세요");
      const result = await runInstallWith(pending.stagedContext, pending.stepIds, () => undefined, signal);
      const failed = result.results.filter(r => r.outcome === "failed" || r.outcome === "manual");
      await (await this.history()).recordCommand(c.profile.id, `${pending.title} · 설치`, result.results.map(r => `${r.id}: ${r.outcome} · ${r.detail}`).join("\n"), failed.length > 0 || result.cancelled);
      if (failed.length || result.cancelled) throw new RequestError(422, `설치 ${result.results.filter(r => r.outcome === "done").length}개 완료, ${failed.length}개 실패. 내 설정 저장은 보류했습니다. 변경 기록을 확인하고 다시 받으면 남은 항목만 실행합니다.`);
    }
    if (pending.probe) {
      const server = await this.mcp(pending.probe.id);
      if (sha256(stringify(server)) !== pending.probe.fingerprint) throw new RequestError(409, "MCP 설정이 변경되었습니다");
      let result: McpProbeResult;
      try { result = await probeMcp({ ...server, command: server.command?.replace(/^~(?=[/\\])/, c.ctx.home) }, c.ctx.env, signal); }
      catch { result = { ok: false, detail: "MCP 연결 실패 또는 취소 · 인증·네트워크·제한 시간을 확인하세요" }; }
      this.probes.set(pending.probe.id, { fingerprint: pending.probe.fingerprint, result, at: new Date().toISOString() });
      await (await this.history()).recordCommand(c.profile.id, pending.title, result.detail, !result.ok); return;
    }
    if (pending.stepIds.length && !pending.stagedContext) {
      const steps = (await planInstallWith(c.ctx)).steps.filter(s => pending.stepIds.includes(s.id));
      if (sha256(stringify(steps)) !== pending.installDigest) throw new RequestError(409, "설치 계획이 변경되었습니다. 다시 검토하세요");
      const result = await runInstallWith(c.ctx, pending.stepIds, () => undefined, signal);
      const environment: NonNullable<VersionLock["environment"]> = [];
      for (const id of ["node", "git", "claude", "codex"]) {
        const executable = await c.ctx.findExecutable(id); if (!executable) continue;
        const version = await c.ctx.readVersion(executable, ["--version"]); if (version) environment.push({ id, version, pinned: false, detail: "관측 버전 · CLI 자체 업데이트·외부 설치기는 고정 설치를 보증하지 않습니다" });
      }
      await withLock(async () => { const lock = await this.lock(c.profile.id); await writeFileChecked(this.lockFile(c.profile.id), await readText(this.lockFile(c.profile.id)), stringify({ ...lock, environment, at: new Date().toISOString() })); });
      const failed = result.results.filter(r => r.outcome === "failed");
      if (steps.some(s => s.actions.some(a => a.kind !== "file"))) await (await this.history()).recordCommand(c.profile.id, pending.title, result.results.map(r => `${r.id}: ${r.outcome} · ${r.detail}`).join("\n"), failed.length > 0 || result.cancelled);
      if (failed.length || result.cancelled) throw new RequestError(422, `${result.results.filter(r => r.outcome === "done").length}개 완료 · ${failed.length}개 실패${failed.length ? ` (${failed.map(r => r.id).join(", ")})` : " · 취소됨"}. 다시 검토하면 남은 작업만 실행합니다.`);
      return;
    }
    let history = await this.history(pending.candidate, pending.destination);
    if (pending.restore) {
      const record = await history.load(pending.restore);
      const old = record.profileId === c.profile.id ? record.changes.find(f => f.path === path.join(c.root, DEFINITION_FILE)) : undefined;
      if (old) history = await this.history(parseDefinition(old.before).components);
    }
    await withLock(async () => {
      signal.throwIfAborted();
      if (actor === "automatic" && (await Promise.all(this.deps.providers.map(p => p.detectRunning()))).some(Boolean)) throw new RequestError(409, "CLI 실행 중 · 자동 쓰기 보류");
      if (await readProfileFile(c.root, DEFINITION_FILE) !== c.definition) throw new RequestError(409, "내 설정이 변경되었습니다");
      await pending.checkLocal?.();
      const latestUserChange = (await history.list()).find(r => r.profileId === c.profile.id && r.actor === "user");
      if (actor === "automatic" && latestUserChange?.status === "restored") { this.status.detail = "설정 복원 후 자동 쓰기 보류 · 다음 수동 적용으로 재개하세요"; return; }
      if (pending.restore) await history.restore(pending.restore, c.profile.id);
      else await history.apply(pending.destination?.id ?? c.profile.id, pending.title, pending.files, actor);
    });
  }
  async historyList() { return (await this.history()).list(); }
  async restorePreview(id: string): Promise<WorkbenchPlan> {
    const c = await this.context(); const record = await (await this.history()).load(id);
    if (record.profileId !== c.profile.id || !record.restorable) throw new RequestError(409, "현재 프로필에서 복원할 수 없습니다");
    const p = this.remember({ profileId: c.profile.id, definition: c.definition, title: `${record.title} 복원`, files: [], stepIds: [], automatic: false, restore: id }, ["새로 만든 파일은 삭제하지 않고 이력 보관 폴더로 옮깁니다. 이후 사용자 변경이 있으면 중단합니다."]);
    p.files = record.changes.map(f => ({ path: f.path, diff: unifiedDiff(f.path, f.after, f.before ?? "") }));
    p.scope = record.changes.some(f => f.path === path.join(c.root, DEFINITION_FILE) || f.path === path.join(c.root, CLI_SETTINGS_FILE) || f.path === path.join(c.ctx.profileDir, CLI_SETTINGS_LOCAL)) ? "settings-and-pc" : "pc";
    p.notes.unshift(p.scope === "settings-and-pc" ? "내 설정과 PC 파일을 함께 복원합니다." : "이 기록은 PC 파일만 복원합니다. 기준 설정은 바꾸지 않습니다.");
    return p;
  }
  discover = discoverSkills;
  async importGithub(repository: string, directory: string, unified = false) { return this[unified ? "prepare" : "save"](await fetchSkill(repository, directory)); }
  async updates(): Promise<UpdateCandidate[]> {
    const c = await this.context(); const definition = parseDefinition(c.definition); const result: UpdateCandidate[] = [];
    const revisions = new Map<string, string>();
    for (const item of definition.components) if (item.source.kind === "github") {
      try {
        const repo = item.source.repository!; if (!revisions.has(repo)) revisions.set(repo, (await discoverSkills(repo)).revision);
        const available = revisions.get(repo)!;
        if (available !== item.source.revision) result.push({ id: item.id, name: item.name, current: item.source.revision, available, automatic: false, reason: "새 커밋 발견 · 파일 내용 비교 후 자동 적용 여부 판정" });
      } catch (e) { result.push({ id: item.id, name: item.name, automatic: false, reason: (e as Error).message }); }
    }
    return result;
  }
  async updatePreview(id: string, unified = false) {
    const item = await this.definition(id); if (item?.source.kind !== "github") throw new RequestError(422, "GitHub 출처가 없습니다");
    const next = await fetchSkill(item.source.repository!, item.source.directory ?? "");
    return this[unified ? "prepare" : "save"]({ ...next, id: item.id, name: item.name, description: item.description, targets: item.targets });
  }
  automationStatus() { return this.status; }
  async poll(signal = new AbortController().signal) {
    const c = await this.context(); const key = c.profile.id + (c.definition ?? "");
    if (Date.now() - this.lastPoll < 30 * 60_000 && key === this.lastDefinition) return;
    this.lastPoll = Date.now(); await this.tick(signal); const current = await this.context(); this.lastDefinition = current.profile.id + (current.definition ?? "");
  }
  async tick(signal = new AbortController().signal) {
    if (this.status.running) return;
    this.status = { ...this.status, running: true };
    try {
      let c = await this.context(); let definition = parseDefinition(c.definition);
      if (c.profile.id === "default" || !c.definition || !definition.automatic) { this.status.detail = "문서 자동 적용이 꺼져 있습니다"; return; }
      const running = await Promise.all(this.deps.providers.map(p => p.detectRunning()));
      if (running.some(Boolean)) { this.status.detail = "CLI 실행 중 · 자동 쓰기 보류"; return; }
      const history = await this.history();
      if ((await history.list()).find(r => r.profileId === c.profile.id && r.actor === "user")?.status === "restored") { this.status.detail = "설정 복원 후 자동 쓰기 보류 · 다음 수동 적용으로 재개하세요"; return; }
      for (const record of await history.list()) if (record.profileId === c.profile.id && ["pending", "recovery-needed"].includes(record.status)) await withLock(() => history.restore(record.id, c.profile.id));
      let remoteDetail = "";
      if (this.deps.receiveRemote) {
        remoteDetail = await this.deps.receiveRemote(c.profile.id, signal);
        if (remoteDetail.includes("수신 완료")) await (await this.history()).recordCommand(c.profile.id, "원격 일반 문서 수신", remoteDetail, false, "automatic");
        c = await this.context(); definition = parseDefinition(c.definition);
      }
      const lock = await this.lock(c.profile.id);
      const updates = await this.updates(); this.status.pending = updates;
      for (const update of updates) {
        signal.throwIfAborted(); if (!update.available) continue;
        const item = definition.components.find(i => i.id === update.id)!;
        const next = { ...await fetchSkill(item.source.repository!, item.source.directory ?? "", update.available), id: item.id, name: item.name, description: item.description, targets: item.targets };
        if (!ordinaryFiles(item) || !ordinaryFiles(next)) { update.reason = "실행 코드가 포함되어 수동 검토가 필요합니다"; continue; }
        const baseline = lock.entries.find(e => e.id === item.id);
        if (!baseline) { update.reason = "최초 PC 적용은 미리보기 후 실행하세요"; continue; }
        let conflict = false;
        for (const file of await this.targetFiles(c.ctx, item)) { const text = await readText(file); if (text === null || baseline.appliedHashes[file] !== sha256(text)) conflict = true; }
        if (conflict) { update.reason = "로컬 변경이 있어 보류합니다"; continue; }
        if (Object.keys(item.files).some(f => !(f in next.files))) { update.reason = "파일 제거 변경은 수동 검토가 필요합니다"; continue; }
        const plan = await this.save(next); await this.apply(plan.token, signal, "automatic");
        const apply = await this.preview([`definition:${item.id}`]);
        await this.apply(apply.token, signal, "automatic"); update.automatic = true; update.reason = "일반 문서 자동 적용 완료";
      }
      // 프로필에 직접 바뀐 문서도 관리한다. 최초 적용·외부 변경은 계속 보류한다.
      const current = await this.context(); const latest = parseDefinition(current.definition);
      for (const item of latest.components.filter(ordinaryFiles)) {
        const baseline = (await this.lock(c.profile.id)).entries.find(e => e.id === item.id);
        if (!baseline || baseline.digest === sha256(stringify(item.files))) continue;
        const targets = await this.targetFiles(c.ctx, item);
        if ((await Promise.all(targets.map(async file => { const t = await readText(file); return t !== null && baseline.appliedHashes[file] === sha256(t); }))).every(Boolean)) {
          const plan = await this.preview([`definition:${item.id}`]); await this.apply(plan.token, signal, "automatic");
        }
      }
      this.status.detail = `자동 확인 완료 · ${remoteDetail} · 원격 공유는 수동입니다`;
    } catch (e) { this.status.detail = `자동 적용 보류: ${(e as Error).message}`; }
    finally { this.status.running = false; this.status.checkedAt = new Date().toISOString(); }
  }
}
