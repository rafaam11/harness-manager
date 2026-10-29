import { CLI_SETTINGS_FILE, CLI_SETTINGS_LOCAL, parseCliSettings, mergeCliSettings, getValue, containsPcPath } from "../cli-settings/definition.js";
import { transferProblem } from "../profile-document.js";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type {
  CaptureTargetId,
  ExternalSkillEntry,
  MarketplaceEntry,
  MarketplaceSource,
  McpEntry,
  McpManifest,
  PluginsManifest,
  ProviderTarget,
  SkillsManifest,
} from "@shared/manifest-types";
import { powershellProfilePath, readGitConfig, stripBom, type GitConfigScope } from "../dotfiles.js";
import { HASH_MARKERS } from "../install/merge.js";
import { isPersonalValue, tildify, type ExposureRules } from "./exposure.js";
import {
  getPath,
  normalizeNewlines,
  setPath,
  splitMarkdownSections,
  splitMarkerBlock,
  stableJson,
  withTrailingNewline,
} from "./text.js";

/** capture가 읽고 쓰는 위치. 테스트는 전부 임시 폴더로 바꿔 끼운다. */
export interface CaptureContext {
  repoRoot: string;
  home: string;
  claudeHome: string;
  claudeJson: string;
  codexHome: string;
  skillLock: string;
  profileDir: string;
  privateTerms: string[];
  /** 문서 폴더(PowerShell 프로필이 산다). OneDrive로 옮겨져 있을 수 있어 OS에 물어 정한다. */
  documentsDir: string;
  /** git 전역 설정 대신 읽을 파일(테스트). 없으면 `git config --global`. */
  gitScope: GitConfigScope;
}

export interface PlannedFile {
  scope: "repo" | "local";
  absPath: string;
  displayPath: string;
  before: string | null;
  after: string;
}

export interface TargetPlan {
  id: CaptureTargetId;
  label: string;
  sources: string[];
  files: PlannedFile[];
  notes: string[];
  error?: string;
}

/** 이 레포가 호스팅하는 마켓플레이스. 어느 소스로 붙어 있든 레포에는 `self`로 적는다(D15). */
export const SELF_MARKETPLACE = "jinmin";
/** multi-cli-work가 세션마다 주입하는 MCP. 이 앱이 관리하지 않는다(비목표). */
const MCP_SKIP = new Set(["jk"]);
const DEFAULT_NEW_PROFILES = ["dev", "full"] as const;

export async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  const text = await readText(filePath);
  return text === null ? null : (JSON.parse(text) as unknown);
}

function rules(ctx: CaptureContext): ExposureRules {
  return { home: ctx.home, privateTerms: ctx.privateTerms };
}

function shown(ctx: CaptureContext, filePath: string): string {
  return tildify(filePath, ctx.home);
}

async function repoFile(ctx: CaptureContext, relative: string, after: string): Promise<PlannedFile> {
  const absPath = path.join(ctx.repoRoot, ...relative.split("/"));
  return { scope: "repo", absPath, displayPath: relative, before: await readText(absPath), after };
}

