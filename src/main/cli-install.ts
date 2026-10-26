import path from "node:path";
import { INSTALL_OUTCOME_LABELS, type InstallPlan } from "@shared/install-types";
import { PROFILES, type Profile } from "@shared/manifest-types";
import { resolveRepoRoot } from "./services/capture/capture.js";
import { defaultInstallContext, planInstallWith, runInstallWith } from "./services/install/engine.js";

export const INSTALL_USAGE = `  hm install [--dry-run] [--only <id,…>] [--profile p] [--self-source directory|github] [--repo <레포>] [--json]
                                    할 일 미리보기(기본). 정상이 아닌 step과 그 명령·파일 diff를 보인다
  hm install --run --only <id,…|all> --yes [...]   고른 step을 실행한다(실패한 step이 있으면 종료 코드 5)`;

class InstallUsageError extends Error {}

interface InstallArgs {
  run: boolean;
  yes: boolean;
  json: boolean;
  only?: string[];
  profile?: Profile;
  selfSource?: "directory" | "github";
  repo?: string;
}

export function parseInstallArgs(argv: string[]): InstallArgs {
  const [command, ...rest] = argv;
  if (command !== "install") throw new InstallUsageError("알 수 없는 명령입니다.");
  const parsed: InstallArgs = { run: false, yes: false, json: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const value = rest[index + 1];
    switch (arg) {
      case "--dry-run":
        parsed.run = false;
        break;
      case "--run":
        parsed.run = true;
        break;
      case "--yes":
        parsed.yes = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--only":
        parsed.only = (value ?? "").split(",").map((id) => id.trim()).filter(Boolean);
        if (parsed.only.length === 0) throw new InstallUsageError("--only에는 step id가 필요합니다.");
        index += 1;
        break;
      case "--profile":
        if (!PROFILES.includes(value as Profile)) throw new InstallUsageError("--profile은 core, dev, full 중 하나입니다.");
        parsed.profile = value as Profile;
        index += 1;
        break;
      case "--self-source":
        if (value !== "directory" && value !== "github") throw new InstallUsageError("--self-source는 directory나 github입니다.");
        parsed.selfSource = value;
        index += 1;
        break;
      case "--repo":
        if (!value) throw new InstallUsageError("--repo에는 경로가 필요합니다.");
        parsed.repo = value;
        index += 1;
        break;
      default:
        throw new InstallUsageError(`알 수 없는 옵션: ${arg}`);
    }
  }
  if (parsed.run && (!parsed.only || !parsed.yes)) throw new InstallUsageError("--run은 --only로 step을 고르고 --yes로 확인해야 합니다.");
  return parsed;
}

export function formatInstallPlan(plan: InstallPlan, only?: string[]): string {
  const steps = plan.steps.filter((step) =>
    only ? only.includes(step.id) : step.state !== "ok" && step.state !== "skipped" && step.state !== "info",
  );
  const lines = [`프로필 ${plan.profile} · 레포 ${plan.repoRoot}`, steps.length === 0 ? "할 일이 없습니다." : ""];
  for (const step of steps) {
    const tag = step.manual ? "직접" : step.actionable ? "실행" : "정상";
    lines.push(`[${tag}] ${step.id} — ${step.title}: ${step.detail}`);
    for (const action of step.actions) {
      lines.push(`    ${action.kind === "command" ? "$" : action.kind === "file" ? "✎" : "·"} ${action.summary}`);
      if (action.diff) lines.push(action.diff.trimEnd().replace(/^/gm, "      "));
    }
  }
  return lines.join("\n");
}

export async function runInstallCli(argv: string[]): Promise<number> {
  let args: InstallArgs;
  try {
    args = parseInstallArgs(argv);
  } catch (error) {
    if (!(error instanceof InstallUsageError)) throw error;
    process.stderr.write(`${error.message}\n\n사용법:\n${INSTALL_USAGE}\n`);
    return 2;
  }
  const repoRoot = await resolveRepoRoot({ explicit: args.repo, startDirs: [path.dirname(process.argv[1] ?? "."), process.cwd()] });
  if (!repoRoot) {
    process.stderr.write("harness-manager 레포를 찾지 못했습니다. --repo <경로>나 HM_REPO를 주세요.\n");
    return 2;
  }
  const ctx = await defaultInstallContext(repoRoot, { profile: args.profile, selfSource: args.selfSource });
  const plan = await planInstallWith(ctx);
  if (!args.run) {
    process.stdout.write(args.json ? `${JSON.stringify(plan)}\n` : `${formatInstallPlan(plan, args.only)}\n`);
    return 0;
  }
  const ids = args.only!.includes("all") ? plan.steps.filter((step) => step.actionable).map((step) => step.id) : args.only!;
  const unknown = ids.filter((id) => !plan.steps.some((step) => step.id === id));
  if (unknown.length > 0) {
    process.stderr.write(`모르는 step: ${unknown.join(", ")}\n`);
    return 2;
  }
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const result = await runInstallWith(
    ctx,
    ids,
    (event) => {
      if (args.json) return;
      if (event.type === "step-start") process.stderr.write(`\n▶ ${event.title} (${event.id})\n`);
      if (event.type === "log") process.stderr.write(`  ${event.line}\n`);
      if (event.type === "step-done") process.stderr.write(`  → ${INSTALL_OUTCOME_LABELS[event.result.outcome]}: ${event.result.detail}\n`);
    },
    controller.signal,
  );
  if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    const rows = result.results.map((entry) => `${INSTALL_OUTCOME_LABELS[entry.outcome]}  ${entry.id}  ${entry.detail}`);
    const cards = result.verify.map((card) => `${card.section}: ${card.summary}`);
    process.stdout.write(`${rows.join("\n")}\n\n${cards.join("\n")}\n`);
  }
  return result.results.some((entry) => entry.outcome === "failed") ? 5 : 0;
}
