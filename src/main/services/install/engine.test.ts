import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallEvent } from "@shared/install-types";
import { runDoctorWith } from "../doctor/doctor.js";
import { planInstallWith, runInstallWith, type InstallContext } from "./engine.js";
import type { CommandRunner, CommandSpec } from "./exec.js";
import { MARKDOWN_MARKERS, patchTomlScalars } from "./merge.js";
import type { NodeRuntimeState } from "../node-runtime.js";

let root: string;
let ctx: InstallContext;
let onPath: Record<string, string>;
let commands: string[];
let failing: RegExp | null;

function write(file: string, content: string | object): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
}

function readJson(file: string): Record<string, any> {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

function patchToml(file: string, entries: { path: string[]; value: string | boolean }[]): void {
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  write(file, patchTomlScalars(before, entries));
}

/**
 * 진짜 CLI 대신 명령의 효과를 파일에 그대로 남기는 가짜 실행기. 엔진이 "명령을 돌린 뒤 doctor로 다시 확인"하는
 * 흐름 전체를 실제 파일로 검증하려는 것이다(두 번째 실행은 전부 건너뛰어야 한다).
 */
const simulator: CommandRunner = {
  async run(spec: CommandSpec, log) {
    const line = [spec.command, ...spec.args].join(" ");
    commands.push(line);
    if (failing?.test(line)) {
      log("stderr", "simulated failure");
      return { code: 1, timedOut: false, notFound: false };
    }
    const [a0, a1, a2] = spec.args;
    const settingsPath = path.join(ctx.claudeHome, "settings.json");
    const knownPath = path.join(ctx.claudeHome, "plugins", "known_marketplaces.json");
    const configPath = path.join(ctx.codexHome, "config.toml");
    if (spec.command === "git") execFileSync("git", spec.args);
    else if (spec.command === "winget") onPath.git = "C:\\bin\\git.exe";
    else if (spec.command === "powershell.exe") onPath.claude = "C:\\bin\\claude.exe";
    else if (spec.command === "npm") onPath.codex = "C:\\bin\\codex.cmd";
    else if (spec.command === "npx") write(path.join(ctx.agentsSkillsDir, spec.args[spec.args.indexOf("--skill") + 1]!, "SKILL.md"), "x");
    else if (spec.command === "claude" && a0 === "plugin" && a1 === "marketplace") {
      const known = readJson(knownPath);
      if (a2 === "remove") {
        // 실제 CLI처럼 마켓플레이스를 지우면 거기서 온 플러그인도 내려간다고 가정한다(가장 나쁜 경우).
        delete known[spec.args[3]!];
        const settings = readJson(settingsPath);
        for (const pluginId of Object.keys(settings.enabledPlugins ?? {})) {
          if (pluginId.endsWith(`@${spec.args[3]}`)) delete settings.enabledPlugins[pluginId];
        }
        write(settingsPath, settings);
      } else known.jinmin = { source: { source: "directory", path: spec.args[3] } };
      write(knownPath, known);
    } else if (spec.command === "claude" && a0 === "plugin") {
      const settings = readJson(settingsPath);
      settings.enabledPlugins = { ...settings.enabledPlugins, [a2!]: true };
      write(settingsPath, settings);
    } else if (spec.command === "claude" && a0 === "mcp" && a1 === "add") {
      const json = readJson(ctx.claudeJson);
      const dash = spec.args.indexOf("--");
      json.mcpServers = { ...json.mcpServers, [spec.args[4]!]: { command: spec.args[dash + 1], args: spec.args.slice(dash + 2) } };
      write(ctx.claudeJson, json);
    } else if (spec.command === "codex" && a0 === "plugin" && a1 === "marketplace") {
      patchToml(configPath, [
        { path: ["marketplaces", "jinmin", "source_type"], value: "local" },
        { path: ["marketplaces", "jinmin", "source"], value: spec.args[3]! },
      ]);
    } else if (spec.command === "codex" && a0 === "plugin") {
      patchToml(configPath, [{ path: ["plugins", a2!, "enabled"], value: true }]);
    } else if (spec.command === "codex" && a0 === "mcp") {
      const dash = spec.args.indexOf("--");
      patchToml(configPath, [{ path: ["mcp_servers", spec.args[2]!, "command"], value: spec.args[dash + 1]! }]);
    }
    log("stdout", `ok: ${line}`);
    return { code: 0, timedOut: false, notFound: false };
  },
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-install-"));
  const home = path.join(root, "home");
  const repo = path.join(root, "repo");
  onPath = {};
  commands = [];
  failing = null;
  ctx = {
    repoRoot: repo,
    home,
    claudeHome: path.join(home, ".claude"),
    claudeJson: path.join(home, ".claude.json"),
    codexHome: path.join(home, ".codex"),
    agentsSkillsDir: path.join(home, ".agents", "skills"),
    profileDir: path.join(home, ".harness-manager", "profile"),
    profile: "dev",
    documentsDir: path.join(home, "Documents"),
    gitScope: { file: path.join(home, ".gitconfig") },
    findExecutable: async (command) => onPath[command] ?? null,
    readVersion: async () => "1.2.3",
    inspectNodeRuntime: async () => ({ state: "ready", detail: "existing Node", candidates: [], registrations: [], versions: [] } as unknown as NodeRuntimeState),
    refreshEnvironment: async () => false,
    now: () => new Date("2026-10-26T00:00:00.000Z"),
    runner: simulator,
    selfSource: "directory",
    env: { API_KEY: "s3cr3t" },
  };
  write(path.join(repo, "manifest", "packages.json"), {
    schemaVersion: 1,
    packages: [{ id: "git", source: "winget", name: "Git.Git", profiles: ["dev"], bin: "git" }],
  });
  write(path.join(repo, "manifest", "tools.json"), {
    schemaVersion: 1,
    tools: [
      { id: "claude", name: "Claude Code", profiles: ["dev"], install: { kind: "powershell-script", ref: "https://claude.ai/install.ps1" }, verify: { command: "claude", args: ["--version"] } },
      { id: "codex", name: "Codex CLI", profiles: ["dev"], install: { kind: "npm", ref: "@openai/codex" }, verify: { command: "codex", args: ["--version"] } },
      { id: "cua-driver", name: "cua-driver", profiles: ["dev"], install: { kind: "manual", ref: "공식 설치 명령 확인 필요" }, verify: { command: "cua-driver", args: ["doctor"] } },
    ],
  });
  write(path.join(repo, "manifest", "plugins.json"), {
    schemaVersion: 1,
    marketplaces: [{ name: "jinmin", source: { kind: "self" }, providers: ["claude", "codex"] }],
    claude: { enabled: ["jinmin-skills@jinmin"] },
    codex: { enabled: ["jinmin-skills@jinmin"] },
  });
  write(path.join(repo, "manifest", "mcp.json"), {
    schemaVersion: 1,
    servers: [
      { name: "tool", command: "~/.tool/tool.exe", args: ["mcp"], env: { API_KEY: "${API_KEY}" }, targets: ["claude", "codex"], profiles: ["dev"] },
    ],
  });
  write(path.join(repo, "manifest", "skills.json"), { schemaVersion: 1, external: [{ id: "find-skills", source: "vercel-labs/skills", profiles: ["dev"] }] });
  write(path.join(repo, "home", "managed-keys.json"), { schemaVersion: 1, claudeSettings: ["model", "permissions.allow"], codexConfig: ["model", "windows.sandbox"] });
  write(path.join(repo, "home", "claude", "settings.managed.json"), { model: "opus", permissions: { allow: ["Bash(ls:*)"] } });
  write(path.join(repo, "home", "claude", "CLAUDE.md"), "@~/.codex/AGENTS.md\n");
  write(path.join(repo, "home", "codex", "config.managed.toml"), 'model = "gpt-x"\n\n[windows]\nsandbox = "elevated"\n');
  write(path.join(repo, "home", "agents", "AGENTS.md"), "## 규약\n\n- 공개 규칙\n");
  write(path.join(ctx.profileDir, "AGENTS.local.md"), "# 개인\n\n- 비밀\n");
  write(path.join(ctx.profileDir, "claude-settings.local.json"), { permissions: { allow: ["Bash(local:*)"] } });
  // 이미 쓰던 PC: 사용자 설정·주석이 있고, jinmin은 다른 폴더를 가리킨다.
  write(path.join(ctx.claudeHome, "settings.json"), { model: "sonnet", theme: "dark", permissions: { allow: ["Bash(mine:*)"] } });
  write(path.join(ctx.claudeHome, "plugins", "known_marketplaces.json"), { jinmin: { source: { source: "directory", path: path.join(root, "old-mods") } } });
  write(path.join(ctx.codexHome, "config.toml"), '# 내 주석\nmodel = "old"\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const ALL = [
  "packages.winget.git",
  "tools.claude",
  "tools.codex",
  "claude.claude-md",
  "codex.agents-md",
  "claude.settings",
  "plugins.marketplace.jinmin.claude",
  "plugins.claude.jinmin-skills@jinmin",
  "codex.config",
  "plugins.marketplace.jinmin.codex",
  "plugins.codex.jinmin-skills@jinmin",
  "mcp.tool.claude",
  "mcp.tool.codex",
  "skills.external.find-skills",
];

describe("install 엔진", () => {
  const nodeState = (state: NodeRuntimeState["state"]): NodeRuntimeState => ({
    state, detail: `runtime ${state}`, node: null, nodeVersion: null, npmVersion: null,
    nvm: null, nvmRoot: null, nvmLink: null, candidates: [], registrations: [], versions: [], environment: {}, pathChanged: false,
  });
  const includeNode = () => write(path.join(ctx.repoRoot, "manifest", "packages.json"), {
    schemaVersion: 1,
    packages: [{ id: "nvm", source: "winget", name: "CoreyButler.NVMforWindows", profiles: ["dev"], bin: "node" }],
  });

  it("preserves an existing MSI Node even when the NVM step is explicitly requested", async () => {
    includeNode();
    ctx.inspectNodeRuntime = vi.fn(async () => nodeState("ready"));
    expect((await planInstallWith(ctx)).steps.find((step) => step.id === "packages.winget.nvm")).toMatchObject({ state: "ok", actionable: false });
    const result = await runInstallWith(ctx, ["packages.winget.nvm"], () => undefined, new AbortController().signal);
    expect(result.results[0]?.outcome).toBe("skipped");
    expect(commands).toEqual([]);
  });

  it("blocks broken/mixed Node in both the preview and direct step execution", async () => {
    includeNode();
    ctx.inspectNodeRuntime = vi.fn(async () => nodeState("blocked"));
    expect((await planInstallWith(ctx)).steps.find((step) => step.id === "packages.winget.nvm")).toMatchObject({ manual: true, actionable: false });
    const result = await runInstallWith(ctx, ["packages.winget.nvm", "tools.codex"], () => undefined, new AbortController().signal);
    expect(result.results.map((item) => item.outcome)).toEqual(["failed", "failed"]);
    expect(commands).toEqual([]);
  });

  it("stops a new NVM install if protection cannot read the registry or its script", async () => {
    includeNode();
    ctx.inspectNodeRuntime = vi.fn(async () => { throw new Error("inspection unavailable"); });
    expect((await planInstallWith(ctx)).steps.find((step) => step.id === "packages.winget.nvm")).toMatchObject({ manual: true, actionable: false });
    const result = await runInstallWith(ctx, ["packages.winget.nvm"], () => undefined, new AbortController().signal);
    expect(result.results[0]?.outcome).toBe("failed");
    expect(commands).toEqual([]);
  });

  it("verifies runtime setup before allowing npm and is idempotent", async () => {
    includeNode();
    let state = nodeState("fresh");
    ctx.inspectNodeRuntime = async () => state;
    const specs: CommandSpec[] = [];
    ctx.refreshEnvironment = async () => { ctx.env.Path = "C:\\new-node"; return true; };
    ctx.runner = { run: async (spec, log, signal) => {
      specs.push(spec);
      if (spec.args.includes("-Install")) {
        state = nodeState("ready");
        return { code: 0, timedOut: false, notFound: false };
      }
      return simulator.run(spec, log, signal);
    } };
    const result = await runInstallWith(ctx, ["tools.codex", "packages.winget.nvm"], () => undefined, new AbortController().signal);
    expect(specs.map((spec) => spec.command)).toEqual(["powershell.exe", "npm"]);
    expect(specs[0]?.args).toContain(path.join(ctx.repoRoot, "scripts", "node-runtime.ps1"));
    expect(specs[1]?.env?.Path).toBe("C:\\new-node");
    expect(result.results.every((item) => item.outcome === "done")).toBe(true);
    expect(result.notices).toHaveLength(1);
    await runInstallWith(ctx, ["packages.winget.nvm", "tools.codex"], () => undefined, new AbortController().signal);
    expect(specs).toHaveLength(2);
  });

  it("blocks npm if the runtime installer exits zero but Node is still unusable", async () => {
    includeNode();
    ctx.inspectNodeRuntime = async () => nodeState("fresh");
    const run = vi.fn(async () => ({ code: 0, timedOut: false, notFound: false }));
    ctx.runner = { run };
    const result = await runInstallWith(ctx, ["packages.winget.nvm", "tools.codex"], () => undefined, new AbortController().signal);
    expect(result.results.every((item) => item.outcome === "failed")).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("persists timestamped results and masks secrets in logs", async () => {
    ctx.logDir = path.join(root, "logs");
    const result = await runInstallWith(ctx, ["tools.codex"], () => undefined, new AbortController().signal);
    expect(result.logFile).toBeTruthy();
    const rows = fs.readFileSync(result.logFile!, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(rows.at(-1).event.type).toBe("run-done");
    expect(rows.every((row) => typeof row.time === "string")).toBe(true);
  });

  it("계획: 정상이 아닌 항목마다 step을 실행 순서대로 만들고 명령·파일 diff를 보인다", async () => {
    const plan = await planInstallWith(ctx);
    expect(plan.steps.filter((step) => step.actionable).map((step) => step.id)).toEqual(ALL);
    const byId = Object.fromEntries(plan.steps.map((step) => [step.id, step]));
    expect(byId["tools.cua-driver"]).toMatchObject({ manual: true, actionable: false });
    expect(byId["plugins.marketplace.jinmin.claude"]!.actions.map((action) => action.summary)).toEqual([
      "claude plugin marketplace remove jinmin",
      `claude plugin marketplace add ${ctx.repoRoot}`,
      "다시 붙인 뒤 빠진 플러그인을 바로 다시 설치합니다: jinmin-skills@jinmin",
    ]);
    // 비밀 env 값은 미리보기에 나오지 않는다.
    expect(JSON.stringify(plan)).not.toContain("s3cr3t");
    expect(byId["claude.settings"]!.actions[0]!.diff).toContain('+  "model": "opus"');
    // install은 이 PC → 레포 방향이다. 머리글도 그 방향이어야 -/+ 줄을 바로 읽는다.
    expect(byId["claude.settings"]!.actions[0]!.diff).toMatch(/^--- .*\t이 PC\n\+\+\+ .*\t레포$/m);
  });

  it("전부 실행하면 모두 완료되고 doctor 카드가 정상이 되며, 두 번째 실행은 전부 건너뛴다", async () => {
    const events: InstallEvent[] = [];
    const first = await runInstallWith(ctx, ALL, (event) => events.push(event), new AbortController().signal);
    // 마켓플레이스 step이 붙인 뒤 빠진 플러그인을 바로 설치하므로, 뒤의 플러그인 step은 할 일이 없다.
    const alreadyDone = new Set(["plugins.claude.jinmin-skills@jinmin", "plugins.codex.jinmin-skills@jinmin"]);
    expect(first.results.map((result) => [result.id, result.outcome])).toEqual(ALL.map((id) => [id, alreadyDone.has(id) ? "skipped" : "done"]));
    // cua-driver는 설치 명령이 정해지지 않은 manual step이라 여전히 빨강이다.
    expect(first.verify.filter((card) => card.state === "fail" || card.state === "warn").map((card) => card.section)).toEqual(["cua"]);

    // 사용자 설정과 주석은 그대로 남는다.
    const settings = readJson(path.join(ctx.claudeHome, "settings.json"));
    expect(settings).toMatchObject({ model: "opus", theme: "dark", permissions: { allow: ["Bash(mine:*)", "Bash(ls:*)", "Bash(local:*)"] } });
    expect(fs.readFileSync(path.join(ctx.codexHome, "config.toml"), "utf8")).toMatch(/^# 내 주석\nmodel = "gpt-x"\n/);
    const agents = fs.readFileSync(path.join(ctx.codexHome, "AGENTS.md"), "utf8");
    expect(agents).toContain("# 개인");
    expect(agents).toContain(MARKDOWN_MARKERS.start);
    // env 값은 명령에는 들어가지만 로그에는 가려진다.
    expect(commands.some((line) => line.includes("API_KEY=s3cr3t"))).toBe(true);
    expect(events.filter((event) => event.type === "log").some((event) => "line" in event && event.line.includes("s3cr3t"))).toBe(false);

    commands = [];
    const plan = await planInstallWith(ctx);
    expect(plan.steps.filter((step) => step.actionable)).toEqual([]);
    const second = await runInstallWith(ctx, ALL, () => undefined, new AbortController().signal);
    expect(second.results.every((result) => result.outcome === "skipped")).toBe(true);
    expect(commands).toEqual([]);
  });

  it("한 step이 실패해도 다음 step은 계속하고, 실패는 결과에 남는다", async () => {
    failing = /^winget/;
    const result = await runInstallWith(ctx, ["packages.winget.git", "claude.settings"], () => undefined, new AbortController().signal);
    expect(result.results).toEqual([
      expect.objectContaining({ id: "packages.winget.git", outcome: "failed", after: "missing", detail: "종료 코드 1" }),
      expect.objectContaining({ id: "claude.settings", outcome: "done" }),
    ]);
  });

  it("MCP env 자리표시를 채울 값이 없으면 명령을 돌리지 않고 실패한다", async () => {
    ctx.env = {};
    const result = await runInstallWith(ctx, ["mcp.tool.claude"], () => undefined, new AbortController().signal);
    expect(result.results[0]).toMatchObject({ outcome: "failed", detail: "환경변수 API_KEY가 없어 tool을(를) 등록하지 않았습니다" });
    expect(commands).toEqual([]);
  });

  it("직접 해야 하는 step은 manual로 남고, 모르는 id는 거절한다", async () => {
    const result = await runInstallWith(ctx, ["tools.cua-driver"], () => undefined, new AbortController().signal);
    expect(result.results[0]).toMatchObject({ outcome: "manual" });
    await expect(runInstallWith(ctx, ["nope"], () => undefined, new AbortController().signal)).rejects.toThrow("모르는 step");
  });

  it("취소하면 남은 step을 돌리지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runInstallWith(ctx, ALL, () => undefined, controller.signal);
    expect(result).toMatchObject({ cancelled: true, results: [] });
    expect(commands).toEqual([]);
  });

  it("마켓플레이스를 다시 붙이면 거기서 내려간 플러그인을 같은 step에서 다시 설치한다", async () => {
    const pluginsPath = path.join(ctx.repoRoot, "manifest", "plugins.json");
    const manifest = readJson(pluginsPath);
    manifest.claude.enabled = ["hud@jinmin", "jinmin-skills@jinmin"];
    write(pluginsPath, manifest);
    const settingsPath = path.join(ctx.claudeHome, "settings.json");
    write(settingsPath, { ...readJson(settingsPath), enabledPlugins: { "hud@jinmin": true } });

    const result = await runInstallWith(ctx, ["plugins.marketplace.jinmin.claude"], () => undefined, new AbortController().signal);
    expect(result.results[0]).toMatchObject({ outcome: "done" });
    expect(commands).toEqual([
      "claude plugin marketplace remove jinmin",
      `claude plugin marketplace add ${ctx.repoRoot}`,
      "claude plugin install hud@jinmin --scope user",
      "claude plugin install jinmin-skills@jinmin --scope user",
    ]);
    expect(readJson(settingsPath).enabledPlugins).toEqual({ "hud@jinmin": true, "jinmin-skills@jinmin": true });
  });

  it("새 PC: AGENTS.md가 없으면 로컬 개인 부분과 공개 블록으로 만든다", async () => {
    await runInstallWith(ctx, ["codex.agents-md"], () => undefined, new AbortController().signal);
    expect(fs.readFileSync(path.join(ctx.codexHome, "AGENTS.md"), "utf8")).toBe(
      `# 개인\n\n- 비밀\n\n${MARKDOWN_MARKERS.start}\n## 규약\n\n- 공개 규칙\n${MARKDOWN_MARKERS.end}\n`,
    );
    const report = await runDoctorWith(ctx);
    expect(report.cards.find((card) => card.section === "codex")!.checks.find((check) => check.id === "codex.agents-md")!.state).toBe("ok");
  });
});

describe("stepDetail", () => {
  const check = (title: string, state: "ok" | "missing" | "drift") => ({ id: title, title, state, detail: `${title} 상세` });
  it("검사가 많으면 앞의 셋과 개수만 적는다", async () => {
    const { stepDetail } = await import("./engine.js");
    expect(stepDetail([check("a", "ok")])).toBe("");
    expect(stepDetail([check("a", "missing")])).toBe("a 상세");
    expect(stepDetail([check("a", "missing"), check("b", "ok"), check("c", "drift")])).toBe("a: a 상세 · c: c 상세");
    expect(stepDetail(["a", "b", "c", "d", "e"].map((title, index) => check(title, index < 4 ? "missing" : "drift")))).toBe(
      "a, b, c 외 2개 (없음 4 · 다름 1)",
    );
  });
});

describe("dotfiles install", () => {
  beforeEach(() => {
    write(path.join(ctx.repoRoot, "home", "managed-keys.json"), {
      schemaVersion: 1,
      claudeSettings: [],
      codexConfig: [],
      gitconfig: ["user.name", "user.email", "core.autocrlf"],
    });
    write(path.join(ctx.repoRoot, "home", "git", "gitconfig.json"), { "user.name": "Tester", "core.autocrlf": "true" });
    write(path.join(ctx.profileDir, "gitconfig.local.json"), { "user.email": "tester@example.com" });
    write(path.join(ctx.repoRoot, "home", "powershell", "profile.ps1"), "Set-Alias g git\n");
  });

  it("git 관리 키를 git config로 맞추고, PowerShell 프로필에 BOM과 마커 블록으로 쓰며, 다시 돌리면 건너뛴다", async () => {
    const profile = path.join(ctx.documentsDir, "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1");
    write(profile, "$keep = 1\n");
    const ids = ["dotfiles.powershell-profile", "dotfiles.git"];
    const plan = await planInstallWith(ctx);
    expect(plan.steps.filter((step) => step.actionable && step.section === "dotfiles").map((step) => step.id)).toEqual(ids);

    const first = await runInstallWith(ctx, ids, () => undefined, new AbortController().signal);
    expect(first.results.map((result) => result.outcome)).toEqual(["done", "done"]);
    const written = fs.readFileSync(profile, "utf8");
    expect(written.charCodeAt(0)).toBe(0xfeff);
    expect(written.slice(1)).toBe("$keep = 1\n\n# >>> harness-manager >>>\nSet-Alias g git\n# <<< harness-manager <<<\n");
    const get = (key: string) => execFileSync("git", ["config", "--file", ctx.gitScope.file!, "--get", key], { encoding: "utf8" }).trim();
    expect([get("user.name"), get("user.email"), get("core.autocrlf")]).toEqual(["Tester", "tester@example.com", "true"]);

    const second = await runInstallWith(ctx, ids, () => undefined, new AbortController().signal);
    expect(second.results.map((result) => result.outcome)).toEqual(["skipped", "skipped"]);
  });
});