/** 로컬 파일은 넣을 것이 없고 원래 없던 경우 만들지 않는다. */
async function localFile(ctx: CaptureContext, relative: string, after: string): Promise<PlannedFile | null> {
  const absPath = path.join(ctx.profileDir, relative);
  const before = await readText(absPath);
  if (before === null && after === "") return null;
  return { scope: "local", absPath, displayPath: `profile/${relative}`, before, after };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

// ───────────────────────────── AGENTS.md ─────────────────────────────

/**
 * 전역 AGENTS.md를 공개 부분(레포 `home/agents/AGENTS.md`)과 개인 부분(`profile/AGENTS.local.md`)으로 가른다.
 * 마커 블록이 있으면 그 안이 공개다. 없으면 레포 템플릿에 있는 제목의 섹션만 공개로 보고 나머지는 전부 개인이다 —
 * 새 섹션이 저절로 공개되는 일이 없게, 공개는 템플릿에 제목을 적어 둔 것만이다.
 */
export async function planAgents(ctx: CaptureContext): Promise<TargetPlan> {
  const source = path.join(ctx.codexHome, "AGENTS.md");
  const plan: TargetPlan = { id: "agents", label: "전역 AGENTS.md", sources: [shown(ctx, source)], files: [], notes: [] };
  const current = await readText(source);
  if (current === null) return { ...plan, error: `${shown(ctx, source)}가 없습니다` };
  const templatePath = "home/agents/AGENTS.md";
  const template = (await readText(path.join(ctx.repoRoot, templatePath))) ?? "";
  const templateSections = splitMarkdownSections(template).filter((section) => section.heading !== null);

  let publicText: string;
  let localText: string;
  const block = splitMarkerBlock(current);
  if (block) {
    publicText = block.inside;
    localText = block.outside;
    plan.notes.push("마커 블록 안을 공개, 밖을 개인으로 나눴습니다.");
  } else {
    const sections = splitMarkdownSections(current);
    const byHeading = new Map(sections.filter((section) => section.heading).map((section) => [section.heading!, section]));
    const publicParts = templateSections.map((section) => {
      const found = byHeading.get(section.heading!);
      if (!found) plan.notes.push(`"${section.heading}" 섹션이 이 PC에 없어 레포 내용을 유지합니다.`);
      return (found ?? section).text.trimEnd();
    });
    const publicHeadings = new Set(templateSections.map((section) => section.heading));
    const localSections = sections.filter((section) => !publicHeadings.has(section.heading));
    publicText = publicParts.join("\n\n");
    localText = localSections.map((section) => section.text.trimEnd()).join("\n\n");
    if (localSections.length > 0) {
      const names = localSections.map((section) => section.heading ?? "(머리말)").join(", ");
      plan.notes.push(`개인 섹션으로 보냄: ${names}. 공개하려면 레포 템플릿에 같은 제목을 추가하세요.`);
    }
  }
  plan.files.push(await repoFile(ctx, templatePath, withTrailingNewline(normalizeNewlines(publicText))));
  const local = await localFile(ctx, "AGENTS.local.md", withTrailingNewline(normalizeNewlines(localText)));
  if (local) plan.files.push(local);
  return plan;
}

// ───────────────────────────── CLAUDE.md ─────────────────────────────

/** 보통 `@<홈>/.codex/AGENTS.md` 한 줄이다. 홈 경로를 `~`로 바꿔야 다른 PC에서도 맞는다. */
export async function planClaudeMd(ctx: CaptureContext): Promise<TargetPlan> {
  const source = path.join(ctx.claudeHome, "CLAUDE.md");
  const plan: TargetPlan = { id: "claude-md", label: "전역 CLAUDE.md", sources: [shown(ctx, source)], files: [], notes: [] };
  const current = await readText(source);
  if (current === null) return { ...plan, error: `${shown(ctx, source)}가 없습니다` };
  const lines = normalizeNewlines(current)
    .split("\n")
    .map((line) => line.replace(/^@(\S+)/, (_, target: string) => `@${tildify(target, ctx.home)}`));
  plan.files.push(await repoFile(ctx, "home/claude/CLAUDE.md", withTrailingNewline(lines.join("\n"))));
  return plan;
}

// ─────────────────────── 관리 키 (settings.json · config.toml) ───────────────────────

interface ManagedKeys {
  claudeSettings: string[];
  codexConfig: string[];
  gitconfig: string[];
}

async function readManagedKeys(ctx: CaptureContext): Promise<ManagedKeys> {
  const value = await readJson(path.join(ctx.repoRoot, "home", "managed-keys.json"));
  if (!isRecord(value)) throw new Error("home/managed-keys.json이 없거나 객체가 아닙니다");
  return {
    claudeSettings: stringList(value.claudeSettings),
    codexConfig: stringList(value.codexConfig),
    gitconfig: stringList(value.gitconfig),
  };
}

/**
 * 관리 키 값만 골라 공개 객체와 개인 객체로 나눈다. 문자열 배열은 항목 단위로 가른다(예: `permissions.allow`에
 * 특정 PC의 도구 경로가 섞인다). PC에 없는 키는 레포 값을 그대로 둔다.
 */
function splitManaged(
  ctx: CaptureContext,
  keys: string[],
  current: Record<string, unknown>,
  existing: Record<string, unknown>,
  notes: string[],
): { publicValue: Record<string, unknown>; localValue: Record<string, unknown> } {
  const publicValue: Record<string, unknown> = {};
  const localValue: Record<string, unknown> = {};
  const moved: string[] = [];
  for (const key of keys) {
    const value = getPath(current, key);
    if (value === undefined) {
      const kept = getPath(existing, key);
      if (kept !== undefined) {
        setPath(publicValue, key, kept);
        notes.push(`${key}: 이 PC에 없어 레포 값을 유지합니다.`);
      }
      continue;
    }
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      const personal = value.filter((entry) => isPersonalValue(entry, rules(ctx)));
      setPath(publicValue, key, value.filter((entry) => !personal.includes(entry)));
      if (personal.length > 0) {
        setPath(localValue, key, personal);
        moved.push(`${key}(${personal.length}개)`);
      }
      continue;
    }
    if (isPersonalValue(JSON.stringify(value), rules(ctx))) {
      setPath(localValue, key, value);
      moved.push(key);
      continue;
    }
    setPath(publicValue, key, value);
  }
  if (moved.length > 0) notes.push(`개인 값이라 로컬 오버레이로 보냄: ${moved.join(", ")}`);
  return { publicValue, localValue };
}

