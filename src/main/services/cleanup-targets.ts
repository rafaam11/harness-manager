import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { CleanupCandidate } from "@shared/api-types";

/**
 * v3 정리 후보(M8). doctor가 노랑으로 알리는 것과 정리 화면이 아카이브하는 것이 어긋나지 않게
 * 두 곳이 이 함수들을 함께 쓴다. 아무것도 지우지 않는다 — 후보를 찾을 뿐이고 이동은 archive.ts가 한다.
 */
export interface CleanupScanContext {
  home: string;
  claudeHome: string;
  codexHome: string;
  /** `~/.agents/skills`(npx skills·Codex가 함께 쓰는 스킬 폴더). */
  agentsSkillsDir: string;
  /** `~/.harness-manager`. */
  appStateDir: string;
  /** 레포를 모르면 중복 스킬을 판단하지 않는다. */
  repoRoot: string | null;
  staleDays: number;
  now: number;
}

export function skillDirs(ctx: CleanupScanContext): { dir: string; provider: "claude" | "codex" }[] {
  return [
    { dir: path.join(ctx.claudeHome, "skills"), provider: "claude" },
    { dir: ctx.agentsSkillsDir, provider: "codex" },
    { dir: path.join(ctx.codexHome, "skills"), provider: "codex" },
  ];
}

export interface BrokenLink {
  path: string;
  target: string | null;
}

/** 스킬 폴더의 링크(심볼릭 링크·junction) 중 대상이 없는 것. */
export async function findBrokenLinks(dirs: readonly string[]): Promise<BrokenLink[]> {
  const out: BrokenLink[] = [];
  for (const dir of dirs) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      try {
        await fs.stat(full);
      } catch {
        out.push({ path: full, target: await fs.readlink(full).catch(() => null) });
      }
    }
  }
  return out;
}

/** 이 레포 plugins 폴더의 스킬 이름 → 플러그인 이름. */
export async function repoPluginSkills(repoRoot: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const pluginsDir = path.join(repoRoot, "plugins");
  for (const plugin of await fs.readdir(pluginsDir, { withFileTypes: true }).catch(() => [])) {
    if (!plugin.isDirectory()) continue;
    const skills = await fs.readdir(path.join(pluginsDir, plugin.name, "skills"), { withFileTypes: true }).catch(() => []);
    for (const skill of skills) if (skill.isDirectory()) result.set(skill.name, plugin.name);
  }
  return result;
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** provider별로 켜진 플러그인 id(`name@marketplace`). */
export async function enabledPlugins(ctx: Pick<CleanupScanContext, "claudeHome" | "codexHome">): Promise<Record<"claude" | "codex", Set<string>>> {
  const settings = await readJson(path.join(ctx.claudeHome, "settings.json"));
  const claudeOn = settings && typeof settings.enabledPlugins === "object" && settings.enabledPlugins !== null
    ? Object.entries(settings.enabledPlugins as Record<string, unknown>).filter(([, on]) => on === true).map(([id]) => id)
    : [];
  let codexOn: string[] = [];
  try {
    const config = parseToml(await fs.readFile(path.join(ctx.codexHome, "config.toml"), "utf8")) as Record<string, unknown>;
    const plugins = (config.plugins ?? {}) as Record<string, { enabled?: unknown }>;
    codexOn = Object.entries(plugins).filter(([, table]) => table?.enabled === true).map(([id]) => id);
  } catch {
    codexOn = [];
  }
  return { claude: new Set(claudeOn), codex: new Set(codexOn) };
}

export interface DuplicateSkill {
  path: string;
  plugin: string;
}

/**
 * 플러그인으로 옮겨진 스킬의 낡은 loose 사본. **그 provider에서 플러그인이 켜져 있을 때만** 후보다 —
 * 아직 플러그인이 없는 PC에서 loose 사본을 치우면 스킬이 사라진다.
 */
export async function findDuplicateSkills(ctx: CleanupScanContext): Promise<DuplicateSkill[]> {
  if (!ctx.repoRoot) return [];
  const skills = await repoPluginSkills(ctx.repoRoot);
  const enabled = await enabledPlugins(ctx);
  const out: DuplicateSkill[] = [];
  for (const { dir, provider } of skillDirs(ctx)) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const plugin = skills.get(entry.name);
      if (!plugin || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      const on = [...enabled[provider]].some((id) => id.startsWith(`${plugin}@`));
      if (on) out.push({ path: path.join(dir, entry.name), plugin });
    }
  }
  return out;
}

export interface Leftover {
  path: string;
  reason: string;
}

