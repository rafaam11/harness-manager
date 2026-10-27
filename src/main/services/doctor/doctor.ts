import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  DOCTOR_SECTION_LABELS,
  DOCTOR_SECTIONS,
  type DoctorCard,
  type DoctorCardState,
  type DoctorCheck,
  type DoctorReport,
  type DoctorSection,
} from "@shared/doctor-types";
import type {
  ExternalSkillEntry,
  MarketplaceEntry,
  McpEntry,
  PackageEntry,
  PluginsManifest,
  Profile,
  ToolEntry,
} from "@shared/manifest-types";
import { APP_SETTINGS_FILE, APP_STATE_DIR, CLAUDE_HOME, CLAUDE_JSON, CODEX_HOME, HM_USER_HOME } from "../../config.js";
import { SetupProfileStore } from "../setup-profiles.js";
import { findOnPath } from "../../providers/provider-launch.js";
import { refreshWindowsEnvironment } from "../../platform-env.js";
import { inspectNodeRuntime, type NodeRuntimeState } from "../node-runtime.js";
import { powershellProfilePath, readGitConfig, resolveDocumentsDir, stripBom, type GitConfigScope } from "../dotfiles.js";
import { HASH_MARKERS } from "../install/merge.js";
import { findBrokenLinks, findDuplicateSkills, findLeftovers, skillDirs, type CleanupScanContext } from "../cleanup-targets.js";
import { readAppSettings } from "../settings.js";
import { tildify } from "../capture/exposure.js";
import { SELF_MARKETPLACE } from "../capture/targets.js";
import { getPath, normalizeNewlines, splitMarkdownSections } from "../capture/text.js";

/** doctor가 보는 위치와 바깥 세계. 테스트는 전부 바꿔 끼운다. */
export interface DoctorContext {
  repoRoot: string;
  /** 앱 소스와 선택한 사용자 프로필을 구분한다. 테스트의 기존 fixture는 repoRoot를 쓴다. */
  templateRoot?: string;
  setupProfile?: { id: string; name: string; root: string };
  home: string;
  claudeHome: string;
  claudeJson: string;
  codexHome: string;
  /** `~/.agents/skills` — 외부 스킬(npx skills)과 공용 스킬 폴더. */
  agentsSkillsDir: string;
  profileDir: string;
  profile: Profile;
  /** 문서 폴더(PowerShell 프로필 위치). */
  documentsDir: string;
  /** git 전역 설정 대신 읽을 파일(테스트). */
  gitScope: GitConfigScope;
  env: NodeJS.ProcessEnv;
  inspectNodeRuntime(): Promise<NodeRuntimeState>;
  refreshEnvironment(): Promise<boolean>;
  findExecutable(command: string): Promise<string | null>;
  /** 실행 파일의 버전 한 줄. 실패하면 null. */
  readVersion(executable: string, args: string[]): Promise<string | null>;
  now(): Date;
}

const SELF_GITHUB_REPO = "rafaam11/harness-manager";

// ───────────────────────────── 읽기 도우미 ─────────────────────────────

async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  const text = await readText(filePath);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function readTomlFile(filePath: string): Promise<Record<string, unknown> | null> {
  const text = await readText(filePath);
  if (text === null) return null;
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list<T>(value: unknown, key: string): T[] {
  return isRecord(value) && Array.isArray(value[key]) ? (value[key] as T[]) : [];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function expandHome(value: string, home: string): string {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\") ? path.join(home, value.slice(2)) : value;
}

function samePath(a: string, b: string): boolean {
  const norm = (value: string) => path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b))) : inner,
  );
}

