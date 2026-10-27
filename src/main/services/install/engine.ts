import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { DoctorCheck, DoctorReport, DoctorSection } from "@shared/doctor-types";
import type {
  InstallAction,
  InstallEvent,
  InstallPlan,
  InstallRunResult,
  InstallStep,
  InstallStepResult,
  InstallStepState,
} from "@shared/install-types";
import type { MarketplaceEntry, McpEntry, PackageEntry, Profile, ToolEntry } from "@shared/manifest-types";
import { APP_SETTINGS_FILE, APP_STATE_DIR } from "../../config.js";
import { withLock } from "../../lib/lock.js";
import { createInstallJournal } from "./journal.js";
import { readAppSettings } from "../settings.js";
import { gitConfigSetArgs, powershellProfilePath, readGitConfig, stripBom } from "../dotfiles.js";
import { writeFileChecked } from "../capture/capture.js";
import { tildify } from "../capture/exposure.js";
import { SELF_MARKETPLACE } from "../capture/targets.js";
import { nodeRuntimeCommand, TERMINAL_NOTICE } from "../node-runtime.js";
import { splitMarkdownSections, stableJson, unifiedDiff, withTrailingNewline } from "../capture/text.js";
import { defaultDoctorContext, loadManifests, managedKeys, runDoctorWith, type DoctorContext, type Manifests } from "../doctor/doctor.js";
import { displayCommand, processRunner, type CommandRunner, type CommandSpec, type LogSink } from "./exec.js";
import { HASH_MARKERS, MARKDOWN_MARKERS, adoptSectionsIntoBlock, mergeManagedJson, patchTomlScalars, tomlEntriesFor, upsertMarkerBlock } from "./merge.js";

export interface InstallContext extends DoctorContext {
  runner: CommandRunner;
  /** 이 레포 마켓플레이스(jinmin)를 붙일 소스. 개발 PC는 레포 폴더, 새 PC는 GitHub(D15). */
  selfSource: "directory" | "github";
  /** MCP env 자리표시(`${NAME}`)를 채울 환경. */
  env: NodeJS.ProcessEnv;
  logDir?: string;
}

export const SELF_GITHUB_SOURCE = "rafaam11/harness-manager";
const PACKAGE_TIMEOUT_MS = 15 * 60_000;
const COMMAND_TIMEOUT_MS = 5 * 60_000;

/** step 하나의 정의. 상태는 doctor 검사에서 오고, 할 일은 manifest에서 main이 정한다. */
interface StepDef {
  id: string;
  section: DoctorSection;
  title: string;
  /** 실행 순서. 작을수록 먼저(패키지 → 도구 → 전역 문서 → Claude → Codex → MCP → 스킬). */
  rank: number;
  checks(report: DoctorReport): DoctorCheck[];
  manual?: string;
  /** report는 엔진이 방금 돌린 doctor 결과다. step이 doctor를 다시 돌리지 않게 넘긴다. */
  plan(ctx: InstallContext, report: DoctorReport): Promise<InstallAction[]>;
  apply(ctx: InstallContext, log: LogSink, signal: AbortSignal, report: DoctorReport): Promise<void>;
}

class StepFailure extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const text = await readText(filePath);
  if (text === null) return {};
  const value = JSON.parse(text) as unknown;
  return isRecord(value) ? value : {};
}

function expandHome(value: string, home: string): string {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\") ? path.join(home, value.slice(2)) : value;
}

function allChecks(report: DoctorReport): DoctorCheck[] {
  return report.cards.flatMap((card) => card.checks);
}

const byId = (id: string) => (report: DoctorReport) => allChecks(report).filter((check) => check.id === id);
const byPrefix = (prefix: string) => (report: DoctorReport) => allChecks(report).filter((check) => check.id.startsWith(prefix));

const STATE_ORDER: InstallStepState[] = ["error", "missing", "drift", "ok", "info", "skipped"];

function worstState(checks: DoctorCheck[]): InstallStepState {
  if (checks.length === 0) return "info";
  return STATE_ORDER.find((state) => checks.some((check) => check.state === state)) ?? "info";
}

function needsWork(state: InstallStepState): boolean {
  return state === "missing" || state === "drift" || state === "error";
}

