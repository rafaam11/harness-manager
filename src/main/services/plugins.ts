import fs from "node:fs/promises";
import path from "node:path";
import { processRunner, type CommandRunner } from "./install/exec.js";
import type { PluginsSnapshot } from "@shared/api-types";
import { CLAUDE_HOME } from "../config.js";

interface InstalledEntry {
  scope: string;
  projectPath?: string;
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated?: string;
}

export async function getPlugins(): Promise<PluginsSnapshot> {
  const pluginsDir = path.join(CLAUDE_HOME, "plugins");

  const installed = JSON.parse(
    await fs.readFile(path.join(pluginsDir, "installed_plugins.json"), "utf8").catch(() => '{"plugins":{}}'),
  ) as { plugins: Record<string, InstalledEntry[]> };

  const blocklist = JSON.parse(
    await fs.readFile(path.join(pluginsDir, "blocklist.json"), "utf8").catch(() => '{"plugins":[]}'),
  ) as { plugins: { plugin: string; reason: string }[] };

  const settings = JSON.parse(
    await fs.readFile(path.join(CLAUDE_HOME, "settings.json"), "utf8"),
  ) as { enabledPlugins?: Record<string, boolean> };

  const enabled = settings.enabledPlugins ?? {};

  const ids = new Set([...Object.keys(installed.plugins), ...Object.keys(enabled)]);
  const result = [...ids].map((id) => {
    const installs = installed.plugins[id] ?? [];
    return {
      id,
      provider: "claude" as const,
      enabledInSettings: enabled[id] ?? null,
      installs: installs.map((i) => ({
        scope: i.scope,
        projectPath: i.projectPath,
        version: i.version,
        installedAt: i.installedAt,
        lastUpdated: i.lastUpdated,
      })),
      blocked: blocklist.plugins.some((b) => b.plugin === id),
    };
  });

  return { plugins: result, blocklist: blocklist.plugins };
}

/** Codex CLI is the source of truth for installed plugins, including disabled ones. */
export async function getCodexPlugins(runner: CommandRunner = processRunner): Promise<PluginsSnapshot> {
  const lines: string[] = [];
  let size = 0;
  const result = await runner.run({ command: "codex", args: ["plugin", "list", "--json"], timeoutMs: 15_000 }, (stream, line) => {
    if (stream !== "stdout") return;
    size += line.length;
    if (size <= 2 * 1024 * 1024) lines.push(line);
  }, new AbortController().signal);
  if (result.notFound || result.timedOut || result.code !== 0 || size > 2 * 1024 * 1024) throw new Error("Codex plugin list failed");
  const parsed: unknown = JSON.parse(lines.join("\n"));
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { installed?: unknown }).installed)) throw new Error("Invalid Codex plugin list");
  const plugins: PluginsSnapshot["plugins"] = [];
  for (const value of (parsed as { installed: unknown[] }).installed) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    if (typeof item.pluginId !== "string" || typeof item.enabled !== "boolean" || item.installed !== true) continue;
    plugins.push({ provider: "codex", id: item.pluginId, enabledInSettings: item.enabled, blocked: false,
      installs: [{ scope: "user", version: typeof item.version === "string" ? item.version : "", installedAt: "" }] });
  }
  return { plugins, blocklist: [] };
}

export async function getAllPlugins(): Promise<PluginsSnapshot> {
  const [claude, codex] = await Promise.allSettled([getPlugins(), getCodexPlugins()]);
  return {
    plugins: [...(claude.status === "fulfilled" ? claude.value.plugins : []), ...(codex.status === "fulfilled" ? codex.value.plugins : [])],
    blocklist: claude.status === "fulfilled" ? claude.value.blocklist : [],
    warnings: [ ...(claude.status === "rejected" ? ["Claude 플러그인 목록을 읽지 못했습니다."] : []), ...(codex.status === "rejected" ? ["Codex 플러그인 목록을 읽지 못했습니다. Codex 설치 상태를 확인하세요."] : []) ],
  };
}