/** 더 쓰지 않는 앱·플러그인 흔적. 있는 것만 돌려준다. */
export async function findLeftovers(ctx: CleanupScanContext): Promise<Leftover[]> {
  const known: Leftover[] = [
    { path: path.join(ctx.claudeHome, "plugins", "cache", "claude-hud"), reason: "제거한 claude-hud 플러그인 캐시(jinmin-hud로 대체)" },
    { path: path.join(ctx.claudeHome, "plugins", "claude-hud"), reason: "제거한 claude-hud 플러그인 폴더(jinmin-hud로 대체)" },
    // v2가 남긴 앱 데이터(스펙 Q3·D19). v3는 읽지 않는다.
    { path: path.join(ctx.appStateDir, "board.json"), reason: "v2 보드 데이터(v3에서 제거한 기능)" },
    { path: path.join(ctx.appStateDir, "projects.json"), reason: "v2 프로젝트 레지스트리(multi-cli-work로 옮겨 감)" },
    { path: path.join(ctx.claudeHome, "harness-manager"), reason: "v2 앱 데이터 폴더" },
    { path: path.join(ctx.claudeHome, "backups", "harness-manager"), reason: "v2 설정 백업(v3는 ~/.harness-manager/backups)" },
  ];
  const out: Leftover[] = [];
  for (const item of known) {
    try {
      await fs.lstat(item.path);
      out.push(item);
    } catch {
      // 없으면 후보가 아니다.
    }
  }
  return out;
}

/** Codex가 쌓는 로그 중 오래된 것. 세션 기록(sessions)·DB는 건드리지 않는다. */
export async function findStaleCodexLogs(ctx: CleanupScanContext): Promise<{ path: string; size: number; ageDays: number }[]> {
  const cutoff = ctx.now - ctx.staleDays * 86_400_000;
  const out: { path: string; size: number; ageDays: number }[] = [];
  const consider = async (file: string) => {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile() || stat.mtimeMs >= cutoff) return;
    out.push({ path: file, size: stat.size, ageDays: Math.floor((ctx.now - stat.mtimeMs) / 86_400_000) });
  };
  for (const entry of await fs.readdir(ctx.codexHome).catch(() => [] as string[])) {
    if (/^sandbox.*\.log$/i.test(entry)) await consider(path.join(ctx.codexHome, entry));
  }
  for (const entry of await fs.readdir(path.join(ctx.codexHome, "log")).catch(() => [] as string[])) {
    await consider(path.join(ctx.codexHome, "log", entry));
  }
  return out;
}

async function sizeOf(target: string): Promise<number> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of await fs.readdir(target, { withFileTypes: true }).catch(() => [])) {
    total += await sizeOf(path.join(target, entry.name));
  }
  return total;
}

async function ageDays(target: string, now: number): Promise<number> {
  const stat = await fs.lstat(target).catch(() => null);
  return stat ? Math.max(0, Math.floor((now - stat.mtimeMs) / 86_400_000)) : 0;
}

/** 정리 화면에 올릴 v3 후보. 카테고리는 archive.ts가 허용하는 이름과 같아야 한다. */
export async function scanV3Candidates(ctx: CleanupScanContext): Promise<CleanupCandidate[]> {
  const out: CleanupCandidate[] = [];
  const tilde = (value: string) => (value.toLowerCase().startsWith(ctx.home.toLowerCase()) ? `~${value.slice(ctx.home.length)}` : value);
  for (const link of await findBrokenLinks(skillDirs(ctx).map((entry) => entry.dir))) {
    out.push({
      path: link.path,
      category: "broken-links",
      reason: `대상이 없는 스킬 링크 → ${link.target ? tilde(link.target) : "?"}`,
      size: 0,
      ageDays: await ageDays(link.path, ctx.now),
    });
  }
  for (const duplicate of await findDuplicateSkills(ctx)) {
    out.push({
      path: duplicate.path,
      category: "duplicate-skills",
      reason: `플러그인 ${duplicate.plugin}로 옮겨진 스킬의 낡은 사본(플러그인이 켜져 있음)`,
      size: await sizeOf(duplicate.path),
      ageDays: await ageDays(duplicate.path, ctx.now),
    });
  }
  for (const leftover of await findLeftovers(ctx)) {
    out.push({
      path: leftover.path,
      category: "leftovers",
      reason: leftover.reason,
      size: await sizeOf(leftover.path),
      ageDays: await ageDays(leftover.path, ctx.now),
    });
  }
  for (const log of await findStaleCodexLogs(ctx)) {
    out.push({ path: log.path, category: "codex-logs", reason: `Codex 로그 ${ctx.staleDays}일 초과`, size: log.size, ageDays: log.ageDays });
  }
  return out;
}
