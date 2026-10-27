import fs from "node:fs/promises";
import type { AppSettings } from "@shared/manifest-types";
import { PROFILES, type Profile } from "@shared/manifest-types";
import { writeFileChecked } from "./capture/capture.js";

/**
 * `~/.harness-manager/settings.json` — 위저드가 고른 값. doctor·install이 읽는다.
 * 모르는 키는 지우지 않는다(새 버전이 더한 키를 옛 버전이 저장하며 날리지 않게).
 */
export const DEFAULT_SETTINGS: AppSettings = { profile: "full", selfMarketplaceSource: "directory" };

export async function readAppSettings(file: string): Promise<AppSettings> {
  let raw: Record<string, unknown> = {};
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) raw = value as Record<string, unknown>;
  } catch {
    // 없거나 깨졌으면 기본값으로 돈다.
  }
  return {
    profile: PROFILES.includes(raw.profile as Profile) ? (raw.profile as Profile) : DEFAULT_SETTINGS.profile,
    selfMarketplaceSource: raw.selfMarketplaceSource === "github" ? "github" : "directory",
    ...(typeof raw.setupProfileId === "string" ? { setupProfileId: raw.setupProfileId } : {}),
  };
}

export async function updateAppSettings(file: string, patch: Partial<AppSettings>): Promise<AppSettings> {
  const before = await fs.readFile(file, "utf8").catch(() => null);
  let raw: Record<string, unknown> = {};
  try {
    const value = before === null ? {} : (JSON.parse(before) as unknown);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) raw = value as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const next = { ...raw, ...patch };
  await writeFileChecked(file, before, `${JSON.stringify(next, null, 2)}\n`);
  return readAppSettings(file);
}
