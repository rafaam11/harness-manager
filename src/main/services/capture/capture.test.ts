import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CaptureItem, CaptureTargetId } from "@shared/manifest-types";
import { applyCaptureWith, isHarnessRepo, planCaptureWith } from "./capture.js";
import { scanExposure, tildify } from "./exposure.js";
import { splitMarkdownSections } from "./text.js";
import type { CaptureContext } from "./targets.js";

let root: string;
let ctx: CaptureContext;

function write(file: string, content: string | object): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
}

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/** 홈 경로에 일부러 한글을 넣는다 — tildify·노출 검사가 사용자 이름과 상관없이 맞아야 한다. */
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-capture-"));
  const home = path.join(root, "홍길동");
  const repo = path.join(root, "repo");
  ctx = {
    repoRoot: repo,
    home,
    claudeHome: path.join(home, ".claude"),
    claudeJson: path.join(home, ".claude.json"),
    codexHome: path.join(home, ".codex"),
    skillLock: path.join(home, ".agents", ".skill-lock.json"),
    profileDir: path.join(home, ".harness-manager", "profile"),
    privateTerms: ["acme"],
  };
  write(path.join(repo, "package.json"), { name: "harness-manager" });
  write(path.join(repo, ".claude-plugin", "marketplace.json"), { name: "jinmin", plugins: [] });
  write(path.join(repo, "home", "managed-keys.json"), {
    schemaVersion: 1,
    claudeSettings: ["model", "theme", "permissions.allow", "permissions.defaultMode"],
    codexConfig: ["model", "windows.sandbox"],
  });
  write(path.join(repo, "home", "agents", "AGENTS.md"), "## 문서 규약\n\n## 세션 인계\n");
  write(path.join(repo, "home", "claude", "settings.managed.json"), { model: "sonnet", theme: "light" });
  write(path.join(repo, "manifest", "plugins.json"), {
    schemaVersion: 1,
    marketplaces: [{ name: "old-market", source: { kind: "github", repo: "o/old" }, providers: ["claude"] }],
    claude: { enabled: ["kept@old-market"] },
    codex: { enabled: [] },
  });
  write(path.join(repo, "manifest", "mcp.json"), { schemaVersion: 1, servers: [] });
  write(path.join(repo, "manifest", "skills.json"), { schemaVersion: 1, external: [] });

  write(
    path.join(ctx.codexHome, "AGENTS.md"),
    "# 사용자 배경\n\n- 개인 이야기\n\n## 문서 규약\n\n- 공개 규칙\n\n## 세션 인계\n\n- HANDOFF.md를 읽는다\n\n## 비밀 메모\n\n- 개인\n",
  );
  write(path.join(ctx.claudeHome, "CLAUDE.md"), `@${home.replace(/\\/g, "/")}/.codex/AGENTS.md\n`);
  write(path.join(ctx.claudeHome, "settings.json"), {
    model: "opus",
    permissions: { allow: ["Bash(ls:*)", 'Bash("C:/Tools/x.exe":*)'], defaultMode: "auto" },
    enabledPlugins: { "hud@jinmin": true, "secret@acme": true, "off@jinmin": false, "kept@old-market": false },
    extraKnownMarketplaces: {
      jinmin: { source: { source: "directory", path: path.join(root, "jinmin-mods") } },
      acme: { source: { source: "github", repo: "acme-inc/skills" } },
      local: { source: { source: "directory", path: path.join(root, "x") } },
    },
    skipDangerousModePermissionPrompt: true,
  });
  write(path.join(ctx.claudeHome, "plugins", "known_marketplaces.json"), {
    "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" } },
  });
  write(
    path.join(ctx.codexHome, "config.toml"),
    [
      'model = "gpt-x"',
      "",
      "[windows]",
      'sandbox = "elevated"',
      "",
      `[projects.'${root.replace(/\\/g, "\\\\")}']`,
      'trust_level = "trusted"',
      "",
      '[plugins."jinmin-skills@jinmin"]',
      "enabled = true",
      "",
      "[marketplaces.jinmin]",
      'source_type = "local"',
      `source = '${path.join(root, "repo")}'`,
      "",
      "[mcp_servers.tool]",
      'command = "tool"',
      'args = ["serve"]',
      "",
      "[mcp_servers.jk]",
      'command = "jk"',
      "",
    ].join("\n"),
  );
  write(ctx.claudeJson, {
    mcpServers: {
      tool: { type: "stdio", command: path.join(home, ".tools", "tool.exe"), args: ["serve"], env: { API_KEY: "s3cr3t" } },
      remote: { type: "http", url: "https://example.com/mcp" },
      qt: { command: "C:\\Qt\\bin\\qt-mcp.exe", args: [] },
    },
  });
  write(ctx.skillLock, {
    version: 3,
    skills: {
      "find-skills": { source: "vercel-labs/skills", sourceType: "github" },
      "acme-skill": { source: "acme-inc/private", sourceType: "github" },
    },
  });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