function short(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export interface Manifests {
  packages: PackageEntry[];
  tools: ToolEntry[];
  plugins: PluginsManifest;
  /** 공개 manifest 항목과 로컬 오버레이 항목을 합친 것. 오버레이 항목은 local로 표시한다. */
  marketplaces: { entry: MarketplaceEntry; local: boolean }[];
  claudeEnabled: { id: string; local: boolean }[];
  codexEnabled: { id: string; local: boolean }[];
  mcp: { entry: McpEntry; local: boolean }[];
  skills: { entry: ExternalSkillEntry; local: boolean }[];
}

export async function loadManifests(ctx: DoctorContext): Promise<Manifests> {
  const file = (name: string) => readJson(path.join(ctx.templateRoot ?? ctx.repoRoot, "manifest", `${name}.json`));
  const [packages, tools, plugins, mcp, skills, overlay] = await Promise.all([
    file("packages"),
    file("tools"),
    file("plugins"),
    file("mcp"),
    file("skills"),
    readJson(path.join(ctx.profileDir, "manifest.local.json")),
  ]);
  const local = isRecord(overlay) ? overlay : {};
  const pluginsValue = (isRecord(plugins) ? plugins : {}) as Partial<PluginsManifest>;
  const localPlugins = (isRecord(local.plugins) ? local.plugins : {}) as Partial<PluginsManifest>;
  const tag = <T>(items: T[] | undefined, isLocal: boolean) => (items ?? []).map((entry) => ({ entry, local: isLocal }));
  const ids = (items: string[] | undefined, isLocal: boolean) => (items ?? []).map((id) => ({ id, local: isLocal }));
  return {
    packages: list<PackageEntry>(packages, "packages"),
    tools: list<ToolEntry>(tools, "tools"),
    plugins: { schemaVersion: 1, marketplaces: [], claude: { enabled: [] }, codex: { enabled: [] }, ...pluginsValue },
    marketplaces: [...tag(pluginsValue.marketplaces, false), ...tag(localPlugins.marketplaces, true)],
    claudeEnabled: [...ids(pluginsValue.claude?.enabled, false), ...ids(localPlugins.claude?.enabled, true)],
    codexEnabled: [...ids(pluginsValue.codex?.enabled, false), ...ids(localPlugins.codex?.enabled, true)],
    mcp: [...tag(list<McpEntry>(mcp, "servers"), false), ...tag(list<McpEntry>(local.mcp, "servers"), true)],
    skills: [...tag(list<ExternalSkillEntry>(skills, "external"), false), ...tag(list<ExternalSkillEntry>(local.skills, "external"), true)],
  };
}

// ───────────────────────────── 섹션별 검사 ─────────────────────────────

async function toolCheck(ctx: DoctorContext, tool: ToolEntry | undefined, fallbackCommand: string): Promise<DoctorCheck> {
  if (!tool && ctx.templateRoot) return { id: `tools.${fallbackCommand}`, title: fallbackCommand, state: "skipped", detail: "선택한 프로필에서 관리하지 않습니다" };
  const command = tool?.verify.command ?? fallbackCommand;
  const title = tool?.name ?? command;
  const found = await ctx.findExecutable(command);
  if (!found) return { id: `tools.${tool?.id ?? command}`, title, state: "missing", detail: `PATH에서 ${command}를 찾지 못했습니다` };
  const version = tool && tool.verify.args.includes("--version") ? await ctx.readVersion(found, tool.verify.args) : null;
  if (tool?.verify.args.includes("--version") && !version) {
    return { id: `tools.${tool.id}`, title, state: "error", detail: `${tildify(found, ctx.home)}는 있지만 실행 검증에 실패했습니다. Node·PATH 등 실행 의존성을 확인하세요` };
  }
  return { id: `tools.${tool?.id ?? command}`, title, state: "ok", detail: version ? `${version} · ${tildify(found, ctx.home)}` : tildify(found, ctx.home) };
}

async function checkToolchain(ctx: DoctorContext, manifests: Manifests): Promise<DoctorCheck[]> {
  return Promise.all(
    manifests.packages.map(async (entry): Promise<DoctorCheck> => {
      const id = `packages.${entry.source}.${entry.id}`;
      const title = `${entry.id} (${entry.source} ${entry.name})`;
      if (!entry.profiles.includes(ctx.profile)) return { id, title, state: "skipped", detail: `프로필 ${entry.profiles.join("·")}` };
      if (entry.source === "winget" && entry.name === "CoreyButler.NVMforWindows") {
        try {
          const runtime = await ctx.inspectNodeRuntime();
          const paths = runtime.candidates.map((item) => `${item.version ?? "실행 실패"} ${item.path} → ${item.realPath}`);
          return {
            id, title: "Node.js 실행 환경 (기존 설치 보존)",
            state: runtime.state === "ready" ? "ok" : runtime.state === "blocked" ? "error" : "missing",
            detail: [runtime.detail, ...paths, ...runtime.registrations.map((entry) => `${entry.name} ${entry.version} (${entry.id})`)].join(" · "),
          };
        } catch (error) {
          return { id, title, state: "error", detail: `Node 보호 검사 실패 — 자동 설치하지 않습니다: ${(error as Error).message}` };
        }
      }
      if (!entry.bin) return { id, title, state: "info", detail: "실행 파일 이름이 없어 설치 여부를 확인하지 않습니다" };
      const found = await ctx.findExecutable(entry.bin);
      return found
        ? { id, title, state: "ok", detail: tildify(found, ctx.home) }
        : { id, title, state: "missing", detail: `PATH에서 ${entry.bin}을(를) 찾지 못했습니다` };
    }),
  );
}

/**
 * 관리 키 하나씩 템플릿과 비교한다. 문자열 배열은 "템플릿·로컬 오버레이 항목이 모두 들어 있으면" 정상이다 —
 * 사용자가 더 넣은 항목은 사용자 몫이다(설정 불가침).
 */
function managedKeyChecks(
  idPrefix: string,
  keys: string[],
  current: Record<string, unknown> | null,
  template: Record<string, unknown> | null,
  overlay: Record<string, unknown> | null,
): DoctorCheck[] {
  if (!template) return [{ id: `${idPrefix}.template`, title: "관리 키 템플릿", state: "info", detail: "레포 템플릿이 아직 없습니다(가져오기로 만드세요)" }];
  return keys.flatMap((key): DoctorCheck[] => {
    const expected = getPath(template, key);
    const extra = overlay ? getPath(overlay, key) : undefined;
    if (expected === undefined && extra === undefined) return [];
    const id = `${idPrefix}.${key}`;
    const actual = current ? getPath(current, key) : undefined;
    if (actual === undefined) return [{ id, title: key, state: "missing", detail: `이 PC에 없음 · 레포 ${short(expected ?? extra)}` }];
    if (Array.isArray(expected) || Array.isArray(extra)) {
      const want = [...((expected as unknown[]) ?? []), ...((extra as unknown[]) ?? [])];
      const have = Array.isArray(actual) ? actual : [];
      const lacking = want.filter((entry) => !have.some((candidate) => stable(candidate) === stable(entry)));
      return [
        lacking.length === 0
          ? { id, title: key, state: "ok", detail: `${want.length}개 모두 있음` }
          : { id, title: key, state: "drift", detail: `빠진 항목: ${lacking.map(short).join(", ")}` },
      ];
    }
    return [
      stable(actual) === stable(expected)
        ? { id, title: key, state: "ok", detail: short(actual) }
        : { id, title: key, state: "drift", detail: `이 PC ${short(actual)} · 레포 ${short(expected)}` },
    ];
  });
}

export async function managedKeys(ctx: DoctorContext): Promise<{ claudeSettings: string[]; codexConfig: string[]; gitconfig: string[] }> {
  const value = await readJson(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "managed-keys.json"));
  const strings = (key: string) => (isRecord(value) && Array.isArray(value[key]) ? (value[key] as unknown[]).filter((entry): entry is string => typeof entry === "string") : []);
  return { claudeSettings: strings("claudeSettings"), codexConfig: strings("codexConfig"), gitconfig: strings("gitconfig") };
}

