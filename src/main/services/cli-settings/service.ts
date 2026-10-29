import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { ProviderId } from "@shared/provider-types";
import type { PluginsSnapshot } from "@shared/api-types";
import type { CliSettingsDefinition, ExtensionDescriptor, ExtensionEdit, SettingsEdit, SettingsSnapshot, SettingDescriptor } from "@shared/cli-settings-types";
import { RequestError } from "../../ipc-validation.js";
import type { InstallContext } from "../install/engine.js";
import type { CommandSpec } from "../install/exec.js";
import { readProfileFile, profileFile, readDocument, documentFingerprint, stringify, transferProblem } from "../profile-document.js";
import { SetupProfileStore } from "../setup-profiles.js";
import { readText, type FileChange } from "../workbench/history.js";
import { CLI_SETTINGS_FILE, CLI_SETTINGS_LOCAL, parseCliSettings, getValue, containsPcPath } from "./definition.js";
import { readonlyReason, settingCatalog, settingId, validateValue } from "./catalog.js";
import { KNOWN_EXTENSIONS, installedOptions, optionDescriptors } from "./extensions.js";
import { cliDefinition, projectCliSettings, applyProviderSettings } from "./projection.js";

export interface CliChange {
  files: FileChange[]; commands: CommandSpec[]; title: string; notes: string[]; definition: CliSettingsDefinition;
  effective: CliSettingsDefinition; verify(): Promise<void>;
  destination?: Awaited<ReturnType<SetupProfileStore["active"]>>;
}
function provider(value: unknown): ProviderId { if (value !== "claude" && value !== "codex") throw new RequestError(400, "CLI를 선택하세요"); return value; }
const stable = (v: any): string => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}" : JSON.stringify(v);
export class CliSettingsService {
  constructor(readonly deps: { stateDir: string; context(): Promise<InstallContext>; plugins(): Promise<PluginsSnapshot> }) {}
  async snapshot(target: unknown): Promise<SettingsSnapshot> {
    const p = provider(target), ctx = await this.deps.context(), definition = await cliDefinition(ctx);
    const raw = await readText(await profileFile(p === "claude" ? ctx.claudeHome : ctx.codexHome, p === "claude" ? "settings.json" : "config.toml"));
    const values = p === "claude" ? JSON.parse(raw ?? "{}") : parseToml(raw ?? "");
    const global = p === "claude" ? JSON.parse(await readText(ctx.claudeJson) ?? "{}") : {};
    const optionMap = new Map<string, SettingDescriptor>();
    if (p === "claude") for (const d of [...KNOWN_EXTENSIONS.filter(e => e.provider === p).flatMap(e => optionDescriptors(e.id, e.options)), ...await installedOptions(ctx)]) optionMap.set(d.id, d);
    const descriptors = [...settingCatalog(p), ...optionMap.values()];
    for (const key of Object.keys(values)) if (!descriptors.some(d => d.path.length === 1 && d.path[0] === key)) descriptors.push({ id: settingId(p, [key]), provider: p, path: [key], title: key, description: "설치된 CLI의 설정에 있지만 카탈로그에서 찾지 못한 항목", category: "알 수 없는 설정", type: "unknown", schema: {}, defaultDescription: "확인 안 됨", source: "현재 설정 파일", managed: false, readonly: "지원 여부 확인 필요" });
    const executable = await ctx.findExecutable(p);
    const version = executable ? await ctx.readVersion(executable, ["--version"]) : null;
    const versionTuple = (text: string) => text.match(/\d+\.\d+\.\d+/)?.[0]?.split(".").map(Number);
    const settings = descriptors.map(d => {
      const current = getValue(d.storage === "global" ? global : d.storage === "managed" ? {} : values, d.path), desired = definition.settings.find(s => s.provider === p && JSON.stringify(s.path) === JSON.stringify(d.path));
      const required = d.minimumVersion && versionTuple(d.minimumVersion), actual = version && versionTuple(version);
      const older = required && (!actual || required.some((n, i) => n > actual[i]! && required.slice(0, i).every((v, j) => v === actual[j])));
      const readonly = d.readonly ?? (older ? `${d.minimumVersion} 이상 필요` : d.type === "unknown" ? "설정 형식의 지원 여부 확인 필요" : undefined);
      const redact = (value: any): any => value && typeof value === "object" ? Array.isArray(value) ? value.map(redact) : Object.fromEntries(Object.entries(value).map(([key, v]) => [key, /api.?key|token|password|secret|authorization/i.test(key) ? "••••" : redact(v)])) : value;
      const sensitive = readonlyReason(p, d.path)?.includes("민감");
      return { ...d, readonly, current: sensitive && current !== undefined ? "••••" : redact(current), desired, managed: Boolean(desired) };
    });
    return { provider: p, version, schemaDate: "2026-10-29", settings, warnings: ["현재 저장값을 표시합니다. 실행 중인 세션·조직 정책이 적용한 최종 값은 별도 확인이 필요합니다."] };
  }
  async extensions(target: unknown): Promise<ExtensionDescriptor[]> {
    const p = provider(target), ctx = await this.deps.context(), definition = await cliDefinition(ctx);
    const plugins = await this.deps.plugins();
    const entries = plugins.plugins.filter(item => item.provider === p);
    const options = p === "claude" ? await installedOptions(ctx) : [];
    const ids = [...new Set([...KNOWN_EXTENSIONS.filter(e => e.provider === p).map(e => e.id), ...entries.map(e => e.id)])];
    const raw = await readText(await profileFile(ctx.claudeHome, "settings.json"));
    const actual = JSON.parse(raw ?? "{}");
    return ids.map(id => {
      const known = KNOWN_EXTENSIONS.find(e => e.id === id && e.provider === p), installed = entries.find(e => e.id === id);
      const desired = definition.extensions.find(e => e.id === id && e.provider === p);
      const descriptors = options.filter(o => o.path[1] === id);
      const defs = descriptors.length ? descriptors : known && p === "claude" ? optionDescriptors(id, known.options) : [];
      return { id, provider: p, title: known?.title ?? id, description: known?.description ?? "설치된 플러그인", installed: Boolean(installed?.installs.length), enabled: installed?.enabledInSettings ?? null, version: installed?.installs[0]?.version, managed: Boolean(desired), desired: desired?.enabled, counterpart: known?.counterpart,
        readonly: installed?.installs.length && installed.installs.every(i => i.scope !== "user") ? "프로젝트에만 설치된 확장 · 읽기 전용" : undefined,
        detail: p === "codex" ? "활성화와 hook 신뢰는 별개입니다. 새 세션에서 검토·신뢰하세요." : id.startsWith("mcw-") ? "MCW 세션에서 동작합니다. MCW 소유 설정은 읽기 전용입니다." : "설치·활성 상태입니다. 현재 세션 실행은 별도 검사 대상입니다.",
        options: defs.map(d => ({ ...d, current: d.readonly ? undefined : getValue(actual, d.path), desired: definition.settings.find(s => settingId(s.provider, s.path) === d.id), managed: definition.settings.some(s => settingId(s.provider, s.path) === d.id) })),
      };
    });
  }
  async prepare(edits: SettingsEdit[], extension?: ExtensionEdit): Promise<CliChange> {
    if (!Array.isArray(edits) || edits.length > 100 || !edits.length && !extension) throw new RequestError(400, "변경할 항목을 선택하세요");
    if (edits.some(e => !e || typeof e.id !== "string" || typeof e.provider !== "string") || extension !== undefined && (!extension || typeof extension.id !== "string")) throw new RequestError(400, "잘못된 변경 요청입니다");
    const ctx = await this.deps.context(), root = ctx.templateRoot ?? ctx.repoRoot!;
    const store = new SetupProfileStore(this.deps.stateDir, ctx.repoRoot);
    const active = ctx.setupProfile ?? await store.active();
    const original = await readDocument({ ...active, localDir: ctx.profileDir, kind: "local" });
    const fingerprint = documentFingerprint(original);
    const definition = parseCliSettings(original.files[CLI_SETTINGS_FILE] ?? null);
    const localDefinition = parseCliSettings(original.personal[CLI_SETTINGS_LOCAL] ?? null);
    const copy = active.id === "default" ? await store.preparePersonalCopy() : undefined;
    const destination = copy?.profile;
    const targetRoot = destination?.root ?? root;
    const effective: CliSettingsDefinition = { schemaVersion: 1, settings: [], extensions: [] };
    const descriptors = new Map<string, SettingDescriptor>();
    for (const p of [...new Set(edits.map(e => provider(e.provider)))]) for (const d of (await this.snapshot(p)).settings) descriptors.set(d.id, d);
    for (const e of edits) {
      if (!e || Object.keys(e).some(k => !["id", "provider", "operation", "value"].includes(k)) || !["set", "remove", "release"].includes(e.operation)) throw new RequestError(400, "잘못된 설정 변경입니다");
      const d = descriptors.get(e.id);
      if (!d || d.provider !== e.provider || d.readonly || d.type === "unknown") throw new RequestError(422, d?.readonly ?? "지원하지 않는 설정입니다");
      if (e.operation === "set") { validateValue(d, e.value!); const issue = transferProblem(stringify(e.value)); if (issue?.includes("인증")) throw new RequestError(422, issue + " · CLI에서 해당 값을 설정하세요."); }
      if (e.operation === "set" && e.value && typeof e.value === "object") {
        for (const child of descriptors.values()) if (child.provider === e.provider && child.readonly && child.path.length > d.path.length && d.path.every((key, i) => child.path[i] === key)) {
          const value = getValue(e.value, child.path.slice(d.path.length));
          if (stable(value) !== stable(child.current)) throw new RequestError(422, `${child.path.join(".")}: ${child.readonly}`);
        }
      }
      const ancestor = [...definition.settings, ...localDefinition.settings].find(s => s.provider === e.provider && s.path.length < d.path.length && s.path.every((key, i) => d.path[i] === key));
      if (ancestor) throw new RequestError(422, `${ancestor.path.join(".")} 전체를 관리 중입니다. 상위 설정에서 편집하거나 먼저 관리 해제하세요.`);
      const affected = (s: { provider: string; path: string[] }) => s.provider === e.provider && d.path.every((key, i) => s.path[i] === key);
      definition.settings = definition.settings.filter(s => !affected(s));
      localDefinition.settings = localDefinition.settings.filter(s => !affected(s));
      if (e.operation !== "release") {
        const intent = { provider: e.provider, path: d.path, operation: e.operation, ...(e.operation === "set" ? { value: e.value } : {}) };
        const local = e.operation === "set" && (containsPcPath(e.value) || Boolean(transferProblem(stringify(e.value))));
        (local ? localDefinition : definition).settings.push(intent); effective.settings.push(intent);
      }
    }
    const commands: CommandSpec[] = [];
    if (extension) {
      provider(extension.provider);
      if (Object.keys(extension).some(k => !["provider", "id", "enabled"].includes(k)) || typeof extension.enabled !== "boolean") throw new RequestError(400, "잘못된 확장 변경입니다");
      const d = (await this.extensions(extension.provider)).find(e => e.id === extension.id);
      if (!d || d.readonly) throw new RequestError(422, d?.readonly ?? "등록되지 않은 확장입니다");
      definition.extensions = definition.extensions.filter(e => e.provider !== extension.provider || e.id !== extension.id);
      definition.extensions.push(extension); effective.extensions.push(extension);
      const registry = extension.provider === "claude" ? JSON.parse(await readProfileFile(ctx.claudeHome, "plugins/known_marketplaces.json") ?? "{}") : (parseToml(await readProfileFile(ctx.codexHome, "config.toml") ?? "") as any).marketplaces ?? {};
      if (!d.installed && extension.enabled && extension.id.endsWith("@jinmin") && !registry.jinmin) commands.push({ command: extension.provider, args: ["plugin", "marketplace", "add", ctx.selfSource === "directory" && ctx.repoRoot ? ctx.repoRoot : "rafaam11/harness-manager"], timeoutMs: 120_000 });
      if (extension.enabled && !d.installed) commands.push({ command: extension.provider, args: ["plugin", extension.provider === "claude" ? "install" : "add", extension.id, ...(extension.provider === "claude" ? ["--scope", "user"] : [])], timeoutMs: 120_000 });
      else if (extension.provider === "claude" && d.installed && d.enabled !== extension.enabled) commands.push({ command: "claude", args: ["plugin", extension.enabled ? "enable" : "disable", extension.id, "--scope", "user"], timeoutMs: 120_000 });
    }
    parseCliSettings(stringify(definition));
    const files = (copy?.files ?? []).filter(f => f.path !== path.join(targetRoot, CLI_SETTINGS_FILE) && f.path !== path.join(targetRoot, "home/managed-keys.json") && f.path !== path.join(destination?.localDir ?? ctx.profileDir, CLI_SETTINGS_LOCAL));
    files.push({ path: await profileFile(targetRoot, CLI_SETTINGS_FILE), before: destination ? null : original.files[CLI_SETTINGS_FILE] ?? null, after: stringify(definition) });
    if (original.personal[CLI_SETTINGS_LOCAL] || localDefinition.settings.length || localDefinition.extensions.length) files.push({ path: await profileFile(destination?.localDir ?? ctx.profileDir, CLI_SETTINGS_LOCAL), before: destination ? null : original.personal[CLI_SETTINGS_LOCAL] ?? null, after: stringify(localDefinition) });
    const managed = JSON.parse(original.files["home/managed-keys.json"]!);
    const template = {
      claude: JSON.parse(original.files["home/claude/settings.managed.json"] ?? "{}"),
      codex: parseToml(original.files["home/codex/config.managed.toml"] ?? ""),
    };
    const localTemplate = {
      claude: JSON.parse(original.personal["claude-settings.local.json"] || "{}"),
      codex: JSON.parse(original.personal["codex-config.local.json"] || "{}"),
    };
    for (const e of edits) {
      const d = descriptors.get(e.id)!;
      const key = e.provider === "claude" ? "claudeSettings" : "codexConfig";
      // 기존 객체 전체를 관리했다면 선택한 가지 이외의 형제 키는 계속 관리한다.
      const keys: string[] = [];
      const exclude = (parts: string[]) => {
        const overlaps = parts.every((part, i) => d.path[i] === part);
        if (!overlaps) { keys.push(parts.join(".")); return; }
        if (parts.length >= d.path.length) return;
        const values = [getValue(template[e.provider], parts), getValue(localTemplate[e.provider], parts)];
        const children = new Set(values.flatMap(value => value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : []));
        for (const child of children) exclude([...parts, child]);
      };
      for (const item of managed[key] as string[]) {
        const parts = item.split(".");
        if (d.path.every((part, i) => parts[i] === part)) continue;
        exclude(parts);
      }
      managed[key] = [...new Set(keys)];
    }
    files.push({ path: await profileFile(targetRoot, "home/managed-keys.json"), before: destination ? null : original.files["home/managed-keys.json"]!, after: stringify(managed) });
    files.push(...(await projectCliSettings(ctx, effective)).files, ...(copy?.activation ?? []));
    return { files, commands, definition, effective, destination, title: extension ? `${extension.id} ${extension.enabled ? "켜기" : "끄기"}` : `${edits.length}개 CLI 설정 변경`, notes: ["내 설정과 PC 파일을 함께 저장합니다. 현재 세션 반영에는 재시작이 필요할 수 있습니다.", ...(commands.length ? ["외부 설치 명령은 자동 복원되지 않습니다. 실패하면 기준 저장을 보류합니다."] : []), ...(edits.some(e => /hook|permission|approval|sandbox|notify|command|helper/i.test(e.id)) ? ["권한·자동 실행 관련 설정입니다. 다음 CLI 실행 시 동작에 영향을 줍니다. 자세히에서 변경 내용을 확인하세요."] : []), ...(localDefinition.settings.length ? ["PC 고유 경로는 로컬 설정에만 저장하며 기본 동기화 대상에서 제외합니다."] : [])],
      verify: async () => { if (documentFingerprint(await readDocument({ ...active, localDir: ctx.profileDir, kind: "local" })) !== fingerprint) throw new RequestError(409, "내 설정이 바뀌었습니다. 다시 검토하세요."); },
    };
  }
  /** CLI 설치가 바꿀 수 있는 확장 항목만 제외하고 대조한 뒤, 실제 쓰기 직전 파일로 다시 계산한다. */
  async rebaseNative(change: CliChange, ctx: InstallContext) {
    for (const file of change.files) {
      const p = file.path === path.join(ctx.claudeHome, "settings.json") ? "claude" : file.path === path.join(ctx.codexHome, "config.toml") ? "codex" : null;
      if (!p) continue;
      const current = await readText(file.path);
      if (current === file.before) continue;
      const parse = (v: string | null) => p === "claude" ? JSON.parse(v ?? "{}") : parseToml(v ?? "");
      const before = parse(file.before), after = parse(current);
      for (const e of change.effective.extensions.filter(e => e.provider === p)) {
        const key = p === "claude" ? "enabledPlugins" : "plugins";
        if (before[key]) delete before[key][e.id]; if (after[key]) delete after[key][e.id];
        if (before[key] && !Object.keys(before[key]).length) delete before[key]; if (after[key] && !Object.keys(after[key]).length) delete after[key];
      }
      if (p === "codex" && change.commands.some(s => s.command === p && s.args[1] === "marketplace")) {
        if (after.marketplaces) delete after.marketplaces.jinmin;
        if (before.marketplaces) delete before.marketplaces.jinmin;
        if (after.marketplaces && !Object.keys(after.marketplaces).length) delete after.marketplaces;
        if (before.marketplaces && !Object.keys(before.marketplaces).length) delete before.marketplaces;
      }
      if (stable(before) !== stable(after)) throw new RequestError(409, "설치 중 다른 설정이 변경되었습니다. 설치 결과를 확인하고 다시 검토하세요.");
      file.before = current; file.after = applyProviderSettings(p, current, change.effective);
    }
  }
}