async function plan(ids?: CaptureTargetId[]): Promise<Record<string, CaptureItem>> {
  const { items } = await planCaptureWith(ctx, ids);
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

async function applyAll(ids: CaptureTargetId[]): Promise<void> {
  const items = await plan(ids);
  await applyCaptureWith(ctx, ids, Object.fromEntries(ids.map((id) => [id, items[id]!.fingerprint])));
}

const repoPath = (relative: string) => path.join(ctx.repoRoot, ...relative.split("/"));
const profilePath = (relative: string) => path.join(ctx.profileDir, relative);

describe("capture 계획과 적용", () => {
  it("AGENTS.md는 템플릿 제목의 섹션만 공개하고 나머지는 로컬로 보낸다", async () => {
    await applyAll(["agents"]);
    expect(read(repoPath("home/agents/AGENTS.md"))).toBe("## 문서 규약\n\n- 공개 규칙\n\n## 세션 인계\n\n- HANDOFF.md를 읽는다\n");
    const local = read(profilePath("AGENTS.local.md"));
    expect(local).toContain("# 사용자 배경");
    expect(local).toContain("## 비밀 메모");
    expect(local).not.toContain("공개 규칙");
  });

  it("마커 블록이 있으면 블록 안이 공개다", async () => {
    write(
      path.join(ctx.codexHome, "AGENTS.md"),
      "개인 머리말\n<!-- >>> harness-manager >>> -->\n## 공개\n- 규칙\n<!-- <<< harness-manager <<< -->\n개인 꼬리\n",
    );
    const item = (await plan(["agents"])).agents!;
    expect(item.notes.join()).toContain("마커 블록");
    await applyAll(["agents"]);
    expect(read(repoPath("home/agents/AGENTS.md"))).toBe("## 공개\n- 규칙\n");
    expect(read(profilePath("AGENTS.local.md"))).toBe("개인 머리말\n\n개인 꼬리\n");
  });

  it("CLAUDE.md의 홈 경로 import를 ~로 바꾼다", async () => {
    await applyAll(["claude-md"]);
    expect(read(repoPath("home/claude/CLAUDE.md"))).toBe("@~/.codex/AGENTS.md\n");
  });

  it("관리 키만 가져오고, 배열의 개인 항목은 로컬로, PC에 없는 키는 레포 값을 유지한다", async () => {
    const item = (await plan(["claude-settings"]))["claude-settings"]!;
    expect(item.notes.join("\n")).toContain("theme: 이 PC에 없어 레포 값을 유지합니다.");
    expect(item.notes.join("\n")).toContain("관리하지 않는 키(레포에 넣지 않음): skipDangerousModePermissionPrompt");
    await applyAll(["claude-settings"]);
    expect(JSON.parse(read(repoPath("home/claude/settings.managed.json")))).toEqual({
      model: "opus",
      theme: "light",
      permissions: { allow: ["Bash(ls:*)"], defaultMode: "auto" },
    });
    expect(JSON.parse(read(profilePath("claude-settings.local.json")))).toEqual({
      permissions: { allow: ['Bash("C:/Tools/x.exe":*)'] },
    });
  });

  it("Codex config.toml도 관리 키만 TOML로 적고 projects 같은 PC별 표는 넣지 않는다", async () => {
    await applyAll(["codex-config"]);
    const text = read(repoPath("home/codex/config.managed.toml"));
    expect(text).toContain('model = "gpt-x"');
    expect(text).toContain("[windows]");
    expect(text).not.toContain("projects");
  });

  it("플러그인: 이 레포는 self, 비공개 낱말·개인 경로는 레포에 넣지 않고, 기존 항목은 지우지 않는다", async () => {
    const item = (await plan(["plugins"])).plugins!;
    expect(item.applicable).toBe(true);
    await applyAll(["plugins"]);
    const manifest = JSON.parse(read(repoPath("manifest/plugins.json")));
    expect(manifest.marketplaces.map((entry: { name: string }) => entry.name)).toEqual([
      "old-market",
      "claude-plugins-official",
      "jinmin",
    ]);
    expect(manifest.marketplaces.find((entry: { name: string }) => entry.name === "jinmin")).toEqual({
      name: "jinmin",
      source: { kind: "self" },
      providers: ["claude", "codex"],
    });
    expect(manifest.claude.enabled).toEqual(["kept@old-market", "hud@jinmin"]);
    expect(manifest.codex.enabled).toEqual(["jinmin-skills@jinmin"]);
    expect(JSON.stringify(manifest)).not.toMatch(/acme|홍길동/);
    const local = JSON.parse(read(profilePath("manifest.local.json")));
    expect(local.plugins.marketplaces).toEqual([{ name: "acme", source: { kind: "github", repo: "acme-inc/skills" }, providers: ["claude"] }]);
    expect(local.plugins.claude.enabled).toEqual(["secret@acme"]);
  });

  it("MCP: 홈 경로는 ~로, env 값은 자리표시로, 같은 이름은 provider를 합치고 jk와 http는 뺀다", async () => {
    await applyAll(["mcp"]);
    const manifest = JSON.parse(read(repoPath("manifest/mcp.json")));
    expect(manifest.servers).toEqual([
      {
        name: "tool",
        command: "~/.tools/tool.exe",
        args: ["serve"],
        env: { API_KEY: "${API_KEY}" },
        targets: ["claude", "codex"],
        profiles: ["dev", "full"],
      },
    ]);
    expect(read(repoPath("manifest/mcp.json"))).not.toContain("s3cr3t");
    const local = JSON.parse(read(profilePath("manifest.local.json")));
    expect(local.mcp.servers.map((entry: { name: string }) => entry.name)).toEqual(["qt"]);
  });

  it("plugins·mcp·skills를 한 번에 적용해도 같은 로컬 파일에 세 칸이 모두 남는다", async () => {
    await applyAll(["plugins", "mcp", "skills"]);
    const local = JSON.parse(read(profilePath("manifest.local.json")));
    expect(Object.keys(local).sort()).toEqual(["mcp", "plugins", "skills"]);
    expect(local.skills.external.map((entry: { id: string }) => entry.id)).toEqual(["acme-skill"]);
    expect(JSON.parse(read(repoPath("manifest/skills.json"))).external).toEqual([
      { id: "find-skills", source: "vercel-labs/skills", profiles: ["core", "dev", "full"] },
    ]);
  });

  it("다시 계획하면 변경이 없고 적용할 것도 없다", async () => {
    await applyAll(["agents", "claude-md", "claude-settings", "codex-config", "plugins", "mcp", "skills"]);
    const items = await plan();
    for (const item of Object.values(items)) {
      expect(item.changes.every((change) => !change.changed), item.id).toBe(true);
      expect(item.applicable).toBe(false);
    }
  });

  it("공개 파일에 개인 정보가 남으면 노출 경고와 함께 적용을 막는다", async () => {
    // 템플릿에 공개로 적힌 섹션 안에 회사명이 들어가면 섹션 단위 분리로는 못 거른다 — 마지막 방벽이 막는다.
    write(path.join(ctx.codexHome, "AGENTS.md"), "## 문서 규약\n\n- acme 사내 규칙\n\n## 세션 인계\n\n- x\n");
    const item = (await plan(["agents"])).agents!;
    expect(item.applicable).toBe(false);
    expect(item.changes[0]!.exposure).toEqual([{ kind: "private-term", line: 3, text: "- acme 사내 규칙" }]);
    await expect(applyCaptureWith(ctx, ["agents"], { agents: item.fingerprint })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("미리보기 뒤에 원본이나 레포 파일이 바뀌면 409로 거절한다", async () => {
    const item = (await plan(["claude-md"]))["claude-md"]!;
    write(path.join(ctx.claudeHome, "CLAUDE.md"), "@~/.codex/OTHER.md\n");
    await expect(applyCaptureWith(ctx, ["claude-md"], { "claude-md": item.fingerprint })).rejects.toMatchObject({ statusCode: 409 });
    expect(fs.existsSync(repoPath("home/claude/CLAUDE.md"))).toBe(false);
  });

  it("원본이 없으면 그 항목만 오류로 보이고 나머지는 계획된다", async () => {
    fs.rmSync(path.join(ctx.claudeHome, "CLAUDE.md"));
    const items = await plan();
    expect(items["claude-md"]!.error).toContain("CLAUDE.md");
    expect(items["claude-md"]!.applicable).toBe(false);
    expect(items.agents!.applicable).toBe(true);
  });

  it("레포 판별은 package.json 이름과 루트 마켓플레이스를 본다", async () => {
    expect(await isHarnessRepo(ctx.repoRoot)).toBe(true);
    expect(await isHarnessRepo(root)).toBe(false);
  });
});

describe("도우미", () => {
  it("tildify는 홈 아래만 바꾸고 대소문자·구분자를 가리지 않는다", () => {
    expect(tildify("C:\\Users\\Me\\.tools\\a.exe", "c:/users/me")).toBe("~/.tools/a.exe");
    expect(tildify("C:\\Users\\Mean\\a.exe", "C:\\Users\\Me")).toBe("C:\\Users\\Mean\\a.exe");
  });

  it("노출 검사는 홈·절대경로·이메일·비공개 낱말을 줄 번호와 함께 찾고 URL은 넘긴다", () => {
    const text = "ok https://x.dev/a\nC:\\Users\\me\\x\nD:/data\nme@example.com\nAcme Corp";
    expect(scanExposure(text, { home: "C:/Users/me", privateTerms: ["acme"] }).map((flag) => [flag.kind, flag.line])).toEqual([
      ["home-path", 2],
      ["absolute-path", 3],
      ["email", 4],
      ["private-term", 5],
    ]);
  });

  it("마크다운은 모든 수준의 제목에서 자르고 코드 블록 안의 #은 제목으로 보지 않는다", () => {
    const sections = splitMarkdownSections("머리말\n# A\nx\n```\n# 주석\n```\n## B\ny\n");
    expect(sections.map((section) => section.heading)).toEqual([null, "A", "B"]);
    expect(sections[1]!.text).toContain("# 주석");
  });
});