async function checkClaude(ctx: DoctorContext, manifests: Manifests): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [await toolCheck(ctx, manifests.tools.find((tool) => tool.id === "claude"), "claude")];

  const template = await readText(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "claude", "CLAUDE.md"));
  const current = await readText(path.join(ctx.claudeHome, "CLAUDE.md"));
  if (template !== null) {
    const normalize = (text: string) =>
      normalizeNewlines(text)
        .split("\n")
        .map((line) => line.replace(/^@(\S+)/, (_, target: string) => `@${tildify(target, ctx.home)}`))
        .join("\n")
        .trim();
    checks.push(
      current === null
        ? { id: "claude.claude-md", title: "전역 CLAUDE.md", state: "missing", detail: "~/.claude/CLAUDE.md가 없습니다" }
        : normalize(current) === normalize(template)
          ? { id: "claude.claude-md", title: "전역 CLAUDE.md", state: "ok", detail: normalize(current).split("\n")[0] ?? "" }
          : { id: "claude.claude-md", title: "전역 CLAUDE.md", state: "drift", detail: "레포 템플릿과 다릅니다" },
    );
  }

  const keys = (await managedKeys(ctx)).claudeSettings;
  const settings = await readJson(path.join(ctx.claudeHome, "settings.json"));
  const settingsTemplate = await readJson(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "claude", "settings.managed.json"));
  const overlay = await readJson(path.join(ctx.profileDir, "claude-settings.local.json"));
  checks.push(
    ...managedKeyChecks(
      "claude.settings",
      keys,
      isRecord(settings) ? settings : null,
      isRecord(settingsTemplate) ? settingsTemplate : null,
      isRecord(overlay) ? overlay : null,
    ),
  );
  return checks;
}