async function runCommand(ctx: InstallContext, spec: CommandSpec, log: LogSink, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new StepFailure("취소했습니다");
  if (["npm", "npx", "codex"].includes(spec.command)) {
    const runtime = await ctx.inspectNodeRuntime();
    if (runtime.state !== "ready") throw new StepFailure(`Node 선행 검증 실패 — ${spec.command} 실행을 중단합니다: ${runtime.detail}`);
  }
  // 명령줄만 가리면 부족하다: CLI가 받은 값을 출력에 되풀이할 수 있어 이 step의 모든 로그 줄에서 값을 지운다.
  const secrets = spec.args.filter((arg) => /^[A-Z_][A-Z0-9_]*=./.test(arg)).map((arg) => arg.slice(arg.indexOf("=") + 1));
  const masked: LogSink = (stream, line) => log(stream, secrets.reduce((text, secret) => text.split(secret).join("***"), line));
  masked("info", `$ ${displayCommand({ command: spec.command, args: spec.args.map(maskEnvArg) })}`);
  const result = await ctx.runner.run({ ...spec, env: { ...ctx.env, ...spec.env } }, masked, signal);
  if (["winget", "scoop"].includes(spec.command) || spec.args.includes("-Install")) {
    if (await ctx.refreshEnvironment()) log("info", TERMINAL_NOTICE);
  }
  if (signal.aborted) throw new StepFailure("취소했습니다");
  if (result.notFound) throw new StepFailure(`${spec.command}를 PATH에서 찾지 못했습니다`);
  if (result.timedOut) throw new StepFailure(`${Math.round(spec.timeoutMs / 1000)}초 안에 끝나지 않았습니다`);
  if (result.code !== 0) throw new StepFailure(`종료 코드 ${result.code}`);
}

/** `-e KEY=value`의 값은 비밀일 수 있어 로그와 미리보기에 남기지 않는다. */
function maskEnvArg(arg: string): string {
  return /^[A-Z_][A-Z0-9_]*=/.test(arg) ? `${arg.slice(0, arg.indexOf("="))}=***` : arg;
}

function commandAction(spec: Pick<CommandSpec, "command" | "args">): InstallAction {
  return { kind: "command", summary: displayCommand({ command: spec.command, args: spec.args.map(maskEnvArg) }) };
}

// ───────────────────────────── 패키지·도구 ─────────────────────────────

const PACKAGE_RANK: Record<PackageEntry["source"], number> = { winget: 0, scoop: 1, npm: 2, cargo: 3, uv: 4 };

