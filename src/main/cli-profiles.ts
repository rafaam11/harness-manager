import path from "node:path";
import { APP_STATE_DIR } from "./config.js";
import { resolveRepoRoot } from "./services/capture/capture.js";
import { SetupProfileStore } from "./services/setup-profiles.js";
export const PROFILES_USAGE = `  hm profiles list [--json]
  hm profiles create <이름> [--from <프로필 ID>] [--json]
  hm profiles connect <이름> <프로필 폴더> [--json]
  hm profiles use <프로필 ID> [--json]
                                    사용자 프로필 생성·연결·선택 (core/dev/full은 settings --profile)`;

export async function runProfilesCli(argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const args = argv.slice(1).filter((arg) => arg !== "--json");
  const [action = "list", name, third, fourth] = args;
  if (!(action === "list" && args.length <= 1 || action === "use" && args.length === 2 || action === "connect" && args.length === 3 || action === "create" && (args.length === 2 || args.length === 4 && third === "--from"))) {
    process.stderr.write(PROFILES_USAGE + "\n"); return 2;
  }
  const repo = await resolveRepoRoot({ startDirs: [process.cwd(), path.dirname(process.argv[1] ?? ".")] });
  if (!repo) throw new Error("HM 앱 레포를 찾지 못했습니다. HM_REPO를 지정하세요.");
  const store = new SetupProfileStore(APP_STATE_DIR, repo);
  const result = action === "use" ? await store.select(name) : action === "create" ? await store.create(name, fourth ?? "default") : action === "connect" ? await store.connect(name, path.resolve(third)) : await store.list();
  process.stdout.write(json ? JSON.stringify(result) + "\n" : result.profiles.map((profile) => `${profile.id === result.activeId ? "*" : " "} ${profile.id} · ${profile.name}\n  ${profile.root}`).join("\n") + "\n");
  return 0;
}
