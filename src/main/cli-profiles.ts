import path from "node:path";
import fs from "node:fs/promises";
import { APP_STATE_DIR } from "./config.js";
import {
  resolveRepoRoot,
  writeFileChecked,
} from "./services/capture/capture.js";
import { SetupProfileStore } from "./services/setup-profiles.js";
import { ProfileSync } from "./services/profile-sync.js";
import {
  bundleProfile,
  parseBundle,
  stringify,
} from "./services/profile-document.js";
import { withLock } from "./lib/lock.js";
import { refreshWindowsEnvironment } from "./platform-env.js";
export const PROFILES_USAGE = `  hm profiles list [--json]
  hm profiles create <이름> [--from <프로필 ID>] [--json]
  hm profiles connect <이름> <프로필 폴더> [--json]
  hm profiles use <프로필 ID> [--json]
  hm profiles rename <ID> <이름> | archive <ID> | restore <ID>
  hm profiles export <ID> <파일.hmprofile.json> [--yes] [--json]
  hm profiles import <파일.hmprofile.json> [--yes] [--json]
  hm profiles github <ID> <소유자/저장소> [--create] --yes
  hm profiles sync <ID> send|receive [--yes] [--prefer local|remote] [--json]
                                    이동·동기화는 미리보기 후 --yes로 적용`;

export async function runProfilesCli(argv: string[]): Promise<number> {
  if (
    [
      "rename",
      "archive",
      "restore",
      "export",
      "import",
      "github",
      "sync",
    ].includes(argv[1])
  )
    return runTransferCli(argv);
  const json = argv.includes("--json");
  const args = argv.slice(1).filter((arg) => arg !== "--json");
  const [action = "list", name, third, fourth] = args;
  if (
    !(
      (action === "list" && args.length <= 1) ||
      (action === "use" && args.length === 2) ||
      (action === "connect" && args.length === 3) ||
      (action === "create" &&
        (args.length === 2 || (args.length === 4 && third === "--from")))
    )
  ) {
    process.stderr.write(PROFILES_USAGE + "\n");
    return 2;
  }
  const repo = await resolveRepoRoot({
    startDirs: [process.cwd(), path.dirname(process.argv[1] ?? ".")],
  });
  const store = new SetupProfileStore(APP_STATE_DIR, repo);
  const result =
    action === "use"
      ? await store.select(name)
      : action === "create"
        ? await store.create(name, fourth ?? "default")
        : action === "connect"
          ? await store.connect(name, path.resolve(third))
          : await store.list();
  process.stdout.write(
    json
      ? JSON.stringify(result) + "\n"
      : result.profiles
          .map(
            (profile) =>
              `${profile.id === result.activeId ? "*" : " "} ${profile.id} · ${profile.name}\n  ${profile.root}`,
          )
          .join("\n") + "\n",
  );
  return 0;
}

async function runTransferCli(argv: string[]): Promise<number> {
  const json = argv.includes("--json"),
    yes = argv.includes("--yes"),
    create = argv.includes("--create");
  const args = argv
    .slice(1)
    .filter((arg) => !["--json", "--yes", "--create"].includes(arg));
  const [action, first, second, third, fourth] = args;
  const store = new SetupProfileStore(
    APP_STATE_DIR,
    await resolveRepoRoot({ startDirs: [process.cwd()] }),
  );
  const sync = new ProfileSync(
    store,
    undefined,
    await refreshWindowsEnvironment(process.env),
  );
  const signal = new AbortController().signal;
  let result: unknown;
  if (action === "rename" && args.length === 3)
    result = await store.update(first, "rename", second);
  else if ((action === "archive" || action === "restore") && args.length === 2)
    result = await store.update(first, action);
  else if (action === "export" && args.length === 3) {
    const editor = await store.editor(first);
    const { bundle, notes } = bundleProfile(
      editor.profile.name,
      editor.document,
    );
    result = {
      file: path.resolve(second),
      files: [...Object.keys(bundle.files), ...Object.keys(bundle.personal)],
      notes,
      applied: yes,
    };
    if (yes)
      await withLock(async () => {
        const before = await fs
          .readFile(second, "utf8")
          .catch((e: NodeJS.ErrnoException) => {
            if (e.code === "ENOENT") return null;
            throw e;
          });
        await writeFileChecked(path.resolve(second), before, stringify(bundle));
      });
  } else if (action === "import" && args.length === 2) {
    if ((await fs.stat(first)).size > 16 * 1024 * 1024)
      throw new Error("프로필 파일은 16 MiB 이하여야 합니다");
    const bundle = parseBundle(await fs.readFile(first, "utf8"));
    result = yes
      ? await store.importBundle(bundle)
      : {
          name: bundle.name,
          files: [
            ...Object.keys(bundle.files),
            ...Object.keys(bundle.personal),
          ],
          applied: false,
        };
  } else if (action === "github" && args.length === 3 && yes)
    result = await sync.connect(first, second, create, signal);
  else if (
    action === "sync" &&
    (args.length === 3 ||
      (args.length === 5 &&
        third === "--prefer" &&
        (fourth === "local" || fourth === "remote"))) &&
    (second === "send" || second === "receive")
  ) {
    const plan = await sync.preview(first, second, signal);
    result = plan;
    if (yes) {
      if (plan.conflicts.length && !fourth)
        throw new Error(
          "충돌이 있습니다. --prefer local 또는 --prefer remote로 명시하세요.",
        );
      result = await sync.apply(
        first,
        plan.token,
        Object.fromEntries(
          plan.conflicts.map((file) => [file, fourth as "local" | "remote"]),
        ),
        signal,
      );
    }
  } else {
    process.stderr.write(PROFILES_USAGE + "\n");
    return 2;
  }
  process.stdout.write(
    JSON.stringify(result, null, json ? undefined : 2) + "\n",
  );
  return 0;
}