function packageCommand(entry: PackageEntry): CommandSpec {
  const timeoutMs = PACKAGE_TIMEOUT_MS;
  switch (entry.source) {
    case "winget":
      return {
        command: "winget",
        args: ["install", "--id", entry.name, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"],
        timeoutMs,
      };
    case "scoop":
      return { command: "scoop", args: ["install", entry.name], timeoutMs };
    case "npm":
      return { command: "npm", args: ["install", "-g", entry.name], timeoutMs };
    case "cargo":
      return { command: "cargo", args: ["install", entry.name], timeoutMs };
    case "uv":
      return { command: "uv", args: ["tool", "install", entry.name], timeoutMs };
  }
}

function toolCommand(tool: ToolEntry): CommandSpec | null {
  switch (tool.install.kind) {
    case "powershell-script":
      if (!/^https:\/\/[\w./-]+$/.test(tool.install.ref)) throw new Error(`${tool.id}: 설치 스크립트 주소가 올바르지 않습니다`);
      return {
        command: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm '${tool.install.ref}' | iex`],
        timeoutMs: COMMAND_TIMEOUT_MS,
      };
    case "npm":
      return { command: "npm", args: ["install", "-g", tool.install.ref], timeoutMs: PACKAGE_TIMEOUT_MS };
    case "winget":
      return packageCommand({ id: tool.id, source: "winget", name: tool.install.ref, profiles: tool.profiles });
    case "manual":
      return null;
  }
}

function commandStep(base: Omit<StepDef, "plan" | "apply">, spec: CommandSpec): StepDef {
  return {
    ...base,
    plan: async () => [commandAction(spec)],
    apply: (ctx, log, signal) => runCommand(ctx, spec, log, signal),
  };
}

function toolStep(tool: ToolEntry, section: DoctorSection, rank: number): StepDef {
  const spec = toolCommand(tool);
  const base = { id: `tools.${tool.id}`, section, title: `${tool.name} 설치`, rank, checks: byId(`tools.${tool.id}`) };
  if (!spec) {
    return {
      ...base,
      manual: tool.install.ref,
      plan: async () => [{ kind: "manual", summary: tool.install.ref }],
      apply: async () => undefined,
    };
  }
  return commandStep(base, spec);
}

function nodeRuntimeStep(entry: PackageEntry): StepDef {
  const id = `packages.${entry.source}.${entry.id}`;
  return {
    id, section: "toolchain", title: "Node.js 실행 환경 (기존 설치 보존)", rank: 100, checks: byId(id),
    plan: async (ctx) => {
      const runtime = await ctx.inspectNodeRuntime();
      if (runtime.state === "blocked") return [{ kind: "manual", summary: runtime.detail }];
      if (runtime.state === "ready") return [];
      return [
        { kind: "manual", summary: "기존 Node·MSI·NVM을 실행 직전에 다시 확인합니다. 자동 이관·제거는 하지 않습니다." },
        ...(!runtime.nvm ? [{ kind: "command" as const, summary: "winget install --id CoreyButler.NVMforWindows --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity" }] : []),
        { kind: "command", summary: "nvm install 22" },
        { kind: "command", summary: "nvm use <설치·실행 검증을 통과한 정확한 22.x.y 버전>" },
        { kind: "manual", summary: "node/npm 버전과 실제 활성 경로를 확인한 뒤 다음 단계로 진행합니다. " + TERMINAL_NOTICE },
      ];
    },
    apply: async (ctx, log, signal) => {
      const runtime = await ctx.inspectNodeRuntime();
      if (runtime.state === "ready") return;
      if (runtime.state === "blocked") throw new StepFailure(runtime.detail);
      await runCommand(ctx, nodeRuntimeCommand(ctx.repoRoot, "install"), log, signal);
      log("info", TERMINAL_NOTICE);
    },
  };
}

// ───────────────────────────── 파일 merge ─────────────────────────────

interface FileChange {
  absPath: string;
  before: string | null;
  after: string;
}

function fileStep(base: Omit<StepDef, "plan" | "apply">, compute: (ctx: InstallContext) => Promise<FileChange>): StepDef {
  return {
    ...base,
    plan: async (ctx) => {
      const change = await compute(ctx);
      if ((change.before ?? "") === change.after) return [];
      return [
        {
          kind: "file",
          summary: `${tildify(change.absPath, ctx.home)} ${change.before === null ? "만들기" : "고치기(백업 후)"}`,
          diff: unifiedDiff(tildify(change.absPath, ctx.home), change.before, change.after, { before: "이 PC", after: "레포" }),
        },
      ];
    },
    apply: async (ctx, log) => {
      const change = await compute(ctx);
      if ((change.before ?? "") === change.after) return;
      await writeFileChecked(change.absPath, change.before, change.after, tildify(change.absPath, ctx.home));
      log("info", `${tildify(change.absPath, ctx.home)}을(를) 썼습니다(원본은 ~/.harness-manager/backups).`);
    },
  };
}

async function claudeMdChange(ctx: InstallContext): Promise<FileChange> {
  const absPath = path.join(ctx.claudeHome, "CLAUDE.md");
  const template = await readText(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "claude", "CLAUDE.md"));
  if (template === null) throw new StepFailure("레포에 home/claude/CLAUDE.md가 없습니다");
  const before = await readText(absPath);
  // 내용이 없거나 레포 것만 있던 파일은 그대로 바꾸고, 사용자가 쓴 다른 내용이 있으면 마커 블록으로 덧붙인다.
  const after = before === null || before.trim() === "" ? withTrailingNewline(template) : upsertMarkerBlock(before, template, MARKDOWN_MARKERS);
  return { absPath, before, after };
}

async function agentsMdChange(ctx: InstallContext): Promise<FileChange> {
  const absPath = path.join(ctx.codexHome, "AGENTS.md");
  const template = await readText(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "agents", "AGENTS.md"));
  if (template === null) throw new StepFailure("레포에 home/agents/AGENTS.md가 없습니다");
  const before = await readText(absPath);
  const headings = splitMarkdownSections(template)
    .map((section) => section.heading)
    .filter((heading): heading is string => heading !== null);
  if (before === null) {
    // 새 PC: 로컬 프로필의 개인 부분(있으면) + 공개 블록으로 처음 만든다.
    const local = (await readText(path.join(ctx.profileDir, "AGENTS.local.md"))) ?? "";
    return { absPath, before, after: upsertMarkerBlock(local, template, MARKDOWN_MARKERS) };
  }
  return { absPath, before, after: adoptSectionsIntoBlock(before, headings, template) };
}

async function claudeSettingsChange(ctx: InstallContext): Promise<FileChange> {
  const absPath = path.join(ctx.claudeHome, "settings.json");
  const before = await readText(absPath);
  const current = before === null ? {} : (JSON.parse(before) as Record<string, unknown>);
  const template = await readJsonObject(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "claude", "settings.managed.json"));
  const overlay = await readJsonObject(path.join(ctx.profileDir, "claude-settings.local.json"));
  const keys = (await managedKeys(ctx)).claudeSettings;
  const next = mergeManagedJson(current, keys, template, overlay);
  const after = JSON.stringify(next) === JSON.stringify(current) && before !== null ? before : stableJson(next);
  return { absPath, before, after };
}

async function codexConfigChange(ctx: InstallContext): Promise<FileChange> {
  const absPath = path.join(ctx.codexHome, "config.toml");
  const before = (await readText(absPath)) ?? null;
  const templateText = await readText(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "codex", "config.managed.toml"));
  const template = templateText ? (parseToml(templateText) as Record<string, unknown>) : {};
  const overlay = await readJsonObject(path.join(ctx.profileDir, "codex-config.local.json"));
  const keys = (await managedKeys(ctx)).codexConfig;
  const entries = [...tomlEntriesFor(keys, template), ...tomlEntriesFor(keys, overlay)];
  return { absPath, before, after: patchTomlScalars(before ?? "", entries) };
}

/**
 * PowerShell 프로필: 마커 블록만 관리한다. 파일이 없으면 블록만으로 만들고, 블록이 있으면 안만 바꾸고,
 * 블록이 없으면 끝에 붙인다. 한글 주석이 PowerShell 5.1에서 깨지지 않게 BOM을 붙여 쓴다.
 */
async function powershellProfileChange(ctx: InstallContext): Promise<FileChange> {
  const absPath = powershellProfilePath(ctx.documentsDir);
  const template = await readText(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "powershell", "profile.ps1"));
  if (template === null) throw new StepFailure("레포에 home/powershell/profile.ps1이 없습니다");
  const before = await readText(absPath);
  const body = stripBom(before ?? "");
  if (before === null || body.trim() === "") {
    const local = (await readText(path.join(ctx.profileDir, "powershell.local.ps1"))) ?? "";
    return { absPath, before, after: `\uFEFF${upsertMarkerBlock(local, template, HASH_MARKERS)}` };
  }
  return { absPath, before, after: `\uFEFF${upsertMarkerBlock(body, template, HASH_MARKERS)}` };
}

/** git 전역 설정의 관리 키를 `git config`로 맞춘다. 레포 값 위에 로컬 오버레이(이메일 등)를 얹는다. */
function gitconfigStep(rank: number): StepDef {
  const desired = async (ctx: InstallContext): Promise<CommandSpec[]> => {
    const template = await readJsonObject(path.join(ctx.templateRoot ?? ctx.repoRoot, "home", "git", "gitconfig.json"));
    const overlay = await readJsonObject(path.join(ctx.profileDir, "gitconfig.local.json"));
    const expected = { ...template, ...overlay };
    const keys = (await managedKeys(ctx)).gitconfig.filter((key) => typeof expected[key] === "string");
    const actual = await readGitConfig(keys, ctx.gitScope);
    return keys
      .filter((key) => actual[key] !== expected[key])
      .map((key) => ({ command: "git", args: gitConfigSetArgs(key, expected[key] as string, ctx.gitScope), timeoutMs: COMMAND_TIMEOUT_MS }));
  };
  return {
    id: "dotfiles.git",
    section: "dotfiles",
    title: "git 전역 설정(관리 키)",
    rank,
    checks: byPrefix("dotfiles.git."),
    plan: async (ctx) => (await desired(ctx)).map(commandAction),
    apply: async (ctx, log, signal) => {
      for (const spec of await desired(ctx)) await runCommand(ctx, spec, log, signal);
    },
  };
}

// ───────────────────────────── 마켓플레이스·플러그인 ─────────────────────────────

function marketplaceSource(ctx: InstallContext, entry: MarketplaceEntry): string {
  if (entry.source.kind === "self") return ctx.selfSource === "directory" ? ctx.repoRoot : SELF_GITHUB_SOURCE;
  return entry.source.kind === "github" ? entry.source.repo : entry.source.url;
}

/**
 * 같은 이름의 마켓플레이스는 하나만 둘 수 있어, 소스가 다르면 지우고 다시 붙인다(AGENTS.md mod 규약).
 * 지울 때 그 마켓플레이스에서 온 플러그인이 내려갈 수 있다. 그 플러그인들은 지금 "정상"이라 사용자가 따로
 * 고르지 않았을 수 있으므로, 이 step이 다시 붙인 뒤 manifest의 플러그인 중 빠진 것을 바로 다시 설치한다.
 */
function marketplaceStep(entry: MarketplaceEntry, provider: "claude" | "codex", rank: number, pluginIds: readonly string[]): StepDef {
  const id = `plugins.marketplace.${entry.name}.${provider}`;
  const command = provider === "claude" ? "claude" : "codex";
  const ownPlugins = pluginIds.filter((pluginId) => pluginId.endsWith(`@${entry.name}`));
  const commands = (ctx: InstallContext, report: DoctorReport): CommandSpec[] => {
    const drift = byId(id)(report).some((check) => check.state === "drift");
    // 두 CLI의 하위 명령 이름이 같다(`plugin marketplace add|remove`).
    return [
      ...(drift ? [{ command, args: ["plugin", "marketplace", "remove", entry.name], timeoutMs: COMMAND_TIMEOUT_MS }] : []),
      { command, args: ["plugin", "marketplace", "add", marketplaceSource(ctx, entry)], timeoutMs: COMMAND_TIMEOUT_MS },
    ];
  };
  const missingPlugins = async (ctx: InstallContext): Promise<string[]> => {
    const fresh = await runDoctorWith(ctx);
    return ownPlugins.filter((pluginId) => byId(`plugins.${provider}.${pluginId}`)(fresh).some((check) => check.state !== "ok"));
  };
  const reinstall = (pluginId: string): CommandSpec =>
    provider === "claude"
      ? { command, args: ["plugin", "install", pluginId, "--scope", "user"], timeoutMs: COMMAND_TIMEOUT_MS }
      : { command, args: ["plugin", "add", pluginId], timeoutMs: COMMAND_TIMEOUT_MS };
  return {
    id,
    section: "plugins",
    title: `마켓플레이스 ${entry.name} (${provider === "claude" ? "Claude" : "Codex"})`,
    rank,
    checks: byId(id),
    plan: async (ctx, report) => {
      const specs = commands(ctx, report);
      const actions = specs.map(commandAction);
      if (specs.length > 1 && ownPlugins.length > 0) {
        actions.push({
          kind: "manual",
          summary: `다시 붙인 뒤 빠진 플러그인을 바로 다시 설치합니다: ${ownPlugins.join(", ")}`,
        });
      }
      return actions;
    },
    apply: async (ctx, log, signal, report) => {
      for (const spec of commands(ctx, report)) await runCommand(ctx, spec, log, signal);
      for (const pluginId of await missingPlugins(ctx)) await runCommand(ctx, reinstall(pluginId), log, signal);
    },
  };
}

function claudePluginStep(pluginId: string, rank: number): StepDef {
  const id = `plugins.claude.${pluginId}`;
  const spec = async (ctx: InstallContext): Promise<CommandSpec> => {
    const settings = await readJsonObject(path.join(ctx.claudeHome, "settings.json"));
    const disabled = isRecord(settings.enabledPlugins) && settings.enabledPlugins[pluginId] === false;
    return disabled
      ? { command: "claude", args: ["plugin", "enable", pluginId, "--scope", "user"], timeoutMs: COMMAND_TIMEOUT_MS }
      : { command: "claude", args: ["plugin", "install", pluginId, "--scope", "user"], timeoutMs: COMMAND_TIMEOUT_MS };
  };
  return {
    id,
    section: "plugins",
    title: `${pluginId} (Claude)`,
    rank,
    checks: byId(id),
    plan: async (ctx) => [commandAction(await spec(ctx))],
    apply: async (ctx, log, signal) => runCommand(ctx, await spec(ctx), log, signal),
  };
}

function codexPluginStep(pluginId: string, rank: number): StepDef {
  const id = `plugins.codex.${pluginId}`;
  const configPath = (ctx: InstallContext) => path.join(ctx.codexHome, "config.toml");
  const disabledTable = async (ctx: InstallContext): Promise<boolean> => {
    const text = await readText(configPath(ctx));
    if (!text) return false;
    const config = parseToml(text) as Record<string, unknown>;
    return isRecord(config.plugins) && isRecord(config.plugins[pluginId]);
  };
  const enableChange = async (ctx: InstallContext): Promise<FileChange> => {
    const before = await readText(configPath(ctx));
    return { absPath: configPath(ctx), before, after: patchTomlScalars(before ?? "", [{ path: ["plugins", pluginId, "enabled"], value: true }]) };
  };
  const addSpec: CommandSpec = { command: "codex", args: ["plugin", "add", pluginId], timeoutMs: COMMAND_TIMEOUT_MS };
  const asFile = fileStep({ id, section: "plugins", title: "", rank, checks: byId(id) }, enableChange);
  return {
    id,
    section: "plugins",
    title: `${pluginId} (Codex)`,
    rank,
    checks: byId(id),
    // 이미 설치돼 꺼져 있으면 config.toml의 enabled 줄만 고친다. 없으면 codex가 설치한다.
    plan: async (ctx, report) => ((await disabledTable(ctx)) ? asFile.plan(ctx, report) : [commandAction(addSpec)]),
    apply: async (ctx, log, signal, report) =>
      (await disabledTable(ctx)) ? asFile.apply(ctx, log, signal, report) : runCommand(ctx, addSpec, log, signal),
  };
}

// ───────────────────────────── MCP ─────────────────────────────

/** `${NAME}` 자리표시를 환경에서 채운다. 비어 있으면 실행하지 않는다 — 빈 키로 등록된 서버가 더 헷갈린다. */
function resolveEnv(entry: McpEntry, env: NodeJS.ProcessEnv): string[] {
  return Object.entries(entry.env ?? {}).map(([key, value]) => {
    const resolved = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name: string) => {
      const found = env[name];
      if (!found) throw new StepFailure(`환경변수 ${name}가 없어 ${entry.name}을(를) 등록하지 않았습니다`);
      return found;
    });
    return `${key}=${resolved}`;
  });
}

function mcpStep(entry: McpEntry, target: "claude" | "codex", rank: number): StepDef {
  const id = `mcp.${entry.name}.${target}`;
  const commands = (ctx: InstallContext, drift: boolean, withEnv: boolean): CommandSpec[] => {
    const command = expandHome(entry.command, ctx.home);
    const env = withEnv ? resolveEnv(entry, ctx.env) : Object.keys(entry.env ?? {}).map((key) => `${key}=***`);
    const timeoutMs = COMMAND_TIMEOUT_MS;
    if (target === "claude") {
      return [
        ...(drift ? [{ command: "claude", args: ["mcp", "remove", "--scope", "user", entry.name], timeoutMs }] : []),
        {
          command: "claude",
          args: ["mcp", "add", "--scope", "user", entry.name, ...env.flatMap((pair) => ["-e", pair]), "--", command, ...entry.args],
          timeoutMs,
        },
      ];
    }
    return [
      ...(drift ? [{ command: "codex", args: ["mcp", "remove", entry.name], timeoutMs }] : []),
      { command: "codex", args: ["mcp", "add", entry.name, ...env.flatMap((pair) => ["--env", pair]), "--", command, ...entry.args], timeoutMs },
    ];
  };
  const isDrift = (report: DoctorReport) => byId(id)(report).some((check) => check.state === "drift");
  return {
    id,
    section: "mcp",
    title: `${entry.name} (${target === "claude" ? "Claude" : "Codex"})`,
    rank,
    checks: byId(id),
    plan: async (ctx, report) => commands(ctx, isDrift(report), false).map(commandAction),
    apply: async (ctx, log, signal, report) => {
      for (const spec of commands(ctx, isDrift(report), true)) await runCommand(ctx, spec, log, signal);
    },
  };
}

// ───────────────────────────── 조립 ─────────────────────────────

function buildStepDefs(manifests: Manifests): StepDef[] {
  const defs: StepDef[] = [];
  for (const entry of manifests.packages) {
    if (entry.source === "winget" && entry.name === "CoreyButler.NVMforWindows") {
      defs.push(nodeRuntimeStep(entry));
      continue;
    }
    defs.push(
      commandStep(
        {
          id: `packages.${entry.source}.${entry.id}`,
          section: "toolchain",
          title: `${entry.id} 설치 (${entry.source})`,
          rank: 100 + PACKAGE_RANK[entry.source],
          checks: byId(`packages.${entry.source}.${entry.id}`),
        },
        packageCommand(entry),
      ),
    );
  }
  for (const tool of manifests.tools) {
    const section: DoctorSection = tool.id === "claude" ? "claude" : tool.id === "codex" ? "codex" : tool.id === "cua-driver" ? "cua" : "toolchain";
    defs.push(toolStep(tool, section, tool.id === "cua-driver" ? 900 : 200));
  }
  defs.push(fileStep({ id: "claude.claude-md", section: "claude", title: "전역 CLAUDE.md", rank: 300, checks: byId("claude.claude-md") }, claudeMdChange));
  defs.push(fileStep({ id: "codex.agents-md", section: "codex", title: "전역 AGENTS.md", rank: 301, checks: byId("codex.agents-md") }, agentsMdChange));
  defs.push(
    fileStep(
      { id: "dotfiles.powershell-profile", section: "dotfiles", title: "PowerShell 프로필", rank: 302, checks: byId("dotfiles.powershell-profile") },
      powershellProfileChange,
    ),
  );
  defs.push(gitconfigStep(303));
  defs.push(fileStep({ id: "claude.settings", section: "claude", title: "Claude 설정(관리 키)", rank: 400, checks: byPrefix("claude.settings.") }, claudeSettingsChange));
  defs.push(fileStep({ id: "codex.config", section: "codex", title: "Codex 설정(관리 키)", rank: 600, checks: byPrefix("codex.config.") }, codexConfigChange));
  for (const { entry } of manifests.marketplaces) {
    for (const provider of entry.providers) {
      const enabled = (provider === "claude" ? manifests.claudeEnabled : manifests.codexEnabled).map((item) => item.id);
      defs.push(marketplaceStep(entry, provider, provider === "claude" ? 410 : 610, enabled));
    }
  }
  for (const { id } of manifests.claudeEnabled) defs.push(claudePluginStep(id, 420));
  for (const { id } of manifests.codexEnabled) defs.push(codexPluginStep(id, 620));
  for (const { entry } of manifests.mcp) for (const target of entry.targets) defs.push(mcpStep(entry, target, 700));
  for (const { entry } of manifests.skills) {
    defs.push(
      commandStep(
        { id: `skills.external.${entry.id}`, section: "skills", title: `외부 스킬 ${entry.id}`, rank: 800, checks: byId(`skills.external.${entry.id}`) },
        { command: "npx", args: ["-y", "skills", "add", entry.source, "--skill", entry.id, "--global", "--yes"], timeoutMs: COMMAND_TIMEOUT_MS },
      ),
    );
  }
  // 같은 id가 공개 manifest와 로컬 오버레이에 함께 있으면 한 번만 돈다.
  const seen = new Set<string>();
  return defs
    .filter((def) => (seen.has(def.id) ? false : (seen.add(def.id), true)))
    .map((def, index) => ({ def, index }))
    .sort((a, b) => a.def.rank - b.def.rank || a.index - b.index)
    .map(({ def }) => def);
}

/**
 * step 한 줄 설명. 관리 키처럼 검사가 많은 step은 앞의 셋과 개수만 적는다 — 키마다 값을 늘어놓으면
 * 목록 화면에서 한 항목이 여러 줄을 차지한다. 자세한 비교는 미리보기의 diff가 보여 준다.
 */
export function stepDetail(checks: DoctorCheck[]): string {
  const off = checks.filter((check) => check.state !== "ok");
  if (off.length === 0) return "";
  if (checks.length === 1) return off[0]!.detail;
  if (off.length <= 3) return off.map((check) => `${check.title}: ${check.detail}`).join(" · ");
  const missing = off.filter((check) => check.state === "missing" || check.state === "error").length;
  const drift = off.filter((check) => check.state === "drift").length;
  const counts = [missing > 0 ? `없음 ${missing}` : "", drift > 0 ? `다름 ${drift}` : ""].filter(Boolean).join(" · ");
  return `${off.slice(0, 3).map((check) => check.title).join(", ")} 외 ${off.length - 3}개 (${counts})`;
}

async function describe(def: StepDef, report: DoctorReport, ctx: InstallContext): Promise<InstallStep> {
  const checks = def.checks(report);
  const state = worstState(checks);
  const detail = stepDetail(checks);
  let actions: InstallAction[] = [];
  if (needsWork(state)) {
    try {
      actions = await def.plan(ctx, report);
    } catch (error) {
      actions = [{ kind: "manual", summary: `계획하지 못했습니다: ${(error as Error).message}` }];
    }
  }
  const manual = Boolean(def.manual) || (actions.length > 0 && actions.every((action) => action.kind === "manual"));
  const actionable = needsWork(state) && !manual;
  return { id: def.id, section: def.section, title: def.title, state, detail: detail || (state === "ok" ? "정상" : ""), actionable, manual, actions };
}

export async function planInstallWith(ctx: InstallContext): Promise<InstallPlan> {
  const [report, manifests] = await Promise.all([runDoctorWith(ctx), loadManifests(ctx)]);
  const steps: InstallStep[] = [];
  for (const def of buildStepDefs(manifests)) {
    if (def.checks(report).length === 0) continue; // doctor가 보지 않는 항목(프로필 밖이 아닌데 검사 없음)은 다루지 않는다
    steps.push(await describe(def, report, ctx));
  }
  return { repoRoot: ctx.repoRoot, profile: ctx.profile, setupProfile: ctx.setupProfile, steps };
}

/**
 * 고른 step을 순서대로 돈다. step마다 직전에 doctor를 다시 돌려 이미 맞으면 건너뛴다(멱등). 하나가 실패해도
 * 다음 step은 계속한다 — 패키지 하나 때문에 설정 merge가 멈추면 안 된다. 취소하면 도는 명령을 끝내고 멈춘다.
 */
export async function runInstallWith(
  ctx: InstallContext,
  ids: readonly string[],
  onEvent: (event: InstallEvent) => void,
  signal: AbortSignal,
): Promise<InstallRunResult> {
  const journal = ctx.logDir ? await createInstallJournal(ctx.logDir, ctx.env) : null;
  try {
    const result = await executeInstallWith(ctx, ids, (event) => {
      if (event.type === "run-done" && journal) event.result.logFile = journal.filePath;
      journal?.record(event);
      onEvent(event);
    }, signal);
    return result;
  } catch (error) {
    journal?.record({ type: "error", message: (error as Error).message });
    throw error;
  } finally {
    await journal?.close();
  }
}

async function executeInstallWith(
  ctx: InstallContext,
  ids: readonly string[],
  onEvent: (event: InstallEvent) => void,
  signal: AbortSignal,
): Promise<InstallRunResult> {
  const notices = new Set<string>();
  const emit = onEvent;
  onEvent = (event) => {
    if (event.type === "log" && event.line.includes(TERMINAL_NOTICE)) notices.add(TERMINAL_NOTICE);
    emit(event);
  };
  if (await ctx.refreshEnvironment()) notices.add(TERMINAL_NOTICE);
  const manifests = await loadManifests(ctx);
  const defs = buildStepDefs(manifests).filter((def) => ids.includes(def.id));
  const unknown = ids.filter((id) => !defs.some((def) => def.id === id));
  if (unknown.length > 0) throw new Error(`모르는 step: ${unknown.join(", ")}`);
  onEvent({ type: "run-start", total: defs.length });
  const results: InstallStepResult[] = [];
  for (const [index, def] of defs.entries()) {
    if (signal.aborted) break;
    onEvent({ type: "step-start", id: def.id, index, title: def.title });
    const log: LogSink = (stream, line) => onEvent({ type: "log", id: def.id, stream, line });
    const beforeReport = await runDoctorWith(ctx);
    const before = worstState(def.checks(beforeReport));
    let result: InstallStepResult;
    if (def.manual) {
      result = { id: def.id, outcome: "manual", after: before, detail: def.manual };
    } else if (!needsWork(before)) {
      result = { id: def.id, outcome: "skipped", after: before, detail: "이미 맞습니다" };
    } else {
      try {
        await withLock(async () => {
          if (signal.aborted) throw new StepFailure("설치를 취소했습니다");
          await def.apply(ctx, log, signal, beforeReport);
        });
        const checks = def.checks(await runDoctorWith(ctx));
        const after = worstState(checks);
        result = needsWork(after)
          ? { id: def.id, outcome: "failed", after, detail: `실행 뒤에도 ${checks.map((check) => check.detail).join(" · ")}` }
          : { id: def.id, outcome: "done", after, detail: "완료" };
      } catch (error) {
        const after = worstState(def.checks(await runDoctorWith(ctx)));
        result = { id: def.id, outcome: "failed", after, detail: (error as Error).message };
        log("stderr", result.detail);
      }
    }
    results.push(result);
    onEvent({ type: "step-done", result });
  }
  const report = await runDoctorWith(ctx);
  const runResult: InstallRunResult = {
    results,
    verify: report.cards.map((card) => ({ section: card.section, state: card.state, summary: card.summary })),
    cancelled: signal.aborted,
    notices: [...notices],
  };
  onEvent({ type: "run-done", result: runResult });
  return runResult;
}

// ───────────────────────────── 실제 PC용 기본값 ─────────────────────────────

export async function defaultInstallContext(
  repoRoot: string,
  options: { profile?: Profile; selfSource?: "directory" | "github" } = {},
): Promise<InstallContext> {
  return {
    ...(await defaultDoctorContext(repoRoot, options.profile)),
    runner: processRunner,
    selfSource: options.selfSource ?? (await readAppSettings(APP_SETTINGS_FILE)).selfMarketplaceSource,
    logDir: path.join(APP_STATE_DIR, "logs", "install"),
  };
}