async function checkCodex(ctx: DoctorContext, manifests: Manifests): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [await toolCheck(ctx, manifests.tools.find((tool) => tool.id === "codex"), "codex")];

  // 전역 AGENTS.md는 ~/.codex에 살고 Claude는 CLAUDE.md의 @import로 같은 파일을 읽는다.
  const template = await readText(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "agents", "AGENTS.md"));
  const current = await readText(path.join(ctx.codexHome, "AGENTS.md"));
  if (template !== null) {
    const squash = (text: string) => normalizeNewlines(text).replace(/\s+/g, " ").trim();
    const sections = splitMarkdownSections(template).filter((section) => section.heading !== null);
    const lacking = current === null ? sections : sections.filter((section) => !squash(current).includes(squash(section.text)));
    checks.push(
      current === null
        ? { id: "codex.agents-md", title: "전역 AGENTS.md", state: "missing", detail: "~/.codex/AGENTS.md가 없습니다" }
        : lacking.length === 0
          ? { id: "codex.agents-md", title: "전역 AGENTS.md", state: "ok", detail: `공개 섹션 ${sections.length}개가 레포와 같습니다` }
          : { id: "codex.agents-md", title: "전역 AGENTS.md", state: "drift", detail: `레포와 다른 섹션: ${lacking.map((section) => section.heading).join(", ")}` },
    );
  }

  const keys = (await managedKeys(ctx)).codexConfig;
  const config = await readTomlFile(path.join(ctx.codexHome, "config.toml"));
  const templateText = await readText(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "codex", "config.managed.toml"));
  let configTemplate: Record<string, unknown> | null = null;
  try {
    configTemplate = templateText ? (parseToml(templateText) as Record<string, unknown>) : null;
  } catch {
    configTemplate = null;
  }
  const overlay = await readJson(path.join(ctx.profileDir, "codex-config.local.json"));
  checks.push(...managedKeyChecks("codex.config", keys, config, configTemplate, isRecord(overlay) ? overlay : null));
  return checks;
}

function selfSourceState(ctx: DoctorContext, kind: string, location: string): { state: DoctorCheck["state"]; detail: string } {
  if (kind === "directory") {
    return samePath(location, ctx.repoRoot)
      ? { state: "ok", detail: `이 레포 폴더(directory)` }
      : { state: "drift", detail: `다른 폴더를 가리킵니다: ${tildify(location, ctx.home)}` };
  }
  return location.toLowerCase().includes(SELF_GITHUB_REPO)
    ? { state: "ok", detail: `GitHub ${SELF_GITHUB_REPO}` }
    : { state: "drift", detail: `다른 소스를 가리킵니다: ${location}` };
}