function unmanagedNote(current: Record<string, unknown>, keys: string[], handledElsewhere: string[]): string | null {
  const roots = new Set(keys.map((key) => key.split(".")[0]));
  const extra = Object.keys(current).filter((key) => !roots.has(key) && !handledElsewhere.includes(key));
  return extra.length > 0 ? `관리하지 않는 키(레포에 넣지 않음): ${extra.join(", ")}` : null;
}

export async function planClaudeSettings(ctx: CaptureContext): Promise<TargetPlan> {
  const source = path.join(ctx.claudeHome, "settings.json");
  const plan: TargetPlan = { id: "claude-settings", label: "Claude 설정(관리 키)", sources: [shown(ctx, source)], files: [], notes: [] };
  const current = await readJson(source).catch(() => undefined);
  if (!isRecord(current)) return { ...plan, error: `${shown(ctx, source)}를 읽지 못했습니다` };
  const keys = (await readManagedKeys(ctx)).claudeSettings;
  const templatePath = "home/claude/settings.managed.json";
  const existing = await readJson(path.join(ctx.repoRoot, templatePath)).catch(() => null);
  const { publicValue, localValue } = splitManaged(ctx, keys, current, isRecord(existing) ? existing : {}, plan.notes);
  // 플러그인·마켓플레이스는 manifest/plugins.json이, statusLine은 jinmin-hud가, hooks는 mod·mcw가 맡는다.
  const note = unmanagedNote(current, keys, ["enabledPlugins", "extraKnownMarketplaces", "statusLine", "hooks"]);
  if (note) plan.notes.push(note);
  plan.files.push(await repoFile(ctx, templatePath, stableJson(publicValue)));
  const local = await localFile(ctx, "claude-settings.local.json", Object.keys(localValue).length > 0 ? stableJson(localValue) : "");
  if (local) plan.files.push(local);
  await captureTypedSettings(ctx, ["claude"], plan);
  return plan;
}

async function captureTypedSettings(ctx: CaptureContext, providers: ("claude" | "codex")[], plan: TargetPlan) {
  const file = path.join(ctx.repoRoot, CLI_SETTINGS_FILE), before = await readText(file);
  if (before === null) return;
  const localBefore = await readText(path.join(ctx.profileDir, CLI_SETTINGS_LOCAL));
  const definition = mergeCliSettings(parseCliSettings(before), parseCliSettings(localBefore));
  const localDefinition = parseCliSettings(localBefore);
  for (const provider of providers) {
    const text = await readText(provider === "claude" ? path.join(ctx.claudeHome, "settings.json") : path.join(ctx.codexHome, "config.toml"));
    if (text === null) continue;
    const current = provider === "claude" ? JSON.parse(text) : parseToml(text);
    for (const item of definition.settings.filter(i => i.provider === provider)) {
      const value = getValue(current, item.path);
      if (value !== undefined && transferProblem(JSON.stringify(value))?.includes("인증")) { plan.notes.push(`${item.path.join(".")}: 비공개 값은 기존 정의를 유지합니다.`); continue; }
      item.operation = value === undefined ? "remove" : "set";
      if (value === undefined) delete item.value; else item.value = value;
    }
    for (const item of definition.extensions.filter(i => i.provider === provider)) {
      const value = getValue(current, provider === "claude" ? ["enabledPlugins", item.id] : ["plugins", item.id, "enabled"]);
      if (typeof value === "boolean") item.enabled = value;
    }
  }
  // 배열도 하나의 값으로 관리하므로 PC 경로가 하나라도 있으면 전체 값을 로컬에 둔다.
  const privateSettings = definition.settings.filter(item => item.operation === "set" && (containsPcPath(item.value) || transferProblem(JSON.stringify(item.value))));
  localDefinition.settings = privateSettings;
  localDefinition.extensions = [];
  definition.settings = definition.settings.filter(item => !privateSettings.includes(item));
  plan.files.push(await repoFile(ctx, CLI_SETTINGS_FILE, stableJson(definition)));
  if (localBefore || privateSettings.length) {
    const file = await localFile(ctx, CLI_SETTINGS_LOCAL, stableJson(localDefinition));
    if (file) plan.files.push(file);
  }
}

