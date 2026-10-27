import type { ApiChannel, ApiReturn, CleanupExecuteResult, ManifestEntry } from "@shared/api-types";
import { CAPTURE_TARGET_IDS, type CaptureTargetId } from "@shared/manifest-types";
import type { NormalizedConfigFile } from "@shared/provider-types";
import { validateConfigContent } from "./lib/config-write.js";
import { readConfig, safeWrite, listBackups, restoreBackup } from "./lib/safe-write.js";
import { assertCleanupCategory } from "./lib/path-scope.js";
import { archiveItems, restoreItem, listManifests } from "./lib/archive.js";
import { readCatalogContent } from "./services/catalog.js";
import { getPlugins } from "./services/plugins.js";
import { scanCandidates } from "./services/scan.js";
import { applyCapture, cloneRepo, defaultCloneTarget, planCapture, rememberRepoRoot, resolveRepoRoot } from "./services/capture/capture.js";
import { processRunner } from "./services/install/exec.js";
import { withLock } from "./lib/lock.js";
import { validateManifest } from "./services/manifest/validate.js";
import { runDoctor } from "./services/doctor/doctor.js";
import { defaultInstallContext, planInstallWith, runInstallWith } from "./services/install/engine.js";
import { installProgress, type InstallSession } from "./services/install/session.js";
import { readAppSettings, updateAppSettings } from "./services/settings.js";
import { checkOfficialLinks } from "./services/external-api/health.js";
import { loadExternalApi, refreshExternalApi } from "./services/external-api/store.js";
import { PROFILES, type AppSettings, type Profile } from "@shared/manifest-types";
import { APP_SETTINGS_FILE, APP_STATE_DIR } from "./config.js";
import type { InstallEvent } from "@shared/install-types";
import { aggregateTaskbarProgress, type TaskbarProgress } from "./window-progress.js";
import { getProviders } from "./providers/registry.js";
import {
  RequestError,
  booleanValue,
  externalUrl,
  nonEmptyString,
  exactObject,
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
  /** 레포 클론을 찾기 시작할 위치(개발 빌드는 앱 경로가 곧 레포다). */
  repoStartDirs(): string[];
  /** OS 폴더 선택 창. 취소하면 null. */
  chooseDirectory(title: string): Promise<string | null>;
  install: {
    session: InstallSession;
    emit(event: InstallEvent): void;
    setProgress(progress: TaskbarProgress): void;
  };
}

