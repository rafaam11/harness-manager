// renderer ↔ main IPC 계약의 단일 출처. 채널 이름·인자·반환 타입을 여기 한 곳에서만 정의하고,
// preload(노출)·main(핸들러 등록)·renderer(호출)가 모두 이 맵에서 파생한다 — 채널 문자열을 손으로 반복하지 않는다.
import type { DoctorReport } from "./doctor-types";
import type { CaptureApplyResult, CapturePlan, CaptureTargetId, ManifestFileReport } from "./manifest-types";
import type { NormalizedConfigFile, ProviderFilter, ProviderId, ProviderStatus } from "./provider-types";

// --- 도메인 DTO ---------------------------------------------------------------

export interface CatalogItem {
  name: string;
  kind: "skill" | "agent" | "command" | "instruction" | "memory";
  provider?: ProviderId;
  description: string;
  path: string;
  size: number;
  mtime: number;
  warn?: string;
}

export interface CatalogContent {
  raw: string; // frontmatter를 제외한 본문(마크다운)
  frontmatter: Record<string, unknown>;
  size: number;
  mtime: number;
  truncated: boolean;
}

export interface McpServer {
  name: string;
  provider?: ProviderId;
  scope: "user" | "project";
  projectPath?: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface PluginInfo {
  id: string;
  enabledInSettings: boolean | null;
  installs: {
    scope: string;
    projectPath?: string;
    version: string;
    installedAt: string;
    lastUpdated?: string;
  }[];
  blocked: boolean;
}

export interface PluginsSnapshot {
  plugins: PluginInfo[];
  blocklist: { plugin: string; reason: string }[];
}

export interface ConfigFileData {
  content: string;
  sha256: string;
  mtime: number;
  descriptor: NormalizedConfigFile;
}

export interface ConfigWriteResult {
  sha256: string;
  backup: string;
}

export interface BackupInfo {
  name: string;
  size: number;
  mtime: number;
}

export interface CleanupCandidate {
  path: string;
  category: string; // archive 하위 디렉토리명. "warn-only"는 표시 전용(이동 불가)
  reason: string;
  size: number;
  ageDays: number;
}

export interface ManifestEntry {
  original: string;
  archived: string;
  reason: string;
  movedAt: string;
}

export interface ManifestDay {
  date: string;
  entries: ManifestEntry[];
}

export type CleanupExecuteResult =
  | { dryRun: true; wouldMove: { from: string; category: string }[] }
  | { dryRun: false; moved: ManifestEntry[] };

/** electron-updater 진행 상태. main이 이벤트로 push하고 UpdateBadge가 구독해 표시한다. */
export type UpdaterStatus =
  | { state: "idle" } // 최신(또는 dev라 비활성)
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

export interface WindowChromeState {
  maximized: boolean;
  fullScreen: boolean;
}

// --- 요청 채널 ------------------------------------------------------------------

/**
 * renderer가 부를 수 있는 모든 요청. 키가 곧 IPC 채널 이름("영역:동작")이다.
 * 렌더러는 식별자(설정 파일 id, 경로 후보)만 보내고, 무엇을 읽고 쓸지는 main이 정한다.
 */
export interface ApiChannels {
  "app:version": () => string;
  "app:open-releases": () => void;
  "app:open-external": (url: string) => void;

  "window:minimize": () => void;
  "window:toggle-maximize": () => void;
  "window:close": () => void;
  "window:state": () => WindowChromeState;

  "updater:status": () => UpdaterStatus;
  "updater:check": () => void;
  "updater:install": () => void;

  "provider:status": () => ProviderStatus[];

  "config:list": (filter: ProviderFilter) => NormalizedConfigFile[];
  "config:read": (fileId: string) => ConfigFileData;
  "config:write": (fileId: string, content: string, baseHash: string) => ConfigWriteResult;
  "config:backups": (fileId: string) => BackupInfo[];
  "config:restore": (fileId: string, backupName: string) => { sha256: string };

  "catalog:list": (filter: ProviderFilter) => CatalogItem[];
  "catalog:content": (filePath: string) => CatalogContent;
  "plugins:list": () => PluginsSnapshot;
  "mcp:list": (filter: ProviderFilter) => McpServer[];

