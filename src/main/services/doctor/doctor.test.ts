import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DoctorCheck, DoctorReport, DoctorSection } from "@shared/doctor-types";
import { cardState, runDoctorWith, type DoctorContext } from "./doctor.js";

let root: string;
let ctx: DoctorContext;
let onPath: Record<string, string>;

function write(file: string, content: string | object): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-doctor-"));
  const home = path.join(root, "home");
  const repo = path.join(root, "repo");
  onPath = { git: "C:\\bin\\git.exe", claude: "C:\\bin\\claude.exe" };
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
    now: () => new Date("2026-10-26T00:00:00.000Z"),
  };

  write(path.join(repo, "manifest", "packages.json"), {
    schemaVersion: 1,
    packages: [
      { id: "git", source: "winget", name: "Git.Git", profiles: ["core", "dev"], bin: "git" },
      { id: "fd", source: "scoop", name: "fd", profiles: ["dev"], bin: "fd" },
      { id: "task", source: "scoop", name: "task", profiles: ["full"], bin: "task" },
    ],
  });
  write(path.join(repo, "manifest", "tools.json"), {
    schemaVersion: 1,
    tools: [
      { id: "claude", name: "Claude Code", profiles: ["core"], install: { kind: "manual", ref: "x" }, verify: { command: "claude", args: ["--version"] } },
      { id: "codex", name: "Codex CLI", profiles: ["core"], install: { kind: "npm", ref: "@openai/codex" }, verify: { command: "codex", args: ["--version"] } },
    ],
  });
  write(path.join(repo, "manifest", "plugins.json"), {
    schemaVersion: 1,
    marketplaces: [{ name: "jinmin", source: { kind: "self" }, providers: ["claude", "codex"] }],
    claude: { enabled: ["codex-watch@jinmin", "jinmin-skills@jinmin"] },
    codex: { enabled: ["jinmin-skills@jinmin"] },
  });
  write(path.join(repo, "manifest", "mcp.json"), {
    schemaVersion: 1,
    servers: [
      { name: "tool", command: "~/.tool/tool.exe", args: [], targets: ["claude", "codex"], profiles: ["dev"] },
      { name: "heavy", command: "heavy", args: [], targets: ["claude"], profiles: ["full"] },
    ],
  });
  write(path.join(repo, "manifest", "skills.json"), {
    schemaVersion: 1,
    external: [{ id: "find-skills", source: "vercel-labs/skills", profiles: ["dev"] }],
  });
  write(path.join(repo, "home", "managed-keys.json"), { schemaVersion: 1, claudeSettings: ["model", "permissions.allow"], codexConfig: ["model"] });
  write(path.join(repo, "home", "claude", "settings.managed.json"), { model: "opus", permissions: { allow: ["Bash(ls:*)"] } });
  write(path.join(repo, "home", "claude", "CLAUDE.md"), "@~/.codex/AGENTS.md\n");
  write(path.join(repo, "home", "codex", "config.managed.toml"), 'model = "gpt-x"\n');
  write(path.join(repo, "home", "agents", "AGENTS.md"), "## 규약\n\n- 공개 규칙\n");
  write(path.join(repo, "plugins", "jinmin-skills", "skills", "agents-md-sync", "SKILL.md"), "x");

  write(path.join(ctx.claudeHome, "CLAUDE.md"), `@${home.replace(/\\/g, "/")}/.codex/AGENTS.md\n`);
  write(path.join(ctx.claudeHome, "settings.json"), {
    model: "sonnet",
    permissions: { allow: ["Bash(ls:*)", "Bash(extra:*)"] },
    enabledPlugins: { "codex-watch@jinmin": true, "jinmin-skills@jinmin": false },
  });
  write(path.join(ctx.profileDir, "claude-settings.local.json"), { permissions: { allow: ["Bash(local:*)"] } });
  write(path.join(ctx.claudeHome, "plugins", "known_marketplaces.json"), {
    jinmin: { source: { source: "directory", path: path.join(root, "jinmin-mods") } },
  });
  write(
    path.join(ctx.codexHome, "config.toml"),
    ['model = "gpt-x"', "", "[mcp_servers.tool]", 'command = "other.exe"', ""].join("\n"),
  );
  write(path.join(ctx.codexHome, "AGENTS.md"), "# 개인\n\n- 비밀\n\n## 규약\n\n- 공개 규칙\n");
  write(ctx.claudeJson, { mcpServers: { tool: { command: path.join(home, ".tool", "tool.exe"), args: [] } } });
  write(path.join(ctx.claudeHome, "plugins", "cache", "claude-hud", "x.txt"), "x");
  write(path.join(ctx.claudeHome, "skills", "agents-md-sync", "SKILL.md"), "old copy");
  // 대상이 지워진 디렉터리 링크. junction은 관리자 권한 없이도 Windows에서 만들 수 있다.
  const target = path.join(root, "gone-skill");
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(ctx.claudeHome, "skills", "broken"), "junction");
  fs.rmSync(target, { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function checksOf(report: DoctorReport, section: DoctorSection): Record<string, DoctorCheck> {
  const card = report.cards.find((entry) => entry.section === section)!;
  return Object.fromEntries(card.checks.map((check) => [check.id, check]));
}

describe("doctor", () => {
  it("카드 8개를 섹션 순서대로 만든다", async () => {
    const report = await runDoctorWith(ctx);
    expect(report.cards.map((card) => card.section)).toEqual(["toolchain", "claude", "codex", "plugins", "skills", "mcp", "cua", "dotfiles"]);
    expect(report.cards.find((card) => card.section === "dotfiles")!.state).toBe("info");
  });

  it("툴체인: 프로필 안의 패키지만 세고 PATH로 설치를 확인한다", async () => {
    const report = await runDoctorWith(ctx);
    const checks = checksOf(report, "toolchain");
    expect(checks["packages.winget.git"]!.state).toBe("ok");
    expect(checks["packages.scoop.fd"]!.state).toBe("missing");
    expect(checks["packages.scoop.task"]!.state).toBe("skipped");
    const card = report.cards.find((entry) => entry.section === "toolchain")!;
    expect(card).toMatchObject({ state: "fail", summary: "패키지 1/2 정상 · 1개 없음" });
  });

  it("Claude: 도구 버전, CLAUDE.md, 관리 키 값과 배열(템플릿+로컬 오버레이)을 비교한다", async () => {
    const checks = checksOf(await runDoctorWith(ctx), "claude");
    expect(checks["tools.claude"]).toMatchObject({ state: "ok", detail: "1.2.3 · C:\\bin\\claude.exe" });
    expect(checks["claude.claude-md"]!.state).toBe("ok");
    expect(checks["claude.settings.model"]).toMatchObject({ state: "drift", detail: '이 PC sonnet · 레포 opus' });
    expect(checks["claude.settings.permissions.allow"]).toMatchObject({ state: "drift", detail: "빠진 항목: Bash(local:*)" });
  });

  it("Codex: 도구가 없으면 누락, AGENTS.md 공개 섹션과 config 관리 키가 같으면 정상", async () => {
    const checks = checksOf(await runDoctorWith(ctx), "codex");
    expect(checks["tools.codex"]!.state).toBe("missing");
    expect(checks["codex.agents-md"]!.state).toBe("ok");
    expect(checks["codex.config.model"]!.state).toBe("ok");
  });

  it("플러그인: self 마켓플레이스의 소스, provider별 등록·활성, mod 의존성, claude-hud 잔여를 본다", async () => {
    const checks = checksOf(await runDoctorWith(ctx), "plugins");
    expect(checks["plugins.marketplace.jinmin.claude"]).toMatchObject({ state: "drift" });
    expect(checks["plugins.marketplace.jinmin.claude"]!.detail).toContain("jinmin-mods");
    expect(checks["plugins.marketplace.jinmin.codex"]!.state).toBe("missing");
    expect(checks["plugins.claude.codex-watch@jinmin"]!.state).toBe("ok");
    expect(checks["plugins.claude.jinmin-skills@jinmin"]).toMatchObject({ state: "missing", detail: "설치됐지만 꺼져 있음" });
    expect(checks["plugins.codex.jinmin-skills@jinmin"]!.state).toBe("missing");
    expect(checks["plugins.dep.codex-watch"]!.state).toBe("drift");
    expect(checks["plugins.leftover.cache"]!.state).toBe("drift");
  });

  it("레포 폴더를 가리키는 self 마켓플레이스는 정상이다", async () => {
    write(path.join(ctx.claudeHome, "plugins", "known_marketplaces.json"), {
      jinmin: { source: { source: "directory", path: `${ctx.repoRoot}${path.sep}` } },
    });
    const checks = checksOf(await runDoctorWith(ctx), "plugins");
    expect(checks["plugins.marketplace.jinmin.claude"]!.state).toBe("ok");
  });

  it("스킬: 외부 스킬 설치, 깨진 링크, 플러그인으로 옮겨진 스킬의 낡은 사본을 잡는다", async () => {
    // 플러그인이 꺼져 있으면 loose 사본이 아직 유일한 사본이라 중복이 아니다.
    expect(Object.values(checksOf(await runDoctorWith(ctx), "skills")).some((check) => check.title.startsWith("중복"))).toBe(false);
    const settingsPath = path.join(ctx.claudeHome, "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    write(settingsPath, { ...settings, enabledPlugins: { ...settings.enabledPlugins, "jinmin-skills@jinmin": true } });
    const checks = Object.values(checksOf(await runDoctorWith(ctx), "skills"));
    expect(checks.find((check) => check.id === "skills.external.find-skills")!.state).toBe("missing");
    expect(checks.find((check) => check.title === "깨진 링크 broken")!.state).toBe("drift");
    expect(checks.find((check) => check.title === "중복 스킬 agents-md-sync")!.state).toBe("drift");
  });

  it("MCP: 홈 경로를 펼쳐 명령을 비교하고, 프로필 밖 서버는 세지 않는다", async () => {
    const checks = checksOf(await runDoctorWith(ctx), "mcp");
    expect(checks["mcp.tool.claude"]!.state).toBe("ok");
    expect(checks["mcp.tool.codex"]!.state).toBe("drift");
    expect(checks["mcp.heavy.claude"]!.state).toBe("skipped");
  });

  it("로컬 오버레이 항목도 검사하고 local로 표시한다", async () => {
    write(path.join(ctx.profileDir, "manifest.local.json"), {
      plugins: { schemaVersion: 1, marketplaces: [], claude: { enabled: ["secret@corp"] }, codex: { enabled: [] } },
    });
    const checks = checksOf(await runDoctorWith(ctx), "plugins");
    expect(checks["plugins.claude.secret@corp"]).toMatchObject({ state: "missing", local: true });
  });

  it("카드 상태: 없음·실패는 빨강, 다름은 노랑, 정상만 있으면 초록, 정보뿐이면 회색", () => {
    const check = (state: DoctorCheck["state"]): DoctorCheck => ({ id: state, title: state, state, detail: "" });
    expect(cardState([check("ok"), check("drift"), check("missing")])).toBe("fail");
    expect(cardState([check("ok"), check("drift")])).toBe("warn");
    expect(cardState([check("ok"), check("info"), check("skipped")])).toBe("ok");
    expect(cardState([check("info")])).toBe("info");
  });
});
