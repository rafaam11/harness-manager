import fs from "node:fs/promises";
import path from "node:path";
import { buildCatalog, bundledSkills } from "@shared/external-api/catalog";
import type { ExternalApiSnapshot } from "@shared/external-api/types";
import { writeFileChecked } from "../capture/capture.js";
import { skillOverrides } from "./skill-overrides.js";
import { syncSkills } from "./sync.js";

/**
 * 새로고침한 k-skill 스냅샷(`~/.harness-manager/external-api/skills.json`). 번들 스냅샷보다 우선한다.
 * 형식이 맞지 않으면 번들로 되돌리고 경고를 붙인다 — 화면이 빈 목록으로 뜨지 않게.
 */
interface StoredSnapshot {
  schemaVersion: 1;
  updatedAt: string;
  skills: unknown[];
}

export function snapshotFile(stateDir: string): string {
  return path.join(stateDir, "external-api", "skills.json");
}

export async function loadExternalApi(stateDir: string): Promise<ExternalApiSnapshot> {
  let text: string;
  try {
    text = await fs.readFile(snapshotFile(stateDir), "utf8");
  } catch {
    return { catalog: buildCatalog(bundledSkills), skillsSource: "bundled", updatedAt: null };
  }
  try {
    const stored = JSON.parse(text) as StoredSnapshot;
    if (stored.schemaVersion !== 1 || !Array.isArray(stored.skills)) throw new Error("형식이 다릅니다");
    return { catalog: buildCatalog(stored.skills), skillsSource: "refreshed", updatedAt: stored.updatedAt };
  } catch (error) {
    return {
      catalog: buildCatalog(bundledSkills),
      skillsSource: "bundled",
      updatedAt: null,
      warning: `저장된 k-skill 스냅샷을 쓰지 못해 앱에 들어 있는 스냅샷을 씁니다: ${(error as Error).message}`,
    };
  }
}

/**
 * k-skill을 다시 받아 저장한다. 받은 목록으로 카탈로그를 먼저 만들어 보고(스키마·연결 검사) 성공할 때만 쓴다 —
 * 원격 형식이 바뀌어도 화면이 깨진 스냅샷을 읽지 않게.
 */
export async function refreshExternalApi(stateDir: string, fetcher: typeof fetch = fetch, now = () => new Date()): Promise<ExternalApiSnapshot> {
  const skills = await syncSkills({ fetcher, overrides: skillOverrides });
  buildCatalog(skills);
  const file = snapshotFile(stateDir);
  const before = await fs.readFile(file, "utf8").catch(() => null);
  const stored: StoredSnapshot = { schemaVersion: 1, updatedAt: now().toISOString(), skills };
  await writeFileChecked(file, before, `${JSON.stringify(stored, null, 2)}\n`);
  return loadExternalApi(stateDir);
}