export async function planCodexConfig(ctx: CaptureContext): Promise<TargetPlan> {
  const source = path.join(ctx.codexHome, "config.toml");
  const plan: TargetPlan = { id: "codex-config", label: "Codex 설정(관리 키)", sources: [shown(ctx, source)], files: [], notes: [] };
  const text = await readText(source);
  if (text === null) return { ...plan, error: `${shown(ctx, source)}가 없습니다` };
  let current: Record<string, unknown>;
  try {
    current = parseToml(text) as Record<string, unknown>;
  } catch (error) {
    return { ...plan, error: `config.toml을 읽지 못했습니다: ${(error as Error).message}` };
  }
  const keys = (await readManagedKeys(ctx)).codexConfig;
  const templatePath = "home/codex/config.managed.toml";
  const existingText = await readText(path.join(ctx.repoRoot, templatePath));
  const existing = existingText ? (parseToml(existingText) as Record<string, unknown>) : {};
  const { publicValue, localValue } = splitManaged(ctx, keys, current, existing, plan.notes);
  // projects는 PC마다 다른 신뢰 경로, plugins·marketplaces는 plugins.json, mcp_servers는 mcp.json이 맡는다.
  const note = unmanagedNote(current, keys, ["projects", "plugins", "marketplaces", "mcp_servers"]);
  if (note) plan.notes.push(note);
  plan.files.push(await repoFile(ctx, templatePath, withTrailingNewline(stringifyToml(publicValue))));
  const local = await localFile(ctx, "codex-config.local.json", Object.keys(localValue).length > 0 ? stableJson(localValue) : "");
  if (local) plan.files.push(local);
  await captureTypedSettings(ctx, ["codex"], plan);
  return plan;
}

// ───────────────────────────── 오버레이 manifest ─────────────────────────────

/**
 * 공개할 수 없는 manifest 항목(회사 마켓플레이스, 개인 경로의 MCP 등)이 모이는 로컬 파일.
 * plugins·mcp·skills 세 대상이 각자 자기 칸만 바꾼다.
 */
interface LocalManifest {
  plugins?: PluginsManifest;
  mcp?: McpManifest;
  skills?: SkillsManifest;
}

const LOCAL_MANIFEST = "manifest.local.json";

async function readLocalManifest(ctx: CaptureContext): Promise<LocalManifest> {
  const value = await readJson(path.join(ctx.profileDir, LOCAL_MANIFEST)).catch(() => null);
  return isRecord(value) ? (value as LocalManifest) : {};
}

async function localManifestFile(
  ctx: CaptureContext,
  section: keyof LocalManifest,
  value: LocalManifest[keyof LocalManifest] | undefined,
): Promise<PlannedFile | null> {
  const current = await readLocalManifest(ctx);
  const next: LocalManifest = { ...current };
  if (value) next[section] = value as never;
  else delete next[section];
  return localFile(ctx, LOCAL_MANIFEST, Object.keys(next).length > 0 ? stableJson(next) : "");
}

function mergeById<T>(existing: T[], observed: T[], id: (entry: T) => string, merge: (old: T, seen: T) => T): T[] {
  const result = existing.map((entry) => {
    const seen = observed.find((candidate) => id(candidate) === id(entry));
    return seen ? merge(entry, seen) : entry;
  });
  for (const entry of observed) if (!existing.some((old) => id(old) === id(entry))) result.push(entry);
  return result;
}

function unionTargets(a: ProviderTarget[], b: ProviderTarget[]): ProviderTarget[] {
  return (["claude", "codex"] as const).filter((target) => a.includes(target) || b.includes(target));
}

// ───────────────────────────── 플러그인 ─────────────────────────────

function githubRepoFromUrl(url: string): string | null {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(\.git)?\/?$/.exec(url);
  return match ? match[1]! : null;
}

