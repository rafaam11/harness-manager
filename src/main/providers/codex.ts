import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { CODEX_HOME } from "../config.js";
import { detectProcess } from "../lib/process-detect.js";
import { readCodexMcpServersFromToml } from "../lib/toml-validate.js";
import type { ProviderAdapter } from "./types.js";

export { CODEX_HOME };
export const CODEX_CONFIG = path.join(CODEX_HOME, "config.toml");

export const codexProvider: ProviderAdapter = {
  id: "codex",
  label: "Codex",
  roots: { home: CODEX_HOME, configFiles: [CODEX_CONFIG] },
  async readMcpServers() {
    const raw = await fs.readFile(CODEX_CONFIG, "utf8").catch(() => "");
    return raw ? readCodexMcpServersFromToml(raw) : [];
  },
  async listCatalog() {
    const items = [];
    const globalAgents = path.join(CODEX_HOME, "AGENTS.md");
    const globalOverride = path.join(CODEX_HOME, "AGENTS.override.md");
    for (const p of [globalAgents, globalOverride]) {
      const stat = await fs.stat(p).catch(() => null);
      if (!stat) continue;
      items.push({
        name: path.basename(p),
        kind: "instruction" as const,
        description: "Codex instruction file",
        path: p,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    const memories = path.join(CODEX_HOME, "memories");
    for (const name of ["memory_summary.md", "MEMORY.md"]) {
      const p = path.join(memories, name);
      const stat = await fs.stat(p).catch(() => null);
      if (!stat) continue;
      items.push({
        name,
        kind: "memory" as const,
        description: "Codex memory file",
        path: p,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    const skillsRoot = path.join(CODEX_HOME, "skills");
    async function walkSkills(dir: string): Promise<void> {
      for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkSkills(full);
          continue;
        }
        if (!entry.isFile() || entry.name !== "SKILL.md") continue;
        const stat = await fs.stat(full).catch(() => null);
        if (!stat) continue;
        const raw = await fs.readFile(full, "utf8").catch(() => "");
        let description = "";
        try {
          description = raw ? ((matter(raw).data?.description as string | undefined) ?? "") : "";
        } catch {
          // 잘못된 frontmatter 하나가 전체 Catalog를 가리지 않게 설명만 비운다.
        }
        items.push({
          name: path.relative(skillsRoot, path.dirname(full)).split(path.sep).join("/"),
          kind: "skill" as const,
          description,
          path: full,
          size: stat.size,
          mtime: stat.mtimeMs,
        });
      }
    }
    await walkSkills(skillsRoot);
    return items;
  },
  async detectRunning() {
    return detectProcess(
      process.platform === "win32" ? ["Codex.exe", "codex.exe"] : ["Codex", "codex"],
    );
  },
};