async function checkPlugins(ctx: DoctorContext, manifests: Manifests): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const known = await readJson(path.join(ctx.claudeHome, "plugins", "known_marketplaces.json"));
  const settings = await readJson(path.join(ctx.claudeHome, "settings.json"));
  const codex = (await readTomlFile(path.join(ctx.codexHome, "config.toml"))) ?? {};

  for (const { entry, local } of manifests.marketplaces) {
    for (const provider of entry.providers) {
      const id = `plugins.marketplace.${entry.name}.${provider}`;
      const title = `마켓플레이스 ${entry.name} (${provider === "claude" ? "Claude" : "Codex"})`;
      let kind: string | null = null;
      let location = "";
      if (provider === "claude") {
        const source = isRecord(known) && isRecord(known[entry.name]) ? (known[entry.name] as Record<string, unknown>).source : null;
        if (isRecord(source)) {
          kind = String(source.source);
          location = String(source.path ?? source.repo ?? source.url ?? "");
        }
      } else {
        const table = isRecord(codex.marketplaces) ? codex.marketplaces[entry.name] : null;
        if (isRecord(table)) {
          kind = table.source_type === "local" ? "directory" : String(table.source_type);
          location = String(table.source ?? "").replace(/^\\\\\?\\/, "");
        }
      }
      if (kind === null) {
        checks.push({ id, title, state: "missing", detail: "등록되어 있지 않습니다", local });
        continue;
      }
      const verdict =
        entry.source.kind === "self"
          ? selfSourceState(ctx, kind, location)
          : { state: "ok" as const, detail: `${kind} ${location}` };
      checks.push({ id, title, ...verdict, local });
    }
  }

  const claudeOn = isRecord(settings) && isRecord(settings.enabledPlugins) ? settings.enabledPlugins : {};
  for (const { id: pluginId, local } of manifests.claudeEnabled) {
    checks.push({
      id: `plugins.claude.${pluginId}`,
      title: `${pluginId} (Claude)`,
      state: claudeOn[pluginId] === true ? "ok" : "missing",
      detail: claudeOn[pluginId] === true ? "켜져 있음" : claudeOn[pluginId] === false ? "설치됐지만 꺼져 있음" : "설치되지 않음",
      local,
    });
  }
  const codexPlugins = isRecord(codex.plugins) ? codex.plugins : {};
  for (const { id: pluginId, local } of manifests.codexEnabled) {
    const table = codexPlugins[pluginId];
    const on = isRecord(table) && table.enabled === true;
    checks.push({
      id: `plugins.codex.${pluginId}`,
      title: `${pluginId} (Codex)`,
      state: on ? "ok" : "missing",
      detail: on ? "켜져 있음" : isRecord(table) ? "꺼져 있음" : "설치되지 않음",
      local,
    });
  }

  // mod 의존성(스펙 §5-3).
  const enabled = new Set(manifests.claudeEnabled.map((entry) => entry.id));
  if (enabled.has(`codex-watch@${SELF_MARKETPLACE}`)) {
    const cache = path.join(ctx.claudeHome, "plugins", "cache", "openai-codex");
    const companion = await findFile(cache, "codex-companion.mjs", 6);
    checks.push(
      companion
        ? { id: "plugins.dep.codex-watch", title: "codex-watch 의존성", state: "ok", detail: tildify(companion, ctx.home) }
        : {
            id: "plugins.dep.codex-watch",
            title: "codex-watch 의존성",
            state: "drift",
            detail: "openai-codex 플러그인의 codex-companion.mjs가 없어 codex-watch가 동작하지 않습니다",
          },
    );
  }
  for (const mod of ["mcw-companion", "mcw-chips"]) {
    if (enabled.has(`${mod}@${SELF_MARKETPLACE}`)) {
      checks.push({ id: `plugins.dep.${mod}`, title: `${mod}`, state: "info", detail: "multi-cli-work 세션에서만 동작합니다" });
    }
  }
  const userConfig = isRecord(settings) && isRecord(settings.pluginConfigs) ? settings.pluginConfigs : {};
  for (const mod of ["jinmin-hud", "mcw-chips"]) {
    if (enabled.has(`${mod}@${SELF_MARKETPLACE}`) && !isRecord(userConfig[`${mod}@${SELF_MARKETPLACE}`])) {
      checks.push({ id: `plugins.config.${mod}`, title: `${mod} 옵션`, state: "info", detail: "userConfig가 없어 기본값으로 동작합니다" });
    }
  }

  // 제거한 claude-hud가 남긴 폴더(스펙 §5-3). 지우지 않고 정리 화면에서 아카이브한다.
  for (const leftover of await findLeftovers(cleanupScanContext(ctx))) {
    if (!leftover.path.toLowerCase().includes("claude-hud")) continue;
    checks.push({
      id: `plugins.leftover.${path.basename(path.dirname(leftover.path))}`,
      title: "claude-hud 잔여 폴더",
      state: "drift",
      detail: `${tildify(leftover.path, ctx.home)} — 정리 화면에서 아카이브하세요`,
    });
  }
  return checks;
}

async function findFile(root: string, name: string, depth: number): Promise<string | null> {
  if (depth < 0) return null;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) if (entry.isFile() && entry.name === name) return path.join(root, entry.name);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findFile(path.join(root, entry.name), name, depth - 1);
    if (found) return found;
  }
  return null;
}

function cleanupScanContext(ctx: DoctorContext): CleanupScanContext {
  return {
    home: ctx.home,
    claudeHome: ctx.claudeHome,
    codexHome: ctx.codexHome,
    agentsSkillsDir: ctx.agentsSkillsDir,
    appStateDir: path.dirname(ctx.profileDir),
    repoRoot: ctx.repoRoot,
    staleDays: 30,
    now: ctx.now().getTime(),
  };
}