/** directory 소스는 개인 경로라 공개할 수 없다. 단, 이 레포 자신은 `self`다. */
function claudeMarketplaceSource(name: string, source: unknown): MarketplaceSource | null {
  if (name === SELF_MARKETPLACE) return { kind: "self" };
  if (!isRecord(source)) return null;
  if (source.source === "github" && typeof source.repo === "string") return { kind: "github", repo: source.repo };
  if (source.source === "git" && typeof source.url === "string") {
    const repo = githubRepoFromUrl(source.url);
    return repo ? { kind: "github", repo } : { kind: "git", url: source.url };
  }
  return null;
}

function codexMarketplaceSource(name: string, table: unknown): MarketplaceSource | null {
  if (name === SELF_MARKETPLACE) return { kind: "self" };
  if (!isRecord(table) || typeof table.source !== "string") return null;
  if (table.source_type === "git") {
    const repo = githubRepoFromUrl(table.source);
    return repo ? { kind: "github", repo } : { kind: "git", url: table.source };
  }
  return null;
}

function emptyPlugins(): PluginsManifest {
  return { schemaVersion: 1, marketplaces: [], claude: { enabled: [] }, codex: { enabled: [] } };
}

export async function planPlugins(ctx: CaptureContext): Promise<TargetPlan> {
  const settingsPath = path.join(ctx.claudeHome, "settings.json");
  const knownPath = path.join(ctx.claudeHome, "plugins", "known_marketplaces.json");
  const codexPath = path.join(ctx.codexHome, "config.toml");
  const plan: TargetPlan = {
    id: "plugins",
    label: "마켓플레이스·플러그인",
    sources: [settingsPath, knownPath, codexPath].map((file) => shown(ctx, file)),
    files: [],
    notes: [],
  };
  const settings = await readJson(settingsPath).catch(() => null);
  const known = await readJson(knownPath).catch(() => null);
  const codexText = await readText(codexPath);
  const codex = codexText ? (parseToml(codexText) as Record<string, unknown>) : {};

  const observedMarkets: MarketplaceEntry[] = [];
  const localMarkets: MarketplaceEntry[] = [];
  const privateMarkets = new Set<string>();
  const observe = (name: string, source: MarketplaceSource | null, provider: ProviderTarget, rawSource: unknown): void => {
    const personal = isPersonalValue(`${name} ${JSON.stringify(rawSource ?? "")}`, rules(ctx)) && name !== SELF_MARKETPLACE;
    if (!source || personal) {
      privateMarkets.add(name);
      // 개인 경로(directory)는 PC마다 달라 로컬 오버레이에도 소스를 적지 않는다. 회사 마켓플레이스는 적는다.
      if (source) {
        const found = localMarkets.find((entry) => entry.name === name);
        if (found) found.providers = unionTargets(found.providers, [provider]);
        else localMarkets.push({ name, source, providers: [provider] });
      } else {
        plan.notes.push(`${name}: 개인 경로 소스라 레포에 적지 않습니다.`);
      }
      return;
    }
    const found = observedMarkets.find((entry) => entry.name === name);
    if (found) found.providers = unionTargets(found.providers, [provider]);
    else observedMarkets.push({ name, source, providers: [provider] });
  };

  const claudeMarkets = new Map<string, unknown>();
  if (isRecord(known)) for (const [name, entry] of Object.entries(known)) claudeMarkets.set(name, isRecord(entry) ? entry.source : null);
  if (isRecord(settings) && isRecord(settings.extraKnownMarketplaces)) {
    for (const [name, entry] of Object.entries(settings.extraKnownMarketplaces)) {
      claudeMarkets.set(name, isRecord(entry) ? entry.source : null);
    }
  }
  for (const [name, source] of claudeMarkets) observe(name, claudeMarketplaceSource(name, source), "claude", source);
  if (isRecord(codex.marketplaces)) {
    for (const [name, table] of Object.entries(codex.marketplaces)) observe(name, codexMarketplaceSource(name, table), "codex", table);
  }

  const isPrivatePlugin = (id: string): boolean =>
    privateMarkets.has(id.split("@")[1] ?? "") || isPersonalValue(id, rules(ctx));
  const claudeEnabled =
    isRecord(settings) && isRecord(settings.enabledPlugins)
      ? Object.entries(settings.enabledPlugins).filter(([, on]) => on === true).map(([id]) => id)
      : [];
  const codexEnabled = isRecord(codex.plugins)
    ? Object.entries(codex.plugins).filter(([, table]) => isRecord(table) && table.enabled === true).map(([id]) => id)
    : [];

  const existingValue = await readJson(path.join(ctx.repoRoot, "manifest", "plugins.json")).catch(() => null);
  const existing = isRecord(existingValue) ? (existingValue as unknown as PluginsManifest) : emptyPlugins();
  const typed = mergeCliSettings(parseCliSettings(await readText(path.join(ctx.repoRoot, CLI_SETTINGS_FILE))), parseCliSettings(await readText(path.join(ctx.profileDir, CLI_SETTINGS_LOCAL))));
  const owned = (provider: "claude" | "codex", id: string) => typed.extensions.some(e => e.provider === provider && e.id === id);
  const appendNew = (old: string[], seen: string[]): string[] => [...old, ...seen.filter((id) => !old.includes(id))];
  const next: PluginsManifest = {
    schemaVersion: 1,
    marketplaces: mergeById(existing.marketplaces ?? [], observedMarkets, (entry) => entry.name, (old, seen) => ({
      ...seen,
      providers: unionTargets(old.providers, seen.providers),
    })),
    claude: { enabled: appendNew(existing.claude?.enabled ?? [], claudeEnabled.filter((id) => !isPrivatePlugin(id))).filter(id => !owned("claude", id)) },
    codex: { enabled: appendNew(existing.codex?.enabled ?? [], codexEnabled.filter((id) => !isPrivatePlugin(id))).filter(id => !owned("codex", id)) },
  };
  const missing = [...(existing.claude?.enabled ?? []).filter((id) => !claudeEnabled.includes(id))];
  if (missing.length > 0) plan.notes.push(`이 PC의 Claude에 꺼져 있지만 레포에 남겨 둠: ${missing.join(", ")}`);
  plan.notes.push("capture는 항목을 더하기만 합니다. 빼려면 manifest/plugins.json에서 직접 지우세요.");

  plan.files.push(await repoFile(ctx, "manifest/plugins.json", stableJson(next)));
  const privateClaude = claudeEnabled.filter(isPrivatePlugin);
  const privateCodex = codexEnabled.filter(isPrivatePlugin);
  const localSection =
    localMarkets.length + privateClaude.length + privateCodex.length > 0
      ? { schemaVersion: 1 as const, marketplaces: localMarkets, claude: { enabled: privateClaude }, codex: { enabled: privateCodex } }
      : undefined;
  if (localSection) {
    plan.notes.push(`비공개 마켓플레이스·플러그인은 로컬 오버레이로 보냄: ${[...privateMarkets].join(", ")}`);
  }
  const local = await localManifestFile(ctx, "plugins", localSection);
  if (local) plan.files.push(local);
  await captureTypedSettings(ctx, ["claude", "codex"], plan);
  return plan;
}

