import { CLAUDE_HOME, CLAUDE_JSON } from "../config.js";
import { detectClaude } from "../lib/cc-detect.js";
import { getCatalog } from "../services/catalog.js";
import { getMcpServers } from "../services/mcp.js";
import type { ProviderAdapter } from "./types.js";

export const claudeProvider: ProviderAdapter = {
  id: "claude",
  label: "Claude Code",
  roots: { home: CLAUDE_HOME, configFiles: [CLAUDE_JSON] },
  readMcpServers: getMcpServers,
  listCatalog: getCatalog,
  async detectRunning() {
    return (await detectClaude()).running;
  },
};
