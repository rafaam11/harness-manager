// renderer ↔ main IPC 계약의 단일 출처. 채널 이름·인자·반환 타입을 여기 한 곳에서만 정의하고,
// preload(노출)·main(핸들러 등록)·renderer(호출)가 모두 이 맵에서 파생한다 — 채널 문자열을 손으로 반복하지 않는다.
import type { DoctorReport } from "./doctor-types";
import type { ExternalApiSnapshot, ExternalLinkCheck } from "./external-api/types";
import type { InstallEvent, InstallPlan, InstallRunResult } from "./install-types";
import type { AppSettings, CaptureApplyResult, CapturePlan, CaptureTargetId, ManifestFileReport } from "./manifest-types";
import type { ProviderFilter, ProviderId, ProviderStatus } from "./provider-types";
import type { RepairBatchSnapshot, RepairEvent, RepairProvider, RepairSnapshot } from "./repair-types";
import type { SetupProfiles, ProfileDocument, ProfileEditor, ProfilePreview, ProfileSyncPreview, ProfileSyncStatus } from "./setup-profile-types";

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
  provider?: ProviderId;
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
  warnings?: string[];
  blocklist: { plugin: string; reason: string }[];
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


  "catalog:list": (filter: ProviderFilter) => CatalogItem[];
  "catalog:content": (filePath: string) => CatalogContent;
  "catalog:codex-visible-skills": () => { cwd: string; skills: string[] };
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
  /** 클론이 없을 때 "레포 받기"가 받을 위치(표시용). */
  "repo:clone-target": () => string;
  /** 공개 레포를 기본 위치에 받고 기억한다. 주소와 위치는 main이 정한다. */
  "repo:clone": () => string;
  "manifest:validate": () => ManifestFileReport[];

  /** 카드 8개 상태판. 레포 위치를 모르면 cards가 비고 repoError가 있다. */
  "doctor:run": () => DoctorReport;

  /** 정상이 아닌 항목마다 step과 할 일(명령·파일 diff). */
  "install:plan": () => InstallPlan;
  /** step id만 보낸다. 진행은 `install:event`로 흐르고, 끝나면 결과로 풀린다. 이미 도는 중이면 409. */
  "install:run": (ids: string[]) => InstallRunResult;
  "install:cancel": () => void;

  "repair:providers": () => RepairProvider[];
  "repair:status": () => RepairBatchSnapshot;
  "repair:run": (stepId: string, provider: ProviderId, contribution?: "none" | "pr" | "direct") => RepairSnapshot;
  "repair:cancel": (jobId: string) => void;
  "repair:retry-source": (jobId: string) => RepairSnapshot;

  "settings:get": () => AppSettings;
  "profiles:list": () => SetupProfiles;
  "profiles:select": (id: string) => SetupProfiles;
  "profiles:create": (name: string, baseId: string) => SetupProfiles;
  "profiles:connect": (name: string) => SetupProfiles;
  "profiles:editor": (id: string) => ProfileEditor;
  "profiles:preview": (id: string, fingerprint: string, document: ProfileDocument) => ProfilePreview;
  "profiles:apply": (id: string, token: string) => ProfileEditor;
  "profiles:update": (id: string, action: "rename" | "archive" | "restore", name?: string) => SetupProfiles;
  "profiles:export-plan": (id: string) => ProfilePreview;
  "profiles:export": (id: string, token: string) => string | null;
  "profiles:import-plan": () => ProfilePreview | null;
  "profiles:import": (token: string) => SetupProfiles;
  "profiles:terms": () => { id: string; terms: string[]; issue?: string };
  "profiles:set-terms": (id: string, terms: string[]) => void;
  "profiles:github-status": (id: string) => ProfileSyncStatus;
  "profiles:github-tools": () => void;
  "profiles:github-login": () => void;
  "profiles:github-connect": (id: string, repository: string, create: boolean) => ProfileSyncStatus;
  "profiles:sync-plan": (id: string, direction: "send" | "receive") => ProfileSyncPreview;
  "profiles:sync": (id: string, token: string, choices: Record<string, "local" | "remote">) => ProfileSyncStatus;
  "profiles:cancel": () => void;
  /** 바꿀 키만 보낸다. 모르는 키나 값은 400. */
  "settings:set": (patch: Partial<AppSettings>) => AppSettings;

  /** 외부 API 카탈로그(M12). 새로고침한 k-skill 스냅샷이 있으면 그것으로 만든다. */
  "external-api:catalog": () => ExternalApiSnapshot;
  /** k-skill을 GitHub에서 다시 받아 저장한다(네트워크는 main에서만). */
  "external-api:refresh": () => ExternalApiSnapshot;
  /** 정보원 공식 링크를 HEAD로 점검한다. */
  "external-api:check-links": () => ExternalLinkCheck[];
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
  "catalog:list",
  "catalog:content",
  "catalog:codex-visible-skills",
  "plugins:list",
  "mcp:list",
  "cleanup:scan",
  "cleanup:execute",
  "cleanup:restore",
  "cleanup:manifest",
  "capture:plan",
  "capture:apply",
  "capture:choose-repo",
  "repo:clone-target",
  "repo:clone",
  "manifest:validate",
  "doctor:run",
  "install:plan",
  "install:run",
  "install:cancel",
  "repair:providers",
  "repair:status",
  "repair:run",
  "repair:cancel",
  "repair:retry-source",
  "settings:get",
  "profiles:list",
  "profiles:select",
  "profiles:create",
  "profiles:connect",
  "profiles:editor", "profiles:preview", "profiles:apply", "profiles:update",
  "profiles:export-plan", "profiles:export", "profiles:import-plan", "profiles:import",
  "profiles:terms", "profiles:set-terms", "profiles:github-status", "profiles:github-tools", "profiles:github-login", "profiles:github-connect", "profiles:sync-plan", "profiles:sync", "profiles:cancel",
  "settings:set",
  "external-api:catalog",
  "external-api:refresh",
  "external-api:check-links",
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
export const INSTALL_EVENT_CHANNEL = "install:event";
export const REPAIR_EVENT_CHANNEL = "repair:event";

export interface ApiEvents {
  "profiles:log": { stream: "stdout" | "stderr" | "info"; text: string };
  [UPDATER_EVENT_CHANNEL]: UpdaterStatus;
  [WINDOW_STATE_EVENT_CHANNEL]: WindowChromeState;
  [INSTALL_EVENT_CHANNEL]: InstallEvent;
  [REPAIR_EVENT_CHANNEL]: RepairEvent;
}

export type ApiEvent = keyof ApiEvents;

export const API_EVENTS = [UPDATER_EVENT_CHANNEL, WINDOW_STATE_EVENT_CHANNEL, INSTALL_EVENT_CHANNEL, REPAIR_EVENT_CHANNEL, "profiles:log"] as const satisfies readonly ApiEvent[];

// --- preload가 노출하는 표면 -----------------------------------------------------

export interface HarnessBridge {
  platform: string;
  invoke<K extends ApiChannel>(channel: K, ...args: ApiArgs<K>): Promise<ApiResult<ApiReturn<K>>>;
  /** 구독 해제 함수를 돌려준다(언마운트 시 호출). */
  on<E extends ApiEvent>(event: E, listener: (payload: ApiEvents[E]) => void): () => void;
}
