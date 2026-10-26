/**
 * 레포 `manifest/*.json`의 형태. install(M6)·doctor(M5)가 이 파일을 읽고, capture(M4)가 일부를 현재 PC에서
 * 끌어와 갱신한다. 모든 파일에 `schemaVersion: 1`이 있다. 모르는 키는 경고만 하고 읽는다 — 새 레포를 옛 앱이
 * 읽는 일이 흔하기 때문이다(새 PC는 레포를 먼저 받고 앱은 나중에 업데이트된다).
 */

export type Profile = "core" | "dev" | "full";
export const PROFILES: readonly Profile[] = ["core", "dev", "full"];

export type ProviderTarget = "claude" | "codex";

/** 이 PC에서 고른 값(`~/.harness-manager/settings.json`). 위저드가 쓰고 doctor·install이 읽는다. */
export interface AppSettings {
  profile: Profile;
  /** 이 레포 마켓플레이스(jinmin)를 붙일 소스. 개발 PC는 레포 폴더, 새 PC는 GitHub(D15). */
  selfMarketplaceSource: "directory" | "github";
}
export const PROVIDER_TARGETS: readonly ProviderTarget[] = ["claude", "codex"];

export type PackageSource = "winget" | "scoop" | "npm" | "cargo" | "uv";
export const PACKAGE_SOURCES: readonly PackageSource[] = ["winget", "scoop", "npm", "cargo", "uv"];

/** `manifest/packages.json` — 패키지 관리자로 설치하는 툴체인. */
export interface PackagesManifest {
  schemaVersion: 1;
  packages: PackageEntry[];
}

export interface PackageEntry {
  /** 전역 유일. step id `packages.<source>.<id>`의 끝자리. */
  id: string;
  source: PackageSource;
  /** 패키지 관리자에 넘기는 이름(winget id, scoop 앱, npm 패키지 …). */
  name: string;
  profiles: Profile[];
  /** 설치 확인에 쓰는 실행 파일 이름(PATH에서 찾는다). 없으면 패키지 관리자 목록으로 확인한다. */
  bin?: string;
  description?: string;
}

/** `manifest/tools.json` — 패키지 관리자 밖의 단독 설치기(Claude Code, Codex, cua-driver). */
export interface ToolsManifest {
  schemaVersion: 1;
  tools: ToolEntry[];
}

export type ToolInstallKind = "powershell-script" | "npm" | "winget" | "manual";
export const TOOL_INSTALL_KINDS: readonly ToolInstallKind[] = ["powershell-script", "npm", "winget", "manual"];

export interface ToolEntry {
  id: string;
  name: string;
  profiles: Profile[];
  /** 고정 버전. 없으면 최신을 받는다. */
  version?: string;
  install: { kind: ToolInstallKind; ref: string };
  /** 설치 확인 명령. 셸 없이 실행한다. */
  verify: { command: string; args: string[] };
  notes?: string;
}

/** `manifest/plugins.json` — 마켓플레이스와 provider별로 켤 플러그인. */
export interface PluginsManifest {
  schemaVersion: 1;
  marketplaces: MarketplaceEntry[];
  claude: { enabled: string[] };
  codex: { enabled: string[] };
}

/**
 * `self`는 이 레포 자신이다. 개발 PC는 레포 폴더(directory), 새 PC는 GitHub 소스로 붙인다(D15).
 * 개인 경로가 레포에 들어가지 않도록 directory 소스는 `self` 말고는 쓰지 않는다.
 */
export type MarketplaceSource = { kind: "self" } | { kind: "github"; repo: string } | { kind: "git"; url: string };

export interface MarketplaceEntry {
  name: string;
  source: MarketplaceSource;
  providers: ProviderTarget[];
}

/** `manifest/mcp.json` — 두 provider에 같은 이름으로 등록할 MCP 서버. */
export interface McpManifest {
  schemaVersion: 1;
  servers: McpEntry[];
}

export interface McpEntry {
  name: string;
  /** 실행 파일. 홈 아래 경로는 `~`로 시작한다. */
  command: string;
  args: string[];
  /** 값은 비밀이 아닌 상수이거나 `${ENV_NAME}` 자리표시다. capture는 실제 값을 옮기지 않는다. */
  env?: Record<string, string>;
  targets: ProviderTarget[];
  profiles: Profile[];
}

/** `manifest/skills.json` — 레포에 복사하지 않고 설치 단계에서 받는 외부 스킬. */
export interface SkillsManifest {
  schemaVersion: 1;
  external: ExternalSkillEntry[];
}

export interface ExternalSkillEntry {
  id: string;
  /** `npx skills add <source> --skill <id>`의 source(GitHub `owner/repo`). */
  source: string;
  profiles: Profile[];
}

export type ManifestFileName = "packages" | "tools" | "plugins" | "mcp" | "skills";
export const MANIFEST_FILES: readonly ManifestFileName[] = ["packages", "tools", "plugins", "mcp", "skills"];

export interface ManifestFileReport {
  name: ManifestFileName;
  /** 레포 기준 상대 경로. */
  path: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// ─────────────────────────────── capture ───────────────────────────────

export type CaptureTargetId = "agents" | "claude-md" | "claude-settings" | "codex-config" | "plugins" | "mcp" | "skills";
export const CAPTURE_TARGET_IDS: readonly CaptureTargetId[] = [
  "agents",
  "claude-md",
  "claude-settings",
  "codex-config",
  "plugins",
  "mcp",
  "skills",
];

/** 공개 레포에 들어가면 안 되는 것을 찾은 자리. 하나라도 있으면 그 항목은 적용할 수 없다. */
export interface ExposureFlag {
  kind: "home-path" | "absolute-path" | "email" | "private-term";
  /** 레포 파일 기준 1부터 세는 줄 번호. */
  line: number;
  text: string;
}

export interface CaptureFileChange {
  /** 쓰는 곳. `repo`는 공개 레포, `local`은 `~/.harness-manager/profile`(로컬 전용). */
  scope: "repo" | "local";
  /** repo면 레포 기준 상대 경로, local이면 프로필 폴더 기준 상대 경로. 화면 표시에 쓴다. */
  displayPath: string;
  existed: boolean;
  changed: boolean;
  /** unified diff. 바뀐 것이 없으면 빈 문자열. */
  diff: string;
  exposure: ExposureFlag[];
}

export interface CaptureItem {
  id: CaptureTargetId;
  label: string;
  /** 어디서 읽었는지(홈은 `~`로 줄인 경로). */
  sources: string[];
  changes: CaptureFileChange[];
  /** 관리하지 않는 키, 로컬로 돌린 값, PC에 없어 레포 값을 유지한 항목 등. */
  notes: string[];
  /** 원본을 읽지 못하는 등 이 항목을 계획할 수 없는 사유. 있으면 changes는 비어 있다. */
  error?: string;
  /** 바뀐 파일이 있고 노출 경고가 없을 때만 true. */
  applicable: boolean;
  /** 계획 내용의 지문. 적용할 때 main이 다시 계산해 다르면 409로 거절한다. */
  fingerprint: string;
}

export interface CapturePlan {
  repoRoot: string | null;
  /** repoRoot를 찾지 못한 이유. */
  repoError?: string;
  profileDir: string;
  /** 계획 전체에 걸린 경고(예: private-terms.json이 없어 회사명 검사를 못 함). */
  warnings: string[];
  items: CaptureItem[];
}

export interface CaptureApplyResult {
  applied: CaptureTargetId[];
  written: string[];
}