async function checkSkills(ctx: DoctorContext, manifests: Manifests): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  for (const { entry, local } of manifests.skills) {
    const id = `skills.external.${entry.id}`;
    if (!entry.profiles.includes(ctx.profile)) {
      checks.push({ id, title: entry.id, state: "skipped", detail: `프로필 ${entry.profiles.join("·")}`, local });
      continue;
    }
    const installed = await exists(path.join(ctx.agentsSkillsDir, entry.id, "SKILL.md"));
    checks.push({ id, title: entry.id, state: installed ? "ok" : "missing", detail: installed ? `${entry.source}` : `${entry.source}에서 설치되지 않음`, local });
  }

  // 정리 화면과 같은 함수로 찾는다 — 상태판이 노랑으로 알리는 것을 정리 화면이 그대로 후보로 보인다.
  const scan = cleanupScanContext(ctx);
  for (const link of await findBrokenLinks(skillDirs(scan).map((entry) => entry.dir))) {
    checks.push({
      id: `skills.broken.${tildify(link.path, ctx.home)}`,
      title: `깨진 링크 ${path.basename(link.path)}`,
      state: "drift",
      detail: `${tildify(link.path, ctx.home)} → ${link.target ? tildify(link.target, ctx.home) : "?"} (대상 없음) — 정리 화면에서 아카이브하세요`,
    });
  }
  for (const duplicate of await findDuplicateSkills(scan)) {
    checks.push({
      id: `skills.duplicate.${tildify(duplicate.path, ctx.home)}`,
      title: `중복 스킬 ${path.basename(duplicate.path)}`,
      state: "drift",
      detail: `${tildify(duplicate.path, ctx.home)}는 플러그인 ${duplicate.plugin}로 옮겨진 스킬의 낡은 사본입니다 — 정리 화면에서 아카이브하세요`,
    });
  }
  return checks;
}

async function checkMcp(ctx: DoctorContext, manifests: Manifests): Promise<DoctorCheck[]> {
  const claudeJson = await readJson(ctx.claudeJson);
  const claudeServers = isRecord(claudeJson) && isRecord(claudeJson.mcpServers) ? claudeJson.mcpServers : {};
  const codex = (await readTomlFile(path.join(ctx.codexHome, "config.toml"))) ?? {};
  const codexServers = isRecord(codex.mcp_servers) ? codex.mcp_servers : {};
  const checks: DoctorCheck[] = [];
  for (const { entry, local } of manifests.mcp) {
    for (const target of entry.targets) {
      const id = `mcp.${entry.name}.${target}`;
      const title = `${entry.name} (${target === "claude" ? "Claude" : "Codex"})`;
      if (!entry.profiles.includes(ctx.profile)) {
        checks.push({ id, title, state: "skipped", detail: `프로필 ${entry.profiles.join("·")}`, local });
        continue;
      }
      const registered = (target === "claude" ? claudeServers : codexServers)[entry.name];
      if (!isRecord(registered)) {
        checks.push({ id, title, state: "missing", detail: "등록되어 있지 않습니다", local });
        continue;
      }
      const command = typeof registered.command === "string" ? registered.command : "";
      const want = expandHome(entry.command, ctx.home);
      const sameCommand = samePath(command, want) || command === entry.command;
      checks.push(
        sameCommand
          ? { id, title, state: "ok", detail: tildify(command, ctx.home), local }
          : { id, title, state: "drift", detail: `명령이 다릅니다: ${tildify(command, ctx.home)} · 레포 ${entry.command}`, local },
      );
    }
  }
  return checks;
}

