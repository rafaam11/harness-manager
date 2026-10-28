import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import { INSTALL_EVENT_CHANNEL, REPAIR_EVENT_CHANNEL, WINDOW_STATE_EVENT_CHANNEL, type WindowChromeState } from "@shared/api-types";
import { createApiHandlers } from "./api-handlers.js";
import { installHmCliShim } from "./cli-shim.js";
import { HM_CLI_BIN_DIR } from "./config.js";
import { InstallSession } from "./services/install/session.js";
import { registerMainIpc } from "./ipc.js";
import { openExternalSafely } from "./lib/open-external.js";
import { isMainWindowSender, sendToMainWindow } from "./main-window.js";
import { discoverSessionEnvironment } from "./platform-env.js";
import { QuitCoordinator } from "./quit-coordinator.js";
import { checkForUpdates, initUpdater, openReleasesPage, quitAndInstall, updaterStatus } from "./updater.js";
import { windowChromeOptions } from "./window-chrome.js";
import { rendererTargetNavigationUrl, resolveRendererTarget, secureBrowserWindow } from "./window-security.js";

const APP_WINDOW_TITLE = "하네스 매니저";

// e2e·통합 테스트가 실제 사용자 데이터를 건드리지 않게 userData를 바꿔 끼운다.
if (process.env.HARNESS_MANAGER_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.HARNESS_MANAGER_USER_DATA));
}

let mainWindow: BrowserWindow | null = null;

// 설치가 도는 중이면 종료 전에 취소하고 지금 명령이 정리될 때까지 기다린다.
const installSession = new InstallSession();

// 종료 경로(창 닫기·업데이트 재시작)를 한 관문으로 모은다.
const quitCoordinator = new QuitCoordinator(() => installSession.cancelAndWait());

/** 설치 중에 끄려 하면 묻는다. 도는 명령(winget 등)이 반쯤 끝난 채 남을 수 있어서다. */
async function confirmQuitDuringInstall(): Promise<boolean> {
  if (!installSession.running) return true;
  const options = {
    type: "warning" as const,
    buttons: ["작업 중단하고 종료", "계속 진행"],
    defaultId: 1,
    cancelId: 1,
    title: "설치 또는 AI 복구 진행 중",
    message: "설치 또는 AI 복구가 진행 중입니다.",
    detail: "지금 끄면 도는 명령을 멈춥니다. 끝난 step은 그대로 남고, 나머지는 다음에 다시 실행하면 됩니다.",
  };
  const result = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
  return result.response === 0;
}