// ───────────────────────────── MCP ─────────────────────────────

function observedMcp(ctx: CaptureContext, name: string, raw: unknown, target: ProviderTarget, notes: string[]): McpEntry | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.command !== "string") {
    notes.push(`${name}: command가 없는 서버(http 등)는 아직 다루지 않습니다.`);
    return null;
  }
  const env = isRecord(raw.env) ? Object.keys(raw.env) : [];
  return {
    name,
    command: tildify(raw.command, ctx.home).replace(/\\/g, "/"),
    args: stringList(raw.args),
    // 값은 비밀일 수 있어 절대 옮기지 않는다. 자리표시만 남기고 실제 값은 설치 때 환경에서 받는다.
    ...(env.length > 0 ? { env: Object.fromEntries(env.map((key) => [key, `\${${key}}`])) } : {}),
    targets: [target],
    profiles: [...DEFAULT_NEW_PROFILES],
  };
}

export async function planMcp(ctx: CaptureContext): Promise<TargetPlan> {
  const codexPath = path.join(ctx.codexHome, "config.toml");
  const plan: TargetPlan = {
    id: "mcp",
    label: "MCP 서버",
    sources: [shown(ctx, ctx.claudeJson), shown(ctx, codexPath)],
    files: [],
    notes: [],
  };
  const claudeJson = await readJson(ctx.claudeJson).catch(() => null);
  const codexText = await readText(codexPath);
  const codex = codexText ? (parseToml(codexText) as Record<string, unknown>) : {};

  const observed: McpEntry[] = [];
  const add = (entry: McpEntry | null): void => {
    if (!entry || MCP_SKIP.has(entry.name)) return;
    const found = observed.find((candidate) => candidate.name === entry.name);
    if (found) found.targets = unionTargets(found.targets, entry.targets);
    else observed.push(entry);
  };
  if (isRecord(claudeJson) && isRecord(claudeJson.mcpServers)) {
    for (const [name, raw] of Object.entries(claudeJson.mcpServers)) add(observedMcp(ctx, name, raw, "claude", plan.notes));
  }
  if (isRecord(codex.mcp_servers)) {
    for (const [name, raw] of Object.entries(codex.mcp_servers)) add(observedMcp(ctx, name, raw, "codex", plan.notes));
  }
  if (observed.some((entry) => entry.env)) plan.notes.push("env 값은 옮기지 않고 ${이름} 자리표시로 적었습니다.");

  const personal = observed.filter((entry) => isPersonalValue(`${entry.name} ${entry.command} ${entry.args.join(" ")}`, rules(ctx)));
  const shareable = observed.filter((entry) => !personal.includes(entry));
  if (personal.length > 0) plan.notes.push(`개인 경로·비공개 값이 있어 로컬 오버레이로 보냄: ${personal.map((entry) => entry.name).join(", ")}`);

  const existingValue = await readJson(path.join(ctx.repoRoot, "manifest", "mcp.json")).catch(() => null);
  const existing = isRecord(existingValue) && Array.isArray(existingValue.servers) ? (existingValue.servers as McpEntry[]) : [];
  const servers = mergeById(existing, shareable, (entry) => entry.name, (old, seen) => ({
    ...old,
    command: seen.command,
    args: seen.args,
    ...(seen.env || old.env ? { env: { ...seen.env, ...old.env } } : {}),
    targets: unionTargets(old.targets, seen.targets),
  }));
  const added = shareable.filter((entry) => !existing.some((old) => old.name === entry.name));
  if (added.length > 0) plan.notes.push(`새 서버의 profiles는 기본값(${DEFAULT_NEW_PROFILES.join(", ")})으로 넣었습니다: ${added.map((entry) => entry.name).join(", ")}`);
  plan.files.push(await repoFile(ctx, "manifest/mcp.json", stableJson({ schemaVersion: 1, servers })));
  const local = await localManifestFile(ctx, "mcp", personal.length > 0 ? { schemaVersion: 1, servers: personal } : undefined);
  if (local) plan.files.push(local);
  return plan;
}

