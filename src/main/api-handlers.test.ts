import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProvidersMock, claudeProvider, codexProvider, scanCandidatesMock, archiveItemsMock } =
  vi.hoisted(() => {
    const makeProvider = (id: "claude" | "codex", catalogName: string, mcpName: string) => ({
      id,
      label: id,
      roots: { home: `/tmp/${id}`, configFiles: [] as string[] },
      readMcpServers: vi.fn(async () => [{ name: mcpName }]),
      listCatalog: vi.fn(async () => [{ name: catalogName }]),
      detectRunning: vi.fn(async () => false),
    });
    const claudeProvider = makeProvider("claude", "claude-catalog", "claude-mcp");
    const codexProvider = makeProvider("codex", "codex-catalog", "codex-mcp");
    const getProvidersMock = vi.fn((filter: "claude" | "codex" | "all") => {
      if (filter === "claude") return [claudeProvider];
      if (filter === "codex") return [codexProvider];
      return [claudeProvider, codexProvider];
    });
    return {
      getProvidersMock,
      claudeProvider,
      codexProvider,
      scanCandidatesMock: vi.fn(),
      archiveItemsMock: vi.fn(async (list: { path: string; reason: string }[]) =>
        list.map((i) => ({ original: i.path, archived: `/archive${i.path}`, reason: i.reason, movedAt: "t" })),
      ),
    };
  });

vi.mock("./providers/registry.js", async () => ({
  ...(await vi.importActual<typeof import("./providers/registry.js")>("./providers/registry.js")),
  getProviders: getProvidersMock,
}));
vi.mock("./services/scan.js", () => ({ scanCandidates: scanCandidatesMock }));
vi.mock("./lib/archive.js", async () => ({
  ...(await vi.importActual<typeof import("./lib/archive.js")>("./lib/archive.js")),
  archiveItems: archiveItemsMock,
}));

import { createApiHandlers, type ApiDependencies } from "./api-handlers.js";
import { InstallSession } from "./services/install/session.js";

const deps: ApiDependencies = {
  appVersion: () => "0.0.0",
  openExternal: vi.fn(),
  openReleases: vi.fn(),
  window: {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    state: () => ({ maximized: false, fullScreen: false }),
  },
  updater: { status: () => ({ state: "idle" }), check: vi.fn(async () => undefined), install: vi.fn() },
  repoStartDirs: () => [],
  chooseDirectory: vi.fn(async () => null),
  install: { session: new InstallSession(), emit: vi.fn(), emitRepair: vi.fn(), setProgress: vi.fn() },
};
const handlers = createApiHandlers(deps);

it("validates AI repair providers and live approval identifiers at the IPC boundary", () => {
  expect(() => handlers["repair:run"]("tools.codex", "shell")).toThrow();
  expect(() => handlers["repair:run"]({ command: "cmd" }, "codex")).toThrow();
  expect(() => handlers["repair:respond"]("unknown", true)).toThrow();
  expect(() => handlers["repair:respond"]("unknown", "yes")).toThrow();
  expect(handlers["repair:status"]()).toMatchObject({ running: false, approvals: [] });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provider-aware catalog and MCP channels", () => {
  it.each([
    ["codex", [{ name: "codex-catalog", provider: "codex" }]],
    [
      "all",
      [
        { name: "claude-catalog", provider: "claude" },
        { name: "codex-catalog", provider: "codex" },
      ],
    ],
  ])("lists the catalog for %s", async (filter, expected) => {
    await expect(handlers["catalog:list"](filter)).resolves.toEqual(expected);
  });

  it("tags MCP servers with their provider", async () => {
    await expect(handlers["mcp:list"]("codex")).resolves.toEqual([{ name: "codex-mcp", provider: "codex" }]);
  });

  it.each(["", "bogus", undefined, 3])("rejects the provider filter %s with 400", async (filter) => {
    await expect(handlers["catalog:list"](filter)).rejects.toMatchObject({ statusCode: 400 });
    await expect(handlers["mcp:list"](filter)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("cleanup execution", () => {
  const candidates = [
    { path: "/c/.claude/projects/old", category: "projects", reason: "stale", size: 1, ageDays: 40 },
    { path: "/c/.claude/agents/huge.md", category: "warn-only", reason: "big", size: 1, ageDays: 0 },
  ];

  it("moves only what a fresh scan still proposes, using the scan's category", async () => {
    scanCandidatesMock.mockResolvedValue(candidates);
    await expect(handlers["cleanup:execute"](["/c/.claude/projects/old"], false)).resolves.toMatchObject({
      dryRun: false,
      moved: [{ original: "/c/.claude/projects/old" }],
    });
    expect(archiveItemsMock).toHaveBeenCalledWith(
      [{ path: "/c/.claude/projects/old", reason: "stale" }],
      "projects",
    );
  });

  it("refuses paths the scan no longer proposes", async () => {
    scanCandidatesMock.mockResolvedValue(candidates);
    await expect(handlers["cleanup:execute"](["/c/Windows/System32"], false)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(archiveItemsMock).not.toHaveBeenCalled();
  });

  it("refuses warn-only candidates", async () => {
    scanCandidatesMock.mockResolvedValue(candidates);
    await expect(handlers["cleanup:execute"](["/c/.claude/agents/huge.md"], true)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("previews without moving on dry-run", async () => {
    scanCandidatesMock.mockResolvedValue(candidates);
    await expect(handlers["cleanup:execute"](["/c/.claude/projects/old"], true)).resolves.toEqual({
      dryRun: true,
      wouldMove: [{ from: "/c/.claude/projects/old", category: "projects" }],
    });
    expect(archiveItemsMock).not.toHaveBeenCalled();
  });
});

describe("external links", () => {
  it("only hands http(s) URLs to the OS", () => {
    expect(() => handlers["app:open-external"]("file:///C:/x")).toThrow(expect.objectContaining({ statusCode: 400 }));
    handlers["app:open-external"]("https://example.com/a");
    expect(deps.openExternal).toHaveBeenCalledWith("https://example.com/a");
  });
});

describe("capture channels", () => {
  it("모르는 대상 id나 지문 키를 400으로 거절한다", async () => {
    await expect(handlers["capture:apply"](["nope"], {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(handlers["capture:apply"](["mcp"], { mcp: "x", agents: "y" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(handlers["capture:apply"](["mcp", "mcp"], { mcp: "x" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(handlers["capture:apply"](["mcp"], { mcp: "" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("폴더 선택을 취소하면 아무것도 기억하지 않는다", async () => {
    await expect(handlers["capture:choose-repo"]()).resolves.toBeNull();
    expect(deps.chooseDirectory).toHaveBeenCalledOnce();
  });
});

describe("install channels", () => {
  it("빈 id 목록은 400이다", async () => {
    await expect(handlers["install:run"]([])).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("settings channels", () => {
  it("모르는 키·값은 400, 설치 중에는 409", async () => {
    await expect(handlers["settings:set"]({ profile: "max" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(handlers["settings:set"]({ theme: "dark" })).rejects.toMatchObject({ statusCode: 400 });
    let release!: () => void;
    const running = deps.install.session.run(() => new Promise<void>((resolve) => (release = resolve)));
    await expect(handlers["settings:set"]({ profile: "dev" })).rejects.toMatchObject({ statusCode: 409 });
    release();
    await running;
  });
});
