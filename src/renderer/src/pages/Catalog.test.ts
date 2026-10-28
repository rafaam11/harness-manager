import { describe, expect, it } from "vitest";
import {
  CATALOG_PROVIDER_TABS,
  filterCatalogItemsByProvider,
  filterCatalogPluginsByProvider,
} from "./Catalog";

describe("catalog provider tabs", () => {
  it("offers horizontal provider tabs for All, Claude, and Codex", () => {
    expect(CATALOG_PROVIDER_TABS.map((tab) => tab.label)).toEqual(["전체", "Claude", "Codex"]);
  });

  it("filters provider-owned catalog rows while keeping All mixed", () => {
    const rows = [
      { provider: "claude" as const, name: "CLAUDE.md" },
      { provider: "codex" as const, name: "AGENTS.md" },
      { provider: "codex" as const, name: "MEMORY.md" },
    ];

    expect(filterCatalogItemsByProvider(rows, "all").map((row) => row.name)).toEqual([
      "CLAUDE.md",
      "AGENTS.md",
      "MEMORY.md",
    ]);
    expect(filterCatalogItemsByProvider(rows, "claude").map((row) => row.name)).toEqual(["CLAUDE.md"]);
    expect(filterCatalogItemsByProvider(rows, "codex").map((row) => row.name)).toEqual([
      "AGENTS.md",
      "MEMORY.md",
    ]);
  });

  it("separates Claude and Codex plugins", () => {
    const plugins = [{ id: "claude-plugin", provider: "claude" as const }, { id: "codex-plugin", provider: "codex" as const }];

    expect(filterCatalogPluginsByProvider(plugins, "all")).toEqual(plugins);
    expect(filterCatalogPluginsByProvider(plugins, "claude")).toEqual([plugins[0]]);
    expect(filterCatalogPluginsByProvider(plugins, "codex")).toEqual([plugins[1]]);
  });
});
