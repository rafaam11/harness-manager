import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CAPTURE_TARGET_IDS,
  type CaptureApplyResult,
  type CaptureItem,
  type CapturePlan,
  type CaptureTargetId,
} from "@shared/manifest-types";
import { AGENTS_SKILL_LOCK, APP_STATE_DIR, BACKUP_DIR, CLAUDE_HOME, CLAUDE_JSON, CODEX_HOME, HM_USER_HOME, PROFILE_DIR, REPO_LOCATION_FILE } from "../../config.js";
import { SetupProfileStore } from "../setup-profiles.js";
import { ensurePrivateTerms, profileFile, transferProblem } from "../profile-document.js";
import { withLock } from "../../lib/lock.js";
import type { CommandRunner } from "../install/exec.js";
import { resolveDocumentsDir } from "../dotfiles.js";
import { ConflictError, sha256 } from "../../lib/safe-write.js";
import { scanExposure } from "./exposure.js";
import { TARGET_PLANNERS, readText, type CaptureContext, type PlannedFile, type TargetPlan } from "./targets.js";
import { unifiedDiff } from "./text.js";

export class CaptureRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

// ───────────────────────────── 레포 위치 ─────────────────────────────

/** 이 앱의 레포 클론인지. package.json 이름과 루트 마켓플레이스로 판별한다. */
export async function isHarnessRepo(candidate: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(candidate, "package.json"), "utf8")) as { name?: unknown };
    await fs.access(path.join(candidate, ".claude-plugin", "marketplace.json"));
    return pkg.name === "harness-manager";
  } catch {
    return false;
  }
}