// ───────────────────────────── 외부 스킬 ─────────────────────────────

export async function planSkills(ctx: CaptureContext): Promise<TargetPlan> {
  const plan: TargetPlan = { id: "skills", label: "외부 스킬", sources: [shown(ctx, ctx.skillLock)], files: [], notes: [] };
  const lock = await readJson(ctx.skillLock).catch(() => null);
  if (!isRecord(lock) || !isRecord(lock.skills)) return { ...plan, error: `${shown(ctx, ctx.skillLock)}가 없거나 읽지 못했습니다` };
  const observed: ExternalSkillEntry[] = [];
  const personal: ExternalSkillEntry[] = [];
  for (const [id, entry] of Object.entries(lock.skills)) {
    if (!isRecord(entry) || entry.sourceType !== "github" || typeof entry.source !== "string") {
      plan.notes.push(`${id}: GitHub 소스가 아니라 다루지 않습니다.`);
      continue;
    }
    const skill: ExternalSkillEntry = { id, source: entry.source, profiles: ["core", "dev", "full"] };
    (isPersonalValue(`${id} ${entry.source}`, rules(ctx)) ? personal : observed).push(skill);
  }
  if (personal.length > 0) plan.notes.push(`비공개 소스라 로컬 오버레이로 보냄: ${personal.map((entry) => entry.id).join(", ")}`);
  const existingValue = await readJson(path.join(ctx.repoRoot, "manifest", "skills.json")).catch(() => null);
  const existing = isRecord(existingValue) && Array.isArray(existingValue.external) ? (existingValue.external as ExternalSkillEntry[]) : [];
  const external = mergeById(existing, observed, (entry) => entry.id, (old, seen) => ({ ...old, source: seen.source }));
  plan.files.push(await repoFile(ctx, "manifest/skills.json", stableJson({ schemaVersion: 1, external })));
  const local = await localManifestFile(ctx, "skills", personal.length > 0 ? { schemaVersion: 1, external: personal } : undefined);
  if (local) plan.files.push(local);
  return plan;
}

