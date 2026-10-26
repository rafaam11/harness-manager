/**
 * hm-cli — 앱 없이(또는 다른 앱에서) 엔진을 부르는 진입점. Electron을 import하지 않는다:
 * 개발에서는 `node out/main/cli.js`, 설치본에서는 `~/.harness-manager/bin/hm.cmd`가
 * `ELECTRON_RUN_AS_NODE=1`로 앱 실행 파일을 node처럼 띄워 이 파일을 돌린다.
 *
 * 출력 규약: 결과는 stdout, 진단은 stderr. 종료 코드 0은 "명령이 끝까지 돌았다"이지 "모든 레포가 성공했다"가
 * 아니다 — 레포 실패는 결과 JSON에 담긴다. 2는 사용법 오류다.
 */
import type { RepoSyncReport } from "@shared/repo-sync-types";
import { REPO_FAIL_LABELS, REPO_SKIP_LABELS } from "@shared/repo-sync-types";
import { REPO_SYNC_DIR } from "./config.js";
import { lastRepoSyncReport, startRepoSync } from "./services/repo-sync/runner.js";

const USAGE = `사용법:
  hm repos sync --paths <경로> [<경로>…] [--force] [--concurrency N] [--label 이름] [--wait-ms N] [--json]
  hm repos sync --stdin [--json]        stdin: {"paths":[…],"force"?:bool,"label"?:str,"waitMs"?:num,"concurrency"?:num}
  hm repos summary --paths <경로> [<경로>…] [--json]

  --wait-ms N  N밀리초 뒤 그때까지의 보고서를 출력한다(남은 레포는 pending). 프로세스는 남은 레포를 끝까지
               처리해 기록한 뒤 종료한다.`;

class UsageError extends Error {}

export interface ParsedArgs {
  command: "sync" | "summary";
  paths: string[];
  stdin: boolean;
  force: boolean;
  json: boolean;
  label?: string;
  concurrency?: number;
  waitMs?: number;
}

function positiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isInteger(parsed) || parsed < 0) throw new UsageError(`${flag}에는 0 이상의 정수가 필요합니다.`);
  return parsed;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [group, command, ...rest] = argv;
  if (group !== "repos" || (command !== "sync" && command !== "summary")) throw new UsageError("알 수 없는 명령입니다.");
  const parsed: ParsedArgs = { command, paths: [], stdin: false, force: false, json: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    switch (arg) {
      case "--paths":
        while (index + 1 < rest.length && !rest[index + 1]!.startsWith("--")) {
          parsed.paths.push(rest[index + 1]!);
          index += 1;
        }
        break;
      case "--stdin":
        parsed.stdin = true;
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--label":
        parsed.label = rest[index + 1];
        if (!parsed.label) throw new UsageError("--label에는 값이 필요합니다.");
        index += 1;
        break;
      case "--concurrency":
        parsed.concurrency = Math.max(1, positiveInteger(arg, rest[index + 1]));
        index += 1;
        break;
      case "--wait-ms":
        parsed.waitMs = positiveInteger(arg, rest[index + 1]);
        index += 1;
        break;
      default:
        throw new UsageError(`알 수 없는 옵션: ${arg}`);
    }
  }
  return parsed;
}

/** stdin JSON이 플래그를 덮는다. multi-cli-work처럼 경로에 공백·한글이 많은 호출자는 이쪽이 안전하다. */
export function applyStdinRequest(parsed: ParsedArgs, raw: string): ParsedArgs {
  let request: unknown;
  try {
    request = JSON.parse(raw);
  } catch {
    throw new UsageError("stdin이 JSON이 아닙니다.");
  }
  if (typeof request !== "object" || request === null) throw new UsageError("stdin JSON은 객체여야 합니다.");
  const { paths, force, label, waitMs, concurrency } = request as Record<string, unknown>;
  if (!Array.isArray(paths) || !paths.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new UsageError("stdin JSON의 paths는 비어 있지 않은 문자열 배열이어야 합니다.");
  }
  const next: ParsedArgs = { ...parsed, paths: paths as string[] };
  if (force !== undefined) next.force = force === true;
  if (typeof label === "string" && label) next.label = label;
  if (waitMs !== undefined) next.waitMs = positiveInteger("waitMs", String(waitMs));
  if (concurrency !== undefined) next.concurrency = Math.max(1, positiveInteger("concurrency", String(concurrency)));
  return next;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

export function formatReport(report: RepoSyncReport): string {
  const rows = report.results.map((result) => {
    let detail = "";
    if (result.status === "updated") detail = `${result.commits ?? 0}커밋`;
    else if (result.status === "skipped" && result.reason) detail = REPO_SKIP_LABELS[result.reason];
    else if (result.status === "failed") {
      detail = `${result.failKind ? REPO_FAIL_LABELS[result.failKind] : "오류"}${result.error ? ` — ${result.error}` : ""}`;
    }
    return `${result.status.padEnd(10)} ${result.path}${detail ? `  (${detail})` : ""}${result.cached ? "  [기록 재사용]" : ""}`;
  });
  const pending = report.pending.map((entry) => `${"pending".padEnd(10)} ${entry}`);
  return [report.summary, "", ...rows, ...pending].join("\n");
}

function write(report: RepoSyncReport, json: boolean): void {
  // JSON은 한 줄로 낸다. 호출자는 첫 줄만 읽고 프로세스 종료를 기다리지 않아도 된다(--wait-ms).
  process.stdout.write(json ? `${JSON.stringify(report)}\n` : `${formatReport(report)}\n`);
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
    if (parsed.stdin) parsed = applyStdinRequest(parsed, await readStdin());
    if (parsed.paths.length === 0) throw new UsageError("레포 경로가 없습니다(--paths 또는 --stdin).");
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    return 2;
  }

  if (parsed.command === "summary") {
    write(await lastRepoSyncReport(parsed.paths, REPO_SYNC_DIR), parsed.json);
    return 0;
  }

  const run = startRepoSync({
    paths: parsed.paths,
    force: parsed.force,
    label: parsed.label,
    concurrency: parsed.concurrency,
    stateDir: REPO_SYNC_DIR,
  });
  if (parsed.waitMs === undefined) {
    write(await run.done, parsed.json);
    return 0;
  }
  let timer: NodeJS.Timeout | undefined;
  const early = await Promise.race([
    run.done,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), parsed.waitMs);
    }),
  ]);
  clearTimeout(timer);
  write(early ?? run.snapshot(), parsed.json);
  // 남은 레포도 끝까지 돌려 state.json에 남긴다. 다음 세션의 요약과 쿨다운이 그 기록을 쓴다.
  await run.done;
  return 0;
}

// vitest가 import할 때는 실행하지 않는다.
if (!process.env.VITEST) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`hm: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