function captureIds(value: unknown): CaptureTargetId[] {
  const ids = nonEmptyStringArray(value, "ids", CAPTURE_TARGET_IDS.length);
  for (const id of ids) {
    if (!CAPTURE_TARGET_IDS.includes(id as CaptureTargetId)) throw new RequestError(400, `unknown capture target: ${id}`);
  }
  if (new Set(ids).size !== ids.length) throw new RequestError(400, "ids has duplicates");
  return ids as CaptureTargetId[];
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
  // 레포를 알면 플러그인으로 옮겨진 스킬의 낡은 사본도 정리 후보가 된다.
  const scanWithRepo = async () => scanCandidates({ repoRoot: await resolveRepoRoot({ startDirs: deps.repoStartDirs() }) });
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

    "cleanup:scan": () => scanWithRepo(),
    "cleanup:execute": async (paths, dryRun): Promise<CleanupExecuteResult> => {
      const requested = new Set(nonEmptyStringArray(paths, "paths"));
      const isDryRun = booleanValue(dryRun, "dryRun");
      // 렌더러가 보낸 경로·카테고리를 믿지 않는다. 지금 다시 스캔한 후보 중 요청과 맞는 것만 옮긴다.
      const candidates = (await scanWithRepo()).filter((c) => requested.has(c.path));
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

    "capture:plan": async () => planCapture(await resolveRepoRoot({ startDirs: deps.repoStartDirs() })),
    "capture:apply": async (ids, fingerprints) => {
      const targets = captureIds(ids);
      const prints = exactObject(fingerprints, targets, "fingerprints");
      const checked = Object.fromEntries(targets.map((id) => [id, nonEmptyString(prints[id], `fingerprints.${id}`)]));
      return applyCapture(await resolveRepoRoot({ startDirs: deps.repoStartDirs() }), targets, checked);
    },
    "capture:choose-repo": async () => {
      const chosen = await deps.chooseDirectory("harness-manager 레포 폴더 선택");
      return chosen ? rememberRepoRoot(chosen) : null;
    },
    "repo:clone-target": () => defaultCloneTarget(),
    "repo:clone": () => withLock(() => cloneRepo(processRunner)),
    "manifest:validate": async () => {
      const repoRoot = await resolveRepoRoot({ startDirs: deps.repoStartDirs() });
      if (!repoRoot) throw new RequestError(409, "harness-manager 레포 클론 위치를 모릅니다");
      return validateManifest(repoRoot);
    },

    "doctor:run": async () => runDoctor(await resolveRepoRoot({ startDirs: deps.repoStartDirs() })),

    "install:plan": async () => {
      const repoRoot = await resolveRepoRoot({ startDirs: deps.repoStartDirs() });
      if (!repoRoot) {
        return {
          repoRoot: null,
          repoError: "harness-manager 레포 클론을 찾지 못했습니다.",
          profile: (await readAppSettings(APP_SETTINGS_FILE)).profile,
          steps: [],
        };
      }
      return planInstallWith(await defaultInstallContext(repoRoot));
    },
    "install:run": async (ids) => {
      const requested = nonEmptyStringArray(ids, "ids", 1_000);
      const repoRoot = await resolveRepoRoot({ startDirs: deps.repoStartDirs() });
      if (!repoRoot) throw new RequestError(409, "harness-manager 레포 클론 위치를 모릅니다");
      const ctx = await defaultInstallContext(repoRoot);
      // 렌더러가 보낸 id는 지금 계획에 있는 step이어야 한다. 실행할 명령은 main이 manifest에서 다시 만든다.
      const known = new Set((await planInstallWith(ctx)).steps.map((step) => step.id));
      const unknown = requested.filter((id) => !known.has(id));
      if (unknown.length > 0) throw new RequestError(400, `unknown install step: ${unknown.join(", ")}`);
      const progress = installProgress();
      return deps.install.session.run((signal) =>
        runInstallWith(
          ctx,
          requested,
          (event) => {
            deps.install.emit(event);
            const report = progress(event);
            if (report === "clear") deps.install.setProgress(aggregateTaskbarProgress([]));
            else if (report) deps.install.setProgress(aggregateTaskbarProgress([report]));
          },
          signal,
        ),
      );
    },
    "install:cancel": () => deps.install.session.cancel(),

    "settings:get": () => readAppSettings(APP_SETTINGS_FILE),
    "settings:set": async (patch) => {
      const value = exactObject(patch, ["profile", "selfMarketplaceSource"], "settings");
      const next: Partial<AppSettings> = {};
      if (value.profile !== undefined) {
        if (!PROFILES.includes(value.profile as Profile)) throw new RequestError(400, "profile must be core, dev or full");
        next.profile = value.profile as Profile;
      }
      if (value.selfMarketplaceSource !== undefined) {
        if (value.selfMarketplaceSource !== "directory" && value.selfMarketplaceSource !== "github") {
          throw new RequestError(400, "selfMarketplaceSource must be directory or github");
        }
        next.selfMarketplaceSource = value.selfMarketplaceSource;
      }
      // 설치 중에 프로필을 바꾸면 도는 실행과 계획이 어긋난다.
      if (deps.install.session.running) throw new RequestError(409, "설치가 진행 중입니다");
      return updateAppSettings(APP_SETTINGS_FILE, next);
    },

    "external-api:catalog": () => loadExternalApi(APP_STATE_DIR),
    "external-api:refresh": () => refreshExternalApi(APP_STATE_DIR),
    "external-api:check-links": async () => checkOfficialLinks((await loadExternalApi(APP_STATE_DIR)).catalog),
  };
}
