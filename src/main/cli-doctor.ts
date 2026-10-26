import path from "node:path";
import { DOCTOR_CARD_LABELS, DOCTOR_CHECK_LABELS, type DoctorReport } from "@shared/doctor-types";
import { PROFILES, type Profile } from "@shared/manifest-types";
import { resolveRepoRoot } from "./services/capture/capture.js";
import { runDoctor } from "./services/doctor/doctor.js";

export const DOCTOR_USAGE = `  hm doctor [--profile core|dev|full] [--all] [--repo <레포>] [--json]   설치·설정 상태 검사(카드 8개)
    --all  정상인 검사도 모두 보인다(기본은 정상이 아닌 것만)`;

class DoctorUsageError extends Error {}

interface DoctorArgs {
  json: boolean;
  all: boolean;
  profile?: Profile;
  repo?: string;
}

export function parseDoctorArgs(argv: string[]): DoctorArgs {
  const [command, ...rest] = argv;
  if (command !== "doctor") throw new DoctorUsageError("알 수 없는 명령입니다.");
  const parsed: DoctorArgs = { json: false, all: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--all") parsed.all = true;
    else if (arg === "--profile") {
      const value = rest[index + 1];
      if (!PROFILES.includes(value as Profile)) throw new DoctorUsageError("--profile은 core, dev, full 중 하나입니다.");
      parsed.profile = value as Profile;
      index += 1;
    } else if (arg === "--repo") {
      parsed.repo = rest[index + 1];
      if (!parsed.repo) throw new DoctorUsageError("--repo에는 경로가 필요합니다.");
      index += 1;
    } else throw new DoctorUsageError(`알 수 없는 옵션: ${arg}`);
  }
  return parsed;
}

export function formatDoctorReport(report: DoctorReport, all: boolean): string {
  if (!report.repoRoot) return report.repoError ?? "레포를 찾지 못했습니다";
  const lines = [`프로필 ${report.profile} · 레포 ${report.repoRoot}`, ""];
  for (const card of report.cards) {
    lines.push(`[${DOCTOR_CARD_LABELS[card.state]}] ${card.label} — ${card.summary}`);
    for (const check of card.checks) {
      if (!all && (check.state === "ok" || check.state === "skipped")) continue;
      lines.push(`    ${DOCTOR_CHECK_LABELS[check.state]}: ${check.title}${check.local ? " (로컬)" : ""} — ${check.detail}`);
    }
  }
  return lines.join("\n");
}

/** 종료 코드는 0이다. 상태는 결과에 담는다(AI 위저드가 JSON을 읽고 판단한다). */
export async function runDoctorCli(argv: string[]): Promise<number> {
  let args: DoctorArgs;
  try {
    args = parseDoctorArgs(argv);
  } catch (error) {
    if (!(error instanceof DoctorUsageError)) throw error;
    process.stderr.write(`${error.message}\n\n사용법:\n${DOCTOR_USAGE}\n`);
    return 2;
  }
  const repoRoot = await resolveRepoRoot({ explicit: args.repo, startDirs: [path.dirname(process.argv[1] ?? "."), process.cwd()] });
  const report = await runDoctor(repoRoot, args.profile);
  process.stdout.write(args.json ? `${JSON.stringify(report)}\n` : `${formatDoctorReport(report, args.all)}\n`);
  return 0;
}
