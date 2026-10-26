import path from "node:path";
import { CAPTURE_TARGET_IDS, type CaptureItem, type CaptureTargetId } from "@shared/manifest-types";
import { ConflictError } from "./lib/safe-write.js";
import { applyCapture, CaptureRequestError, planCapture, resolveRepoRoot } from "./services/capture/capture.js";
import { validateManifest } from "./services/manifest/validate.js";

export const CAPTURE_USAGE = `  hm capture [--dry-run] [--only <id,…>] [--repo <레포>] [--json]   현재 PC → 레포 템플릿 미리보기(기본)
  hm capture --apply --only <id,…> --yes [--repo <레포>] [--json]   미리보기와 같은 내용을 쓴다
  hm manifest validate [--repo <레포>] [--json]                      manifest/*.json 검사(실패하면 종료 코드 3)
  capture --apply가 거절되면(미리보기 뒤 변경, 노출 경고, private-terms.json 없음) 종료 코드 4

  capture 대상 id: ${CAPTURE_TARGET_IDS.join(", ")}`;

class CaptureUsageError extends Error {}

interface CaptureArgs {
  command: "capture" | "validate";
  apply: boolean;
  yes: boolean;
  json: boolean;
  only?: CaptureTargetId[];
  repo?: string;
}

export function parseCaptureArgs(argv: string[]): CaptureArgs {
  const [first, second, ...rest] = argv;
  let tail: string[];
  let command: CaptureArgs["command"];
  if (first === "capture") {
    command = "capture";
    tail = [second, ...rest].filter((arg): arg is string => arg !== undefined);
  } else if (first === "manifest" && second === "validate") {
    command = "validate";
    tail = rest;
  } else {
    throw new CaptureUsageError("알 수 없는 명령입니다.");
  }
  const parsed: CaptureArgs = { command, apply: false, yes: false, json: false };
  for (let index = 0; index < tail.length; index += 1) {
    const arg = tail[index];
    switch (arg) {
      case "--dry-run":
        parsed.apply = false;
        break;
      case "--apply":
        parsed.apply = true;
        break;
      case "--yes":
        parsed.yes = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--repo":
        parsed.repo = tail[index + 1];
        if (!parsed.repo) throw new CaptureUsageError("--repo에는 경로가 필요합니다.");
        index += 1;
        break;
      case "--only": {
        const ids = (tail[index + 1] ?? "").split(",").map((id) => id.trim()).filter(Boolean);
        const unknown = ids.filter((id) => !CAPTURE_TARGET_IDS.includes(id as CaptureTargetId));
        if (ids.length === 0 || unknown.length > 0) throw new CaptureUsageError(`--only 값이 잘못됐습니다: ${unknown.join(", ") || "(비어 있음)"}`);
        parsed.only = ids as CaptureTargetId[];
        index += 1;
        break;
      }
      default:
        throw new CaptureUsageError(`알 수 없는 옵션: ${arg}`);
    }
  }
  if (command === "validate" && (parsed.apply || parsed.only || parsed.yes)) throw new CaptureUsageError("manifest validate는 --repo·--json만 받습니다.");
  if (parsed.apply && (!parsed.only || !parsed.yes)) {
    throw new CaptureUsageError("--apply는 --only로 대상을 고르고 --yes로 확인해야 합니다.");
  }
  return parsed;
}

function itemStatus(item: CaptureItem): string {
  if (item.error) return `오류 — ${item.error}`;
  if (item.changes.some((change) => change.exposure.length > 0)) return "노출 경고(적용 불가)";
  return item.changes.some((change) => change.changed) ? "변경 있음" : "변경 없음";
}

function formatItem(item: CaptureItem): string {
  const lines = [`■ ${item.label} [${item.id}] — ${itemStatus(item)}`, `  원본: ${item.sources.join(", ")}`];
  for (const note of item.notes) lines.push(`  · ${note}`);
  for (const change of item.changes) {
    for (const flag of change.exposure) lines.push(`  ! ${change.displayPath}:${flag.line} ${flag.kind}: ${flag.text}`);
    if (change.changed) lines.push(change.diff.trimEnd().replace(/^/gm, "    "));
  }
  return lines.join("\n");
}

async function repoFor(args: CaptureArgs): Promise<string | null> {
  // 개발 빌드는 out/main/cli.js에서 위로 올라가면 레포다. 설치본은 repo.json·HM_REPO가 알려 준다.
  return resolveRepoRoot({ explicit: args.repo, startDirs: [path.dirname(process.argv[1] ?? "."), process.cwd()] });
}

export async function runCaptureCli(argv: string[]): Promise<number> {
  let args: CaptureArgs;
  try {
    args = parseCaptureArgs(argv);
  } catch (error) {
    if (!(error instanceof CaptureUsageError)) throw error;
    process.stderr.write(`${error.message}\n\n사용법:\n${CAPTURE_USAGE}\n`);
    return 2;
  }
  const repoRoot = await repoFor(args);
  if (!repoRoot) {
    process.stderr.write("harness-manager 레포를 찾지 못했습니다. --repo <경로>나 HM_REPO를 주세요.\n");
    return 2;
  }

  if (args.command === "validate") {
    const reports = await validateManifest(repoRoot);
    if (args.json) process.stdout.write(`${JSON.stringify(reports)}\n`);
    else {
      for (const report of reports) {
        process.stdout.write(`${report.ok ? "OK " : "ERR"} ${report.path}\n`);
        for (const error of report.errors) process.stdout.write(`    오류: ${error}\n`);
        for (const warning of report.warnings) process.stdout.write(`    경고: ${warning}\n`);
      }
    }
    return reports.every((report) => report.ok) ? 0 : 3;
  }

  const plan = await planCapture(repoRoot);
  const items = args.only ? plan.items.filter((item) => args.only!.includes(item.id)) : plan.items;
  if (!args.apply) {
    if (args.json) process.stdout.write(`${JSON.stringify({ ...plan, items })}\n`);
    else {
      const head = [`레포: ${repoRoot}`, ...plan.warnings.map((warning) => `경고: ${warning}`)];
      process.stdout.write(`${[...head, "", ...items.map(formatItem)].join("\n\n")}\n`);
    }
    return 0;
  }
  const fingerprints = Object.fromEntries(items.map((item) => [item.id, item.fingerprint]));
  let result;
  try {
    result = await applyCapture(repoRoot, args.only!, fingerprints);
  } catch (error) {
    if (!(error instanceof CaptureRequestError) && !(error instanceof ConflictError)) throw error;
    process.stderr.write(`적용하지 않았습니다: ${error.message}\n`);
    return 4;
  }
  process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `적용함: ${result.written.join(", ") || "(쓴 파일 없음)"}\n`);
  return 0;
}
