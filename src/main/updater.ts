import { app, shell } from "electron";
import electronUpdater, { type ProgressInfo, type UpdateInfo } from "electron-updater";
import path from "node:path";
import type { UpdaterStatus } from "@shared/types";
import { UPDATER_EVENT_CHANNEL } from "@shared/api-types";
import { sendToMainWindow, type MainWindowLike } from "./main-window.js";
import { createUpdaterLogger } from "./updater-log.js";
import { configureAutoUpdater, quitAndInstallArguments } from "./updater-platform.js";

// electron-updater는 CJS라 named import가 번들에서 깨진다 → default import 후 구조분해(issue #7976).
const { autoUpdater } = electronUpdater;

const RELEASES_URL = "https://github.com/rafaam11/harness-manager/releases/latest";
const REPOSITORY_URL = "https://github.com/rafaam11/harness-manager";

let currentStatus: UpdaterStatus = { state: "idle" };
let getWindow: () => MainWindowLike | null = () => null;

function publish(status: UpdaterStatus): void {
  currentStatus = status;
  sendToMainWindow(getWindow(), UPDATER_EVENT_CHANNEL, status);
}

/** The renderer mounts after the first check starts, so it reads the current state instead of waiting for an event. */
export function updaterStatus(): UpdaterStatus {
  return currentStatus;
}

/**
 * autoUpdater 배선 + 앱 시작 시 조용한 자동 확인 1회.
 * dev 빌드는 업데이트 피드가 없으므로 모든 진입점이 "idle"만 보고한다.
 * public 저장소라 토큰 없이 GitHub 릴리스를 익명 조회한다(latest.yml + blockmap 차등 다운로드).
 */
export function initUpdater(options: { autoCheck?: boolean; getWindow?: () => MainWindowLike | null } = {}): void {
  if (options.getWindow) getWindow = options.getWindow;
  if (!app.isPackaged) return;
  // Before anything else: a silent install has no window to report from, so this file is the
  // only place a stalled or refused install ever says so.
  autoUpdater.logger = createUpdaterLogger(path.join(app.getPath("userData"), "logs", "updater.log"));
  configureAutoUpdater(autoUpdater);
  autoUpdater.on("checking-for-update", () => publish({ state: "checking" }));
  autoUpdater.on("update-available", (info: UpdateInfo) => publish({ state: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => publish({ state: "idle" }));
  autoUpdater.on("download-progress", (progress: ProgressInfo) =>
    publish({ state: "downloading", percent: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => publish({ state: "downloaded", version: info.version }));
  autoUpdater.on("error", (error: Error) => publish({ state: "error", message: String(error?.message ?? error) }));
  if (options.autoCheck !== false) void autoUpdater.checkForUpdatesAndNotify();
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    publish({ state: "idle" });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publish({ state: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return;
  // isSilent=true runs the NSIS installer with /S. It also makes quitAndInstall read isForceRunAfter
  // instead of autoRunAppAfterInstall, so both flags must be true for the app to come back up.
  const [isSilent, isForceRunAfter] = quitAndInstallArguments(process.platform);
  autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
}


export function openReleasesPage(): void {
  void shell.openExternal(RELEASES_URL);
}

export function openRepositoryPage(): void {
  void shell.openExternal(REPOSITORY_URL);
}
