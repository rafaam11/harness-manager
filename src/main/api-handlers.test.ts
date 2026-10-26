import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedConfigFile } from "@shared/provider-types";

const { getProvidersMock, claudeProvider, codexProvider, safeWriteMock, scanCandidatesMock, archiveItemsMock } =
  vi.hoisted(() => {
    const makeProvider = (id: "claude" | "codex", catalogName: string, mcpName: string) => ({
      id,
      label: id,
      roots: { home: `/tmp/${id}`, configFiles: [] as string[] },
      listConfigFiles: vi.fn(async (): Promise<NormalizedConfigFile[]> => []),
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
      safeWriteMock: vi.fn(async () => ({ sha256: "x", backup: "b" })),
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
vi.mock("./lib/safe-write.js", async () => ({
  ...(await vi.importActual<typeof import("./lib/safe-write.js")>("./lib/safe-write.js")),
  safeWrite: safeWriteMock,
}));
vi.mock("./services/scan.js", () => ({ scanCandidates: scanCandidatesMock }));
vi.mock("./lib/archive.js", async () => ({
  ...(await vi.importActual<typeof import("./lib/archive.js")>("./lib/archive.js")),
  archiveItems: archiveItemsMock,
}));

import { createApiHandlers, type ApiDependencies } from "./api-handlers.js";

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
};
const handlers = createApiHandlers(deps);

beforeEach(() => {
  vi.clearAllMocks();
  claudeProvider.listConfigFiles.mockResolvedValue([]);
  codexProvider.listConfigFiles.mockResolvedValue([]);
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

describe("config writes", () => {
  it("rejects Codex profile config writes even if a descriptor is mistakenly writable", async () => {
    codexProvider.listConfigFiles.mockResolvedValue([
      {
        id: "codex-profile:work.config.toml",
        provider: "codex",
        label: "work.config.toml",
        path: "/tmp/codex/work.config.toml",
        format: "toml",
        scope: "user",
        writable: true,
      },
    ]);
    await expect(
      handlers["config:write"]("codex-profile:work.config.toml", 'model = "x"\n', "abc"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(safeWriteMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown config id", async () => {
    await expect(handlers["config:read"]("nope")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a non-string content with 400 before touching the file", async () => {
    claudeProvider.listConfigFiles.mockResolvedValue([
      {
        id: "settings",
        provider: "claude",
        label: "settings",
        path: "/tmp/s.json",
        format: "json",
        scope: "user",
        writable: true,
      },
    ]);
    await expect(handlers["config:write"]("settings", 42, "abc")).rejects.toMatchObject({ statusCode: 400 });
    expect(safeWriteMock).not.toHaveBeenCalled();
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