async function checkCua(ctx: DoctorContext, manifests: Manifests): Promise<DoctorCheck[]> {
  const tool = manifests.tools.find((entry) => entry.id === "cua-driver");
  const server = manifests.mcp.find(({ entry }) => entry.name === "cua-driver")?.entry;
  const id = "tools.cua-driver";
  if (tool && !tool.profiles.includes(ctx.profile)) {
    return [{ id, title: "cua-driver", state: "skipped", detail: `프로필 ${tool.profiles.join("·")}` }];
  }
  // 설치기는 PATH에 넣지 않고 ~/.cua-driver에 둔다. MCP 등록에 쓰는 경로가 곧 설치 위치다.
  const onPath = await ctx.findExecutable("cua-driver");
  const installed = server ? expandHome(server.command, ctx.home) : null;
  const found = onPath ?? (installed && (await exists(installed)) ? installed : null);
  const checks: DoctorCheck[] = [
    found
      ? { id, title: "cua-driver 설치", state: "ok", detail: `${tildify(found, ctx.home)}${tool?.version ? ` · manifest ${tool.version}` : ""}` }
      : { id, title: "cua-driver 설치", state: "missing", detail: "PATH와 ~/.cua-driver 어디에도 없습니다" },
  ];
  checks.push({ id: "cua.telemetry", title: "텔레메트리", state: "info", detail: "끄는 키는 M6에서 확인합니다(스펙 Q7)" });
  return checks;
}

async function checkDotfiles(ctx: DoctorContext): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const template = await readText(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "powershell", "profile.ps1"));
  if (template !== null) {
    const id = "dotfiles.powershell-profile";
    const target = powershellProfilePath(ctx.documentsDir);
    const raw = await readText(target);
    if (raw === null) {
      checks.push({ id, title: "PowerShell 프로필", state: "missing", detail: `${tildify(target, ctx.home)}가 없습니다` });
    } else {
      // 마커 블록이 있으면 그 안을, 없으면 파일 전체를 레포 템플릿과 비교한다(capture와 같은 규칙).
      const text = normalizeNewlines(stripBom(raw));
      const start = text.indexOf(HASH_MARKERS.start);
      const end = text.indexOf(HASH_MARKERS.end);
      const managed = start >= 0 && end > start ? text.slice(start + HASH_MARKERS.start.length, end) : text;
      checks.push(
        managed.trim() === normalizeNewlines(template).trim()
          ? { id, title: "PowerShell 프로필", state: "ok", detail: tildify(target, ctx.home) }
          : { id, title: "PowerShell 프로필", state: "drift", detail: "레포 템플릿과 다릅니다" },
      );
    }
  }

  const keys = (await managedKeys(ctx)).gitconfig;
  const templateValue = await readJson(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "git", "gitconfig.json"));
  const overlayValue = await readJson(path.join(ctx.profileDir, "gitconfig.local.json"));
  const expected = { ...(isRecord(templateValue) ? templateValue : {}), ...(isRecord(overlayValue) ? overlayValue : {}) };
  const wanted = keys.filter((key) => typeof expected[key] === "string");
  const actual = await readGitConfig(wanted, ctx.gitScope);
  for (const key of wanted) {
    const id = `dotfiles.git.${key}`;
    const value = actual[key];
    const local = isRecord(overlayValue) && key in overlayValue;
    if (value === undefined) checks.push({ id, title: `git ${key}`, state: "missing", detail: "설정되지 않음", local });
    else if (value === expected[key]) checks.push({ id, title: `git ${key}`, state: "ok", detail: local ? "(로컬 값)" : value, local });
    else checks.push({ id, title: `git ${key}`, state: "drift", detail: `이 PC ${value} · 레포 ${expected[key] as string}`, local });
  }
  checks.push({ id: "dotfiles.windows-terminal", title: "Windows Terminal", state: "info", detail: "settings.json이 주석 있는 JSON이라 아직 관리하지 않습니다" });
  return checks;
}

// ───────────────────────────── 집계 ─────────────────────────────

export function cardState(checks: DoctorCheck[]): DoctorCardState {
  if (checks.some((check) => check.state === "missing" || check.state === "error")) return "fail";
  if (checks.some((check) => check.state === "drift")) return "warn";
  if (checks.some((check) => check.state === "ok")) return "ok";
  return "info";
}

function cardSummary(section: DoctorSection, checks: DoctorCheck[]): string {
  const counted = checks.filter((check) => check.state !== "info" && check.state !== "skipped");
  if (counted.length === 0) return checks[0]?.detail ?? "검사할 항목이 없습니다";
  const ok = counted.filter((check) => check.state === "ok").length;
  const noun = section === "toolchain" ? "패키지" : "항목";
  const parts = [`${noun} ${ok}/${counted.length} 정상`];
  const missing = counted.filter((check) => check.state === "missing" || check.state === "error").length;
  const drift = counted.filter((check) => check.state === "drift").length;
  if (missing > 0) parts.push(`${missing}개 없음`);
  if (drift > 0) parts.push(`${drift}개 다름`);
  return parts.join(" · ");
}

