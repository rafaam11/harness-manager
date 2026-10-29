import { WorkbenchService, defaultWorkbenchDependencies } from "./services/workbench/service.js";
import { resolveRepoRoot } from "./services/capture/capture.js";
import { RequestError } from "./ipc-validation.js";
export const WORKBENCH_USAGE = `  hm components [--json]                       구성요소와 양쪽 CLI 상태
  hm components apply --ids <id,…> [--yes] [--json]
  hm components migrate [--automatic] [--yes] [--json]
  hm updates [--json]                          출처별 업데이트 확인
  hm updates --id <id> [--yes] [--json]         프로필 업데이트 미리보기·저장
  hm history [--json]                          설정 변경 이력
  hm restore --id <id> [--yes] [--json]         복원 미리보기·실행`;
export async function runWorkbenchCli(argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  try {
    const [group, ...args] = argv; let id: string | undefined; let ids: string[] = []; let action = "list";
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      if (flag === "--id" || flag === "--ids") { const value = args[++i]; if (!value || value.startsWith("--")) throw new RequestError(400, `${flag} 값이 필요합니다`); if (flag === "--id") id = value; else ids = value.split(","); }
      else if (["apply", "migrate", "list"].includes(flag!)) action = flag!;
      else if (!["--yes", "--json", "--automatic"].includes(flag!)) throw new RequestError(400, `알 수 없는 옵션: ${flag}`);
    }
    const service = new WorkbenchService(defaultWorkbenchDependencies(await resolveRepoRoot()));
    let result: unknown;
    if (group === "history") result = await service.historyList();
    else if (group === "components" && action === "list") result = await service.snapshot();
    else if (group === "updates" && !id) result = await service.updates();
    else {
      const plan = group === "restore" && id ? await service.restorePreview(id) : group === "updates" && id ? await service.updatePreview(id) : group === "components" && action === "migrate" ? await service.migrate(args.includes("--automatic")) : group === "components" && action === "apply" && ids.length ? await service.preview(ids) : null;
      if (!plan) throw new RequestError(400, WORKBENCH_USAGE);
      if (args.includes("--yes")) { await service.apply(plan.token); result = { applied: true, title: plan.title }; }
      else result = plan;
    }
    process.stdout.write(JSON.stringify(result, null, json ? undefined : 2) + "\n"); return 0;
  } catch (error) {
    const message = (error as Error).message;
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n"); else process.stderr.write(message + "\n");
    return error instanceof RequestError && error.statusCode === 400 ? 2 : 4;
  }
}