// ───────────────────────────── dotfiles ─────────────────────────────

/**
 * PowerShell 프로필. 마커 블록(`# >>> harness-manager >>>`)이 있으면 그 안이 공개, 밖은 로컬이다. 블록이 없으면
 * 파일 전체를 공개 후보로 본다 — 개인 경로·회사명이 섞였으면 노출 검사가 적용을 막는다.
 */
export async function planPowershellProfile(ctx: CaptureContext): Promise<TargetPlan> {
  const source = powershellProfilePath(ctx.documentsDir);
  const plan: TargetPlan = { id: "powershell-profile", label: "PowerShell 프로필", sources: [shown(ctx, source)], files: [], notes: [] };
  const raw = await readText(source);
  if (raw === null) return { ...plan, error: `${shown(ctx, source)}가 없습니다` };
  const text = normalizeNewlines(stripBom(raw));
  const start = text.indexOf(HASH_MARKERS.start);
  const end = text.indexOf(HASH_MARKERS.end);
  let publicText = text;
  let localText = "";
  if (start >= 0 && end > start) {
    publicText = text.slice(start + HASH_MARKERS.start.length, end);
    localText = text.slice(0, start) + text.slice(end + HASH_MARKERS.end.length);
    plan.notes.push("마커 블록 안을 공개, 밖을 개인으로 나눴습니다.");
  } else {
    plan.notes.push("마커 블록이 없어 파일 전체를 공개 후보로 봤습니다. 개인 부분이 있으면 블록 밖으로 빼세요.");
  }
  plan.files.push(await repoFile(ctx, "home/powershell/profile.ps1", withTrailingNewline(publicText)));
  const local = await localFile(ctx, "powershell.local.ps1", withTrailingNewline(localText));
  if (local) plan.files.push(local);
  return plan;
}

/** git 전역 설정의 관리 키. 키 이름에 점이 있어 평평한 객체(`{"user.name": …}`)로 적는다. */
export async function planGitconfig(ctx: CaptureContext): Promise<TargetPlan> {
  const plan: TargetPlan = {
    id: "gitconfig",
    label: "git 전역 설정(관리 키)",
    sources: [ctx.gitScope.file ? shown(ctx, ctx.gitScope.file) : "git config --global"],
    files: [],
    notes: [],
  };
  const keys = (await readManagedKeys(ctx)).gitconfig;
  if (keys.length === 0) return { ...plan, error: "home/managed-keys.json에 gitconfig 키가 없습니다" };
  const current = await readGitConfig(keys, ctx.gitScope);
  const templatePath = "home/git/gitconfig.json";
  const existingValue = await readJson(path.join(ctx.repoRoot, templatePath)).catch(() => null);
  const existing = isRecord(existingValue) ? existingValue : {};
  const publicValue: Record<string, string> = {};
  const localValue: Record<string, string> = {};
  for (const key of keys) {
    const value = current[key];
    if (value === undefined) {
      if (typeof existing[key] === "string") {
        publicValue[key] = existing[key] as string;
        plan.notes.push(`${key}: 이 PC에 없어 레포 값을 유지합니다.`);
      }
      continue;
    }
    if (isPersonalValue(value, rules(ctx))) localValue[key] = value;
    else publicValue[key] = value;
  }
  if (Object.keys(localValue).length > 0) plan.notes.push(`개인 값이라 로컬 오버레이로 보냄: ${Object.keys(localValue).join(", ")}`);
  plan.files.push(await repoFile(ctx, templatePath, stableJson(publicValue)));
  const local = await localFile(ctx, "gitconfig.local.json", Object.keys(localValue).length > 0 ? stableJson(localValue) : "");
  if (local) plan.files.push(local);
  return plan;
}

export const TARGET_PLANNERS: Record<CaptureTargetId, (ctx: CaptureContext) => Promise<TargetPlan>> = {
  agents: planAgents,
  "claude-md": planClaudeMd,
  "claude-settings": planClaudeSettings,
  "codex-config": planCodexConfig,
  plugins: planPlugins,
  mcp: planMcp,
  skills: planSkills,
  "powershell-profile": planPowershellProfile,
  gitconfig: planGitconfig,
};