const SECTION_CHECKS: Record<DoctorSection, (ctx: DoctorContext, manifests: Manifests) => Promise<DoctorCheck[]> | DoctorCheck[]> = {
  toolchain: checkToolchain,
  claude: checkClaude,
  codex: checkCodex,
  plugins: checkPlugins,
  skills: checkSkills,
  mcp: checkMcp,
  cua: checkCua,
  dotfiles: checkDotfiles,
};

export async function runDoctorWith(ctx: DoctorContext): Promise<DoctorReport> {
  const manifests = await loadManifests(ctx);
  const cards = await Promise.all(
    DOCTOR_SECTIONS.map(async (section): Promise<DoctorCard> => {
      let checks: DoctorCheck[];
      try {
        checks = await SECTION_CHECKS[section](ctx, manifests);
      } catch (error) {
        checks = [{ id: `${section}.error`, title: "검사 실패", state: "error", detail: (error as Error).message }];
      }
      return { section, label: DOCTOR_SECTION_LABELS[section], state: cardState(checks), summary: cardSummary(section, checks), checks };
    }),
  );
  return { schemaVersion: 1, generatedAt: ctx.now().toISOString(), profile: ctx.profile, setupProfile: ctx.setupProfile, repoRoot: ctx.repoRoot, cards };
}

// ───────────────────────────── 실제 PC용 기본값 ─────────────────────────────

export function readVersionLine(executable: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  // npm 전역 설치는 .cmd 심이라 셸 없이는 못 띄운다. 경로는 PATH에서 찾은 값, 인자는 manifest 상수뿐이다.
  const isShim = /\.(cmd|bat)$/i.test(executable);
  const file = isShim ? process.env.ComSpec || "cmd.exe" : executable;
  const fileArgs = isShim ? ["/d", "/s", "/c", `"${executable}" ${args.join(" ")}`] : args;
  return new Promise((resolve) => {
    execFile(file, fileArgs, { env, windowsHide: true, timeout: 8_000, windowsVerbatimArguments: isShim }, (error, stdout) => {
      const line = String(stdout ?? "")
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find(Boolean);
      resolve(error || !line ? null : line);
    });
  });
}

export async function defaultDoctorContext(repoRoot: string, profile?: Profile): Promise<DoctorContext> {
  const selected = await new SetupProfileStore(APP_STATE_DIR, repoRoot).active();
  const env = await refreshWindowsEnvironment(process.env);
  // 레지스트리에 없는 세션 전용 Node도 이관 보호 검사에서는 놓치지 않는다.
  env.HM_NODE_ORIGINAL_PATH = Object.entries(process.env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  return {
    repoRoot,
    templateRoot: selected.root,
    setupProfile: { id: selected.id, name: selected.name, root: selected.root },
    home: HM_USER_HOME,
    claudeHome: CLAUDE_HOME,
    claudeJson: CLAUDE_JSON,
    codexHome: CODEX_HOME,
    agentsSkillsDir: path.join(HM_USER_HOME, ".agents", "skills"),
    profileDir: selected.localDir,
    documentsDir: await resolveDocumentsDir(HM_USER_HOME),
    gitScope: {},
    profile: profile ?? (await readAppSettings(APP_SETTINGS_FILE)).profile,
    env,
    inspectNodeRuntime: () => inspectNodeRuntime(repoRoot, env),
    refreshEnvironment: async () => {
      const next = await refreshWindowsEnvironment(env);
      const changed = JSON.stringify(env) !== JSON.stringify(next);
      for (const key of Object.keys(env)) delete env[key];
      Object.assign(env, next);
      return changed;
    },
    findExecutable: (command) => findOnPath(command, process.platform, env),
    readVersion: (executable, args) => readVersionLine(executable, args, env),
    now: () => new Date(),
  };
}

export async function runDoctor(repoRoot: string | null, profile?: Profile): Promise<DoctorReport> {
  if (!repoRoot) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      profile: profile ?? (await readAppSettings(APP_SETTINGS_FILE)).profile,
      repoRoot: null,
      repoError: "harness-manager 레포 클론을 찾지 못했습니다.",
      cards: [],
    };
  }
  return runDoctorWith(await defaultDoctorContext(repoRoot, profile));
}