  "cleanup:scan": () => CleanupCandidate[];
  /** paths는 직전 스캔 결과의 path 목록. main이 다시 스캔해 후보와 맞는 것만 옮긴다. */
  "cleanup:execute": (paths: string[], dryRun: boolean) => CleanupExecuteResult;
  "cleanup:restore": (archivedPath: string) => ManifestEntry;
  "cleanup:manifest": () => ManifestDay[];

  /** 현재 PC → 레포 템플릿 미리보기. 레포 위치를 모르면 repoRoot가 null이다. */
  "capture:plan": () => CapturePlan;
  /** ids와 미리보기 때의 지문만 보낸다. main이 다시 계획해 지문이 같을 때만 쓴다(다르면 409). */
  "capture:apply": (ids: CaptureTargetId[], fingerprints: Partial<Record<CaptureTargetId, string>>) => CaptureApplyResult;
  /** 폴더 선택 창으로 레포 클론 위치를 고르고 기억한다. 취소하면 null. */
  "capture:choose-repo": () => string | null;
  "manifest:validate": () => ManifestFileReport[];

  /** 카드 8개 상태판. 레포 위치를 모르면 cards가 비고 repoError가 있다. */
  "doctor:run": () => DoctorReport;
}

export type ApiChannel = keyof ApiChannels;
export type ApiArgs<K extends ApiChannel> = Parameters<ApiChannels[K]>;
export type ApiReturn<K extends ApiChannel> = Awaited<ReturnType<ApiChannels[K]>>;

/** 런타임 채널 목록. preload는 이 목록에 있는 채널만 통과시키고 main은 전부 등록한다. */
export const API_CHANNELS = [
  "app:version",
  "app:open-releases",
  "app:open-external",
  "window:minimize",
  "window:toggle-maximize",
  "window:close",
  "window:state",
  "updater:status",
  "updater:check",
  "updater:install",
  "provider:status",
  "config:list",
  "config:read",
  "config:write",
  "config:backups",
  "config:restore",
  "catalog:list",
  "catalog:content",
  "plugins:list",
  "mcp:list",
  "cleanup:scan",
  "cleanup:execute",
  "cleanup:restore",
  "cleanup:manifest",
  "capture:plan",
  "capture:apply",
  "capture:choose-repo",
  "manifest:validate",
  "doctor:run",
] as const satisfies readonly ApiChannel[];

// 목록에서 빠진 채널이 있으면 여기서 컴파일 에러가 난다(맵과 목록이 어긋나지 않게).
type MissingChannel = Exclude<ApiChannel, (typeof API_CHANNELS)[number]>;
const _everyChannelListed: [MissingChannel] extends [never] ? true : MissingChannel = true;
void _everyChannelListed;

/**
 * main → renderer 응답 봉투. ipcMain.handle이 throw하면 Electron이 메시지를 "Error invoking remote method…"로
 * 감싸고 statusCode가 사라지므로, throw 대신 봉투를 돌려 403/404/409/422 의미를 그대로 보존한다.
 */
export type ApiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; statusCode: number; error: string };

// --- 이벤트 채널 (main → renderer push) ------------------------------------------

export const UPDATER_EVENT_CHANNEL = "updater:event";
export const WINDOW_STATE_EVENT_CHANNEL = "window:state-changed";

export interface ApiEvents {
  [UPDATER_EVENT_CHANNEL]: UpdaterStatus;
  [WINDOW_STATE_EVENT_CHANNEL]: WindowChromeState;
}

export type ApiEvent = keyof ApiEvents;

export const API_EVENTS = [UPDATER_EVENT_CHANNEL, WINDOW_STATE_EVENT_CHANNEL] as const satisfies readonly ApiEvent[];

// --- preload가 노출하는 표면 -----------------------------------------------------

export interface HarnessBridge {
  platform: string;
  invoke<K extends ApiChannel>(channel: K, ...args: ApiArgs<K>): Promise<ApiResult<ApiReturn<K>>>;
  /** 구독 해제 함수를 돌려준다(언마운트 시 호출). */
  on<E extends ApiEvent>(event: E, listener: (payload: ApiEvents[E]) => void): () => void;
}
