import { getVisibleCodexSkills } from "./services/codex-skills.js";
import { WorkbenchService, defaultWorkbenchDependencies } from "./services/workbench/service.js";
import { hookDiagnostics, compareProject } from "./services/workbench/diagnostics.js";
import type { ApiChannel, ApiReturn, CleanupExecuteResult, ManifestEntry } from "@shared/api-types";
import { CAPTURE_TARGET_IDS, type CaptureTargetId } from "@shared/manifest-types";
import { assertCleanupCategory } from "./lib/path-scope.js";
import { archiveItems, restoreItem, listManifests } from "./lib/archive.js";
import { readCatalogContent } from "./services/catalog.js";
import { getAllPlugins } from "./services/plugins.js";
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
import type { RepairEvent } from "@shared/repair-types";
import path from "node:path";
import { refreshWindowsEnvironment } from "./platform-env.js";
import { RepairCoordinator } from "./services/repair/coordinator.js";
import { createRepairSource } from "./services/repair/source.js";
import { SetupProfileStore } from "./services/setup-profiles.js";
import { profileHandlers } from "./profile-handlers.js";
import { repairProviders } from "./services/repair/agent.js";
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
  chooseProfileFile?(mode: "open" | "save"): Promise<string | null>;
  profileLog?(event: { stream: "stdout" | "stderr" | "info"; text: string }): void;
  install: {
    session: InstallSession;
    emit(event: InstallEvent): void;
    emitRepair(event: RepairEvent): void;
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

export function createApiHandlers(deps: ApiDependencies): ApiHandlers {
  const workbench = new WorkbenchService({ ...defaultWorkbenchDependencies(null), context: async () => defaultInstallContext(await resolveRepoRoot({ startDirs: deps.repoStartDirs() })) });
  const repair = new RepairCoordinator(deps.install.session, deps.install.emitRepair, path.join(APP_STATE_DIR, "repair"), createRepairSource());
  const profileStore = async () => {
    const root = await resolveRepoRoot({ startDirs: deps.repoStartDirs() });
    return new SetupProfileStore(APP_STATE_DIR, root);
  };
  // 레포를 알면 플러그인으로 옮겨진 스킬의 낡은 사본도 정리 후보가 된다.
  const scanWithRepo = async () => scanCandidates({ repoRoot: await resolveRepoRoot({ startDirs: deps.repoStartDirs() }) });
  return {
    "workbench:snapshot": () => workbench.snapshot(),
    "workbench:definition": id => workbench.definition(nonEmptyString(id, "id")),
    "workbench:lock": () => workbench.versionLock(),
    "workbench:preview": ids => workbench.preview(nonEmptyStringArray(ids, "ids", 500)),
    "workbench:save": definition => workbench.save(definition),
    "workbench:adopt": id => workbench.adopt(nonEmptyString(id, "id")),
    "workbench:migrate": automatic => workbench.migrate(booleanValue(automatic, "automatic")),
    "workbench:apply": token => { const value = nonEmptyString(token, "token"); return deps.install.session.run(signal => workbench.apply(value, signal)); },
    "workbench:history": () => workbench.historyList(),
    "workbench:restore": id => workbench.restorePreview(nonEmptyString(id, "id")),
    "workbench:discover": repository => workbench.discover(nonEmptyString(repository, "repository")),
    "workbench:import": (repository, directory) => workbench.importGithub(nonEmptyString(repository, "repository"), stringValue(directory, "directory")),
    "workbench:updates": () => workbench.updates(),
    "workbench:update": id => workbench.updatePreview(nonEmptyString(id, "id")),
    "workbench:automation": () => workbench.automationStatus(),
    "workbench:check": () => deps.install.session.run(signal => workbench.tick(signal)),
    "workbench:poll": () => deps.install.session.runAutomatic(signal => workbench.poll(signal)),
    "workbench:hooks": async () => hookDiagnostics(getProviders(), (await getAllPlugins()).plugins),
    "workbench:probe": id => workbench.probePreview(nonEmptyString(id, "id")),
    "workbench:project": async () => { const folder = await deps.chooseDirectory("프로젝트 설정 비교 · 읽기 전용"); return folder ? compareProject(folder, getProviders()) : null; },
    ...profileHandlers(deps, profileStore),
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
    "catalog:codex-visible-skills": () => getVisibleCodexSkills(),
    "plugins:list": () => getAllPlugins(),
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
      return deps.install.session.run(async () => applyCapture(await resolveRepoRoot({ startDirs: deps.repoStartDirs() }), targets, checked));
    },
    "capture:choose-repo": async () => {
      const chosen = await deps.chooseDirectory("harness-manager 레포 폴더 선택");
      return chosen ? rememberRepoRoot(chosen) : null;
    },
    "repo:clone-target": () => defaultCloneTarget(),
    "repo:clone": () => withLock(() => cloneRepo(processRunner)),
    "manifest:validate": async () => {
      const repoRoot = await resolveRepoRoot({ startDirs: deps.repoStartDirs() });
      return validateManifest((await new SetupProfileStore(APP_STATE_DIR, repoRoot).active()).root);
    },

    "doctor:run": async () => runDoctor(await resolveRepoRoot({ startDirs: deps.repoStartDirs() })),

    "install:plan": async () => {
      const repoRoot = await resolveRepoRoot({ startDirs: deps.repoStartDirs() });
      return planInstallWith(await defaultInstallContext(repoRoot));
    },
    "install:run": async (ids) => {
      const requested = nonEmptyStringArray(ids, "ids", 1_000);
      return deps.install.session.run(async (signal) => {
      const repoRoot = await resolveRepoRoot({ startDirs: deps.repoStartDirs() });
      const ctx = await defaultInstallContext(repoRoot);
      // 렌더러가 보낸 id는 지금 계획에 있는 step이어야 한다. 실행할 명령은 main이 manifest에서 다시 만든다.
      const known = new Set((await planInstallWith(ctx)).steps.map((step) => step.id));
      const unknown = requested.filter((id) => !known.has(id));
      if (unknown.length > 0) throw new RequestError(400, `unknown install step: ${unknown.join(", ")}`);
      const progress = installProgress();
      return runInstallWith(
          ctx,
          requested,
          (event) => {
            repair.remember(event);
            deps.install.emit(event);
            const report = progress(event);
            if (report === "clear") deps.install.setProgress(aggregateTaskbarProgress([]));
            else if (report) deps.install.setProgress(aggregateTaskbarProgress([report]));
          },
          signal,
        );
      });
    },
    "install:cancel": () => deps.install.session.cancel(),

    "repair:providers": async () => repairProviders(await refreshWindowsEnvironment(process.env)),
    "repair:status": () => repair.snapshot(),
    "repair:run": (stepId, provider, contribution = "none") => {
      const id = nonEmptyString(stepId, "stepId");
      if (provider !== "codex" && provider !== "claude") throw new RequestError(400, "provider must be codex or claude");
      if (!["none", "pr", "direct"].includes(contribution as string)) throw new RequestError(400, "잘못된 기여 방식입니다");
      return repair.enqueue(async () => {
        if (contribution === "direct" && !(await readAppSettings(APP_SETTINGS_FILE)).maintainerMode) throw new RequestError(403, "관리자 모드를 먼저 활성화하세요");
        const repoRoot = await resolveRepoRoot({ startDirs: deps.repoStartDirs() });
        return { ...await defaultInstallContext(repoRoot), contribution: contribution as "none" | "pr" | "direct" };
      }, id, provider);
    },
    "repair:cancel": (jobId) => repair.cancel(nonEmptyString(jobId, "jobId")),
    "repair:retry-source": (jobId) => repair.retrySource(nonEmptyString(jobId, "jobId")),

    "settings:get": () => readAppSettings(APP_SETTINGS_FILE),
    "profiles:list": async () => { const store = await profileStore(); const list = await store.list(); if (list.activeId === "legacy") { await store.active(); return store.list(); } return list; },
    "profiles:select": (id) => {
      const value = nonEmptyString(id, "id");
      return deps.install.session.run(async () => { const result = await (await profileStore()).select(value); repair.reset(); return result; });
    },
    "profiles:create": (name, baseId) => {
      const label = nonEmptyString(name, "name"); const base = nonEmptyString(baseId, "baseId");
      return deps.install.session.run(async () => { const result = await (await profileStore()).create(label, base); repair.reset(); return result; });
    },
    "profiles:connect": (name) => {
      const label = nonEmptyString(name, "name");
      return deps.install.session.run(async () => {
        const store = await profileStore();
        const folder = await deps.chooseDirectory("사용자 프로필 폴더 · manifest와 home이 있는 폴더");
        if (!folder) return store.list();
        const result = await store.connect(label, folder); repair.reset(); return result;
      });
    },
    "settings:set": async (patch) => {
      const value = exactObject(patch, ["profile", "selfMarketplaceSource", "maintainerMode"], "settings");
      const next: Partial<AppSettings> = {};
      if (value.maintainerMode !== undefined) next.maintainerMode = booleanValue(value.maintainerMode, "maintainerMode");
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
