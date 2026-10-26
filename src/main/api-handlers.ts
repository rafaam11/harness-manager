import type { ApiChannel, ApiReturn, CleanupExecuteResult, ManifestEntry } from "@shared/api-types";
import type { NormalizedConfigFile } from "@shared/provider-types";
import { validateConfigContent } from "./lib/config-write.js";
import { readConfig, safeWrite, listBackups, restoreBackup } from "./lib/safe-write.js";
import { assertCleanupCategory } from "./lib/path-scope.js";
import { archiveItems, restoreItem, listManifests } from "./lib/archive.js";
import { readCatalogContent } from "./services/catalog.js";
import { getPlugins } from "./services/plugins.js";
import { scanCandidates } from "./services/scan.js";
import { getProviders } from "./providers/registry.js";
import {
  RequestError,
  booleanValue,
  externalUrl,
  nonEmptyString,
  nonEmptyStringArray,
  providerFilter,
  stringValue,
} from "./ipc-validation.js";

/**
 * 채널마다 핸들러 하나. 인자는 렌더러에서 온 값이라 `unknown`으로 받고 ipc-validation으로 좁힌다.
 * 맵에 채널이 빠지면 타입 에러가 난다(ApiChannels가 단일 출처).
 */
export type ApiHandlers = {
  [K in ApiChannel]: (...args: unknown[]) => ApiReturn<K> | Promise<ApiReturn<K>>;
};

/** main 프로세스 쪽 부수효과. 창·업데이트·셸은 Electron에 묶여 있어 주입받는다(테스트가 가짜를 넣는다). */
export interface ApiDependencies {
  appVersion(): string;
  openExternal(url: string): void;
  openReleases(): void;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    state(): ApiReturn<"window:state">;
  };
  updater: {
    status(): ApiReturn<"updater:status">;
    check(): Promise<void>;
    install(): Promise<void> | void;
  };
}

async function findConfigFile(id: string): Promise<NormalizedConfigFile> {
  for (const provider of getProviders("all")) {
    const found = (await provider.listConfigFiles()).find((file) => file.id === id);
    if (found) return found;
  }
  throw new RequestError(404, `unknown config file: ${id}`);
}

/** 쓰기 가능한 설정 파일만 돌려준다. Codex profile toml은 descriptor가 잘못돼도 읽기 전용으로 막는다. */
async function writableConfigFile(id: string): Promise<NormalizedConfigFile> {
  const entry = await findConfigFile(id);
  if (entry.provider === "codex" && entry.id !== "codex-config") {
    throw new RequestError(403, "Codex profile config는 읽기 전용입니다");
  }
  if (!entry.writable) throw new RequestError(403, "읽기 전용 파일");
  return entry;
}

export function createApiHandlers(deps: ApiDependencies): ApiHandlers {
  return {
    "app:version": () => deps.appVersion(),
    "app:open-releases": () => deps.openReleases(),
    "app:open-external": (url) => deps.openExternal(externalUrl(url)),

    "window:minimize": () => deps.window.minimize(),
    "window:toggle-maximize": () => deps.window.toggleMaximize(),
    "window:close": () => deps.window.close(),
    "window:state": () => deps.window.state(),

    "updater:status": () => deps.updater.status(),
    "updater:check": () => deps.updater.check(),
    "updater:install": () => deps.updater.install(),

    "provider:status": () =>
      Promise.all(
        getProviders("all").map(async (p) => ({
          id: p.id,
          label: p.label,
          running: await p.detectRunning(),
          roots: [p.roots.home, ...p.roots.configFiles],
        })),
      ),

    "config:list": async (filter) =>
      (await Promise.all(getProviders(providerFilter(filter)).map((p) => p.listConfigFiles()))).flat(),
    "config:read": async (fileId) => {
      const entry = await findConfigFile(nonEmptyString(fileId, "fileId"));
      return { ...(await readConfig(entry.path)), descriptor: entry };
    },
    "config:write": async (fileId, content, baseHash) => {
      const entry = await writableConfigFile(nonEmptyString(fileId, "fileId"));
      return safeWrite(entry.id, entry.path, stringValue(content, "content"), nonEmptyString(baseHash, "baseHash"), {
        validate: (_name, text) => validateConfigContent(entry, text),
      });
    },
    "config:backups": async (fileId) => {
      const entry = await findConfigFile(nonEmptyString(fileId, "fileId"));
      return entry.writable ? listBackups(entry.path) : [];
    },
    "config:restore": async (fileId, backupName) => {
      const entry = await writableConfigFile(nonEmptyString(fileId, "fileId"));
      return restoreBackup(entry.id, entry.path, nonEmptyString(backupName, "backupName"), {
        validate: (_name, text) => validateConfigContent(entry, text),
      });
    },

    "catalog:list": async (filter) =>
      (
        await Promise.all(
          getProviders(providerFilter(filter)).map(async (p) =>
            (await p.listCatalog()).map((item) => ({ ...item, provider: p.id })),
          ),
        )
      ).flat(),
    // 경로는 readCatalogContent 안에서 guardPath(allowlist)를 통과해야 한다.
    "catalog:content": (filePath) => readCatalogContent(nonEmptyString(filePath, "filePath")),
    "plugins:list": () => getPlugins(),
    "mcp:list": async (filter) =>
      (
        await Promise.all(
          getProviders(providerFilter(filter)).map(async (p) =>
            (await p.readMcpServers()).map((server) => ({ ...server, provider: p.id })),
          ),
        )
      ).flat(),

    "cleanup:scan": () => scanCandidates(),
    "cleanup:execute": async (paths, dryRun): Promise<CleanupExecuteResult> => {
      const requested = new Set(nonEmptyStringArray(paths, "paths"));
      const isDryRun = booleanValue(dryRun, "dryRun");
      // 렌더러가 보낸 경로·카테고리를 믿지 않는다. 지금 다시 스캔한 후보 중 요청과 맞는 것만 옮긴다.
      const candidates = (await scanCandidates()).filter((c) => requested.has(c.path));
      if (candidates.length !== requested.size) {
        throw new RequestError(409, "정리 후보가 바뀌었습니다. 다시 스캔한 뒤 선택하세요.");
      }
      if (candidates.some((c) => c.category === "warn-only")) {
        throw new RequestError(400, "warn-only 항목은 이동할 수 없습니다");
      }
      for (const c of candidates) assertCleanupCategory(c.category);
      if (isDryRun) {
        return { dryRun: true, wouldMove: candidates.map((c) => ({ from: c.path, category: c.category })) };
      }
      const byCategory = new Map<string, { path: string; reason: string }[]>();
      for (const c of candidates) {
        const list = byCategory.get(c.category) ?? [];
        list.push({ path: c.path, reason: c.reason });
        byCategory.set(c.category, list);
      }
      const moved: ManifestEntry[] = [];
      for (const [category, list] of byCategory) moved.push(...(await archiveItems(list, category)));
      return { dryRun: false, moved };
    },
    "cleanup:restore": (archivedPath) => restoreItem(nonEmptyString(archivedPath, "archivedPath")),
    "cleanup:manifest": () => listManifests(),
  };
}