function chromeState(window: BrowserWindow): WindowChromeState {
  return { maximized: window.isMaximized(), fullScreen: window.isFullScreen() };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#181716",
    title: APP_WINDOW_TITLE,
    ...windowChromeOptions(process.platform),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => window.show());
  // 렌더러가 최대화/복원 아이콘을 직접 그리므로, 요청하지 않은 상태 변화(드래그 영역 더블클릭, Win+Up)도 알려 준다.
  const publishChromeState = () => {
    if (!window.isDestroyed()) sendToMainWindow(window, WINDOW_STATE_EVENT_CHANNEL, chromeState(window));
  };
  window.on("maximize", publishChromeState);
  window.on("unmaximize", publishChromeState);
  window.on("enter-full-screen", publishChromeState);
  window.on("leave-full-screen", publishChromeState);
  window.on("close", (event) => {
    if (quitCoordinator.isCommitted()) return;
    event.preventDefault();
    void requestQuit();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  const rendererTarget = resolveRendererTarget({
    isPackaged: app.isPackaged,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFilePath: path.join(__dirname, "../renderer/index.html"),
  });
  // 카탈로그 본문의 외부 링크는 앱 안에서 열지 않고 OS 브라우저로 넘긴다.
  secureBrowserWindow(window, rendererTargetNavigationUrl(rendererTarget), openExternalSafely);
  if (rendererTarget.kind === "url") void window.loadURL(rendererTarget.value);
  else void window.loadFile(rendererTarget.value);
  return window;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function requestQuit(): Promise<void> {
  if (quitCoordinator.isCommitted()) return;
  await quitCoordinator.request({ confirm: confirmQuitDuringInstall, exit: () => app.quit() });
}

// 업데이트 재시작도 같은 관문을 지난다 — 설치 중 작업을 끊지 않게.
async function installUpdateAndQuit(): Promise<void> {
  if (quitCoordinator.isCommitted()) return;
  await quitCoordinator.request({ confirm: confirmQuitDuringInstall, exit: quitAndInstall });
}

// 단일 인스턴스 강제: 쓰기 직렬화(lib/lock.ts)가 프로세스 하나를 전제한다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);

  void app.whenReady().then(async () => {
    // 렌더러가 타이틀바를 직접 그린다. Electron 기본 메뉴는 영어 메뉴줄을 하나 더 얹을 뿐이다.
    Menu.setApplicationMenu(null);
    // GUI로 실행하면 셸 PATH를 못 받는다(Linux). 실행 파일 감지(findOnPath)가 이 PATH를 쓴다.
    Object.assign(process.env, await discoverSessionEnvironment(process.env as Record<string, string>));

    registerMainIpc(
      ipcMain,
      createApiHandlers({
        appVersion: () => app.getVersion(),
        openExternal: openExternalSafely,
        openReleases: openReleasesPage,
        window: {
          minimize: () => mainWindow?.minimize(),
          toggleMaximize: () => {
            if (!mainWindow) return;
            if (mainWindow.isMaximized()) mainWindow.unmaximize();
            else mainWindow.maximize();
          },
          close: () => mainWindow?.close(),
          state: () => (mainWindow ? chromeState(mainWindow) : { maximized: false, fullScreen: false }),
        },
        updater: { status: updaterStatus, check: checkForUpdates, install: installUpdateAndQuit },
        // 개발 소스 연결은 선택 사항이다. 설치본의 프로필·설치 기능은 번들로 동작한다.
        repoStartDirs: () => (app.isPackaged ? [] : [app.getAppPath()]),
        chooseDirectory: async (title) => {
          const options = { title, properties: ["openDirectory" as const] };
          const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        chooseProfileFile: async (mode) => {
          const filters = [{ name: "HM 프로필", extensions: ["hmprofile.json"] }];
          if (mode === "save") {
            const options = { title: "프로필 내보내기", defaultPath: "my-profile.hmprofile.json", filters };
            const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
            return result.canceled ? null : result.filePath ?? null;
          }
          const options = { title: "프로필 가져오기", filters, properties: ["openFile" as const] };
          const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
          return result.canceled ? null : result.filePaths[0] ?? null;
        },
        profileLog: (event) => { if (mainWindow && !mainWindow.isDestroyed()) sendToMainWindow(mainWindow, "profiles:log", event); },
        install: {
          session: installSession,
          emitRepair: (event) => {
            if (mainWindow && !mainWindow.isDestroyed()) sendToMainWindow(mainWindow, REPAIR_EVENT_CHANNEL, event);
          },
          emit: (event) => {
            if (mainWindow && !mainWindow.isDestroyed()) sendToMainWindow(mainWindow, INSTALL_EVENT_CHANNEL, event);
          },
          setProgress: ({ value, mode }) => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(value, { mode });
          },
        },
      }),
      (event) => isMainWindowSender(mainWindow, event),
    );

    mainWindow = createWindow();
    initUpdater({ getWindow: () => mainWindow });

    // 설치본만 심을 적는다. 개발 빌드가 적으면 설치본의 심을 node_modules의 electron으로 덮어쓴다.
    if (app.isPackaged && !process.env.HARNESS_MANAGER_USER_DATA) {
      installHmCliShim(HM_CLI_BIN_DIR, process.execPath, path.join(app.getAppPath(), "out", "main", "cli.js")).catch(
        (error: unknown) => console.warn("[hm-cli] 심을 쓰지 못함:", error),
      );
    }

    app.on("activate", showMainWindow);
  });

  app.on("before-quit", (event) => {
    if (quitCoordinator.isCommitted()) return;
    event.preventDefault();
    void requestQuit();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") void requestQuit();
  });
}