async function walkUp(start: string): Promise<string | null> {
  let current = path.resolve(start);
  for (;;) {
    if (await isHarnessRepo(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 레포 클론을 찾는다: 명시값 → `HM_REPO` → `~/.harness-manager/repo.json` → 주어진 출발점에서 위로.
 * 설치본은 asar 안에서 돌아 자기 위치로는 레포를 알 수 없어서 repo.json이 필요하다.
 */
export async function resolveRepoRoot(options: { explicit?: string; startDirs?: string[] } = {}): Promise<string | null> {
  const direct = [options.explicit, process.env.HM_REPO];
  for (const candidate of direct) if (candidate && (await isHarnessRepo(candidate))) return path.resolve(candidate);
  try {
    const saved = JSON.parse(await fs.readFile(REPO_LOCATION_FILE, "utf8")) as { path?: unknown };
    if (typeof saved.path === "string" && (await isHarnessRepo(saved.path))) return path.resolve(saved.path);
  } catch {
    // 기록이 없으면 다음 후보로 간다.
  }
  for (const start of options.startDirs ?? []) {
    const found = await walkUp(start);
    if (found) return found;
  }
  // 기록이 없어도 이미 클론이 있으면 찾아서 기억한다. 설치본을 처음 띄운 사용자가 폴더를 고르지 않아도 되게 한다.
  const discovered = await discoverRepoRoot({ home: HM_USER_HOME, claudeHome: CLAUDE_HOME });
  if (discovered) await rememberRepoRoot(discovered).catch(() => undefined);
  return discovered;
}

/** 공개 레포 주소. 클론이 없을 때 "레포 받기"가 이 주소만 받는다(렌더러가 주소를 정하지 않는다). */
export const REPO_CLONE_URL = "https://github.com/rafaam11/harness-manager.git";

/** "레포 받기"가 클론할 기본 위치. */
export function defaultCloneTarget(home: string = HM_USER_HOME): string {
  return path.join(home, "dev", "harness-manager");
}

/**
 * 클론이 없을 때 공개 레포를 기본 위치에 받고 기억한다. 이미 그 자리에 클론이 있으면 받지 않고 기억만 한다.
 * 다른 파일이 든 폴더에는 받지 않는다(사용자 파일을 덮지 않는다).
 */
export async function cloneRepo(runner: CommandRunner, target: string = defaultCloneTarget()): Promise<string> {
  if (await isHarnessRepo(target)) return rememberRepoRoot(target);
  const existing = await fs.readdir(target).catch(() => null);
  if (existing && existing.length > 0) {
    throw new CaptureRequestError(`${target}에 다른 파일이 있어 받지 않았습니다. "폴더 선택"으로 클론 위치를 직접 고르세요.`, 409);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const errors: string[] = [];
  const result = await runner.run(
    { command: "git", args: ["clone", REPO_CLONE_URL, target], timeoutMs: 5 * 60_000, env: { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } },
    (stream, line) => {
      if (stream === "stderr") errors.push(line);
    },
    new AbortController().signal,
  );
  if (result.notFound) throw new CaptureRequestError("git을 찾지 못했습니다. git을 설치한 뒤 다시 누르세요(winget install Git.Git).", 422);
  if (result.code !== 0 || !(await isHarnessRepo(target))) {
    const detail = result.timedOut ? "시간 초과" : errors.slice(-2).join(" ") || `종료 코드 ${result.code}`;
    throw new CaptureRequestError(`레포를 받지 못했습니다: ${detail}`, 422);
  }
  return rememberRepoRoot(target);
}

/**
 * 기록 없이 레포 클론을 찾는다.
 * 1. Claude의 `jinmin` 마켓플레이스가 directory 소스면 그 폴더(개발 PC는 이렇게 설정한다)
 * 2. 흔한 작업 폴더 아래 `harness-manager`
 */
export async function discoverRepoRoot(options: { home: string; claudeHome: string; roots?: string[] }): Promise<string | null> {
  const candidates: string[] = [];
  try {
    const known = JSON.parse(await fs.readFile(path.join(options.claudeHome, "plugins", "known_marketplaces.json"), "utf8")) as Record<
      string,
      { source?: { source?: unknown; path?: unknown } }
    >;
    const source = known.jinmin?.source;
    if (source?.source === "directory" && typeof source.path === "string") candidates.push(source.path);
  } catch {
    // 마켓플레이스 기록이 없으면 흔한 폴더만 본다.
  }
  const roots = options.roots ?? [
    path.join(options.home, "dev"),
    path.join(options.home, "source", "repos"),
    path.join(options.home, "Documents", "GitHub"),
    path.join(options.home, "repos"),
    path.join(options.home, "projects"),
    path.join(options.home, "src"),
    options.home,
    // 드라이브 루트는 실제 홈일 때만 본다(HM_HOME으로 격리한 시험 실행이 진짜 클론을 집지 않게).
    ...(process.platform === "win32" && !process.env.HM_HOME ? ["C:\\dev", "D:\\dev"] : []),
  ];
  candidates.push(...roots.map((root) => path.join(root, "harness-manager")));
  for (const candidate of candidates) if (await isHarnessRepo(candidate)) return path.resolve(candidate);
  return null;
}

export async function rememberRepoRoot(candidate: string): Promise<string> {
  if (!(await isHarnessRepo(candidate))) throw new CaptureRequestError("harness-manager 레포 폴더가 아닙니다", 400);
  const resolved = path.resolve(candidate);
  await fs.mkdir(path.dirname(REPO_LOCATION_FILE), { recursive: true });
  await fs.writeFile(REPO_LOCATION_FILE, `${JSON.stringify({ path: resolved }, null, 2)}\n`, "utf8");
  return resolved;
}

// ───────────────────────────── 계획 ─────────────────────────────

async function readPrivateTerms(profileDir: string): Promise<string[] | null> {
  const text = await readText(path.join(profileDir, "private-terms.json")).catch(() => null);
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as { terms?: unknown };
    if (!Array.isArray(value.terms) || !value.terms.every((term) => typeof term === "string")) throw new Error("invalid terms");
    return value.terms.filter((term) => term.length > 0) as string[];
  } catch {
    throw new CaptureRequestError("비공개 낱말 목록 형식이 올바르지 않습니다. 가져오기 화면에서 목록을 다시 저장하세요.", 422);
  }
}

export const MISSING_TERMS_WARNING =
  "비공개 낱말 목록을 초기화하지 못했습니다. 프로필 폴더 쓰기 권한을 확인하세요.";

export async function defaultCaptureContext(
  repoRoot: string | null,
): Promise<{ context: CaptureContext; warnings: string[]; termsMissing: boolean }> {
  const selected = await new SetupProfileStore(APP_STATE_DIR, repoRoot).active();
  if (selected.kind === "builtin") throw new CaptureRequestError("공통 기본 프로필은 읽기 전용입니다. 셋업 위저드에서 개인 프로필을 만든 뒤 가져오기를 실행하세요.", 409);
  await withLock(() => ensurePrivateTerms(selected.localDir));
  const terms = await readPrivateTerms(selected.localDir);
  const warnings = terms === null ? [MISSING_TERMS_WARNING] : [];
  return {
    context: {
      repoRoot: selected.root,
      home: HM_USER_HOME,
      claudeHome: CLAUDE_HOME,
      claudeJson: CLAUDE_JSON,
      codexHome: CODEX_HOME,
      skillLock: AGENTS_SKILL_LOCK,
      profileDir: selected.localDir,
      privateTerms: terms ?? [],
      documentsDir: await resolveDocumentsDir(HM_USER_HOME),
      gitScope: {},
    },
    warnings,
    termsMissing: terms === null,
  };
}

function fingerprint(plan: TargetPlan): string {
  return sha256(
    JSON.stringify({ error: plan.error ?? null, files: plan.files.map((file) => [file.displayPath, file.before, file.after]) }),
  );
}

function toItem(plan: TargetPlan, ctx: CaptureContext): CaptureItem {
  const changes = plan.files.map((file) => {
    const changed = (file.before ?? "") !== file.after || file.before === null;
    return {
      scope: file.scope,
      displayPath: file.displayPath,
      existed: file.before !== null,
      changed,
      diff: changed ? unifiedDiff(file.displayPath, file.before, file.after) : "",
      // 로컬 파일은 이 PC에만 남으므로 검사하지 않는다.
      exposure: [...(file.scope === "repo" ? scanExposure(file.after, { home: ctx.home, privateTerms: ctx.privateTerms }) : []), ...(transferProblem(file.after)?.includes("인증") ? [{ kind: "credential" as const, line: 1, text: "인증 정보가 포함될 수 있어 저장하지 않습니다" }] : [])],
    };
  });
  const anyChange = changes.some((change) => change.changed);
  const exposed = changes.some((change) => change.exposure.length > 0);
  return {
    id: plan.id,
    label: plan.label,
    sources: plan.sources,
    changes,
    notes: plan.notes,
    ...(plan.error ? { error: plan.error } : {}),
    applicable: !plan.error && anyChange && !exposed,
    fingerprint: fingerprint(plan),
  };
}

async function planTarget(id: CaptureTargetId, ctx: CaptureContext): Promise<TargetPlan> {
  try {
    return await TARGET_PLANNERS[id](ctx);
  } catch (error) {
    return { id, label: id, sources: [], files: [], notes: [], error: (error as Error).message };
  }
}

export async function planCaptureWith(ctx: CaptureContext, ids: readonly CaptureTargetId[] = CAPTURE_TARGET_IDS): Promise<{
  items: CaptureItem[];
  plans: TargetPlan[];
}> {
  const plans: TargetPlan[] = [];
  // 차례대로 돈다: plugins·mcp·skills가 같은 로컬 오버레이 파일을 읽는다.
  for (const id of ids) plans.push(await planTarget(id, ctx));
  return { plans, items: plans.map((plan) => toItem(plan, ctx)) };
}

export async function planCapture(repoRoot: string | null): Promise<CapturePlan> {
  const { context, warnings, termsMissing } = await defaultCaptureContext(repoRoot);
  const { items } = await planCaptureWith(context);
  // 비공개 낱말 목록이 없으면 회사 마켓플레이스 같은 것이 공개 레포로 샐 수 있다. 미리보기만 허용한다.
  const gated = termsMissing ? items.map((item) => ({ ...item, applicable: false })) : items;
  return { repoRoot: context.repoRoot, profileDir: context.profileDir, warnings, items: gated };
}

// ───────────────────────────── 적용 ─────────────────────────────

async function backupExisting(filePath: string, content: string): Promise<void> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.writeFile(path.join(BACKUP_DIR, `${path.basename(filePath)}.${stamp}.bak`), content, "utf8");
}

/**
 * 계획한 파일만 쓴다(경로 allowlist를 폴더가 아니라 파일 단위로 연다). 계획 뒤에 누가 파일을 바꿨으면 409다.
 * 원래 있던 파일은 앱 백업 폴더에 남긴 뒤 temp → rename으로 바꾼다.
 */
async function writePlannedFile(file: PlannedFile): Promise<void> {
  await writeFileChecked(file.absPath, file.before, file.after, file.displayPath);
}

/**
 * 읽어 둔 내용(before, 없던 파일이면 null)이 지금도 그대로일 때만 쓴다. capture와 install이 함께 쓴다.
 * 원래 있던 파일은 앱 백업 폴더(~/.harness-manager/backups)에 남긴 뒤 temp → rename으로 바꾼다.
 */
export async function writeFileChecked(absPath: string, before: string | null, after: string, displayPath = absPath): Promise<void> {
  const file = { absPath, before, after, displayPath };
  const current = await readText(file.absPath);
  if ((current === null ? null : sha256(current)) !== (file.before === null ? null : sha256(file.before))) {
    throw new ConflictError(`${file.displayPath}이(가) 계획 뒤에 바뀌었습니다. 다시 불러온 뒤 적용하세요.`);
  }
  if (current !== null) await backupExisting(file.absPath, current);
  await fs.mkdir(path.dirname(file.absPath), { recursive: true });
  const temp = `${file.absPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, file.after, "utf8");
    await fs.rename(temp, file.absPath);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

/**
 * 렌더러는 항목 id와 화면에 보였던 지문만 보낸다. main이 다시 계획해 지문이 같을 때만 쓴다 — 렌더러가 보낸
 * 내용이나 경로는 쓰지 않는다. plugins·mcp·skills는 같은 로컬 파일을 고치므로 항목마다 쓰기 직전에 다시 계획한다.
 */
export async function applyCaptureWith(
  ctx: CaptureContext,
  ids: CaptureTargetId[],
  fingerprints: Partial<Record<CaptureTargetId, string>>,
): Promise<CaptureApplyResult> {
  return withLock(async () => {
    const { items } = await planCaptureWith(ctx, ids);
    for (const item of items) {
      if (fingerprints[item.id] !== item.fingerprint) {
        throw new ConflictError(`${item.label}: 화면의 미리보기와 지금 상태가 다릅니다. 다시 불러온 뒤 적용하세요.`);
      }
      if (!item.applicable) {
        throw new CaptureRequestError(`${item.label}: 적용할 수 없는 항목입니다(변경 없음, 오류 또는 노출 경고).`, 422);
      }
    }
    const written: string[] = [];
    for (const id of ids) {
      const plan = await planTarget(id, ctx);
      for (const file of plan.files) {
        if (file.before === file.after) continue;
        const root = file.scope === "repo" ? ctx.repoRoot : ctx.profileDir;
        await profileFile(root, path.relative(root, file.absPath).split(path.sep).join("/"));
        await writePlannedFile(file);
        written.push(file.displayPath);
      }
    }
    return { applied: ids, written };
  });
}

export async function applyCapture(
  repoRoot: string | null,
  ids: CaptureTargetId[],
  fingerprints: Partial<Record<CaptureTargetId, string>>,
): Promise<CaptureApplyResult> {
  const { context, termsMissing } = await defaultCaptureContext(repoRoot);
  if (termsMissing) throw new CaptureRequestError(MISSING_TERMS_WARNING, 422);
  return applyCaptureWith(context, ids, fingerprints);
}
