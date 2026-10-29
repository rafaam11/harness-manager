import fs from "node:fs/promises";
import { parseDefinition, ordinaryFiles } from "./workbench/definition.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ProfileBundle,
  ProfileDocument,
  ProfileSyncPreview,
  ProfileSyncStatus,
} from "@shared/setup-profile-types";
import { SetupProfileStore } from "./setup-profiles.js";
import {
  bundleProfile,
  documentFingerprint,
  parseBundle,
  readDocument,
  readProfileFile,
  stringify,
  writeDocument,
  writeProfileFile,
} from "./profile-document.js";
import { findOnPath } from "../providers/provider-launch.js";
import { refreshWindowsEnvironment } from "../platform-env.js";
import {
  processRunner,
  type CommandRunner,
  type LogSink,
} from "./install/exec.js";
import { RequestError } from "../ipc-validation.js";
import { withLock } from "../lib/lock.js";
import { unifiedDiff } from "./capture/text.js";
import { isCloudSynced, readCloudRoots } from "./repo-sync/cloud.js";

const FILE = "profile.hmprofile.json";
interface Link {
  repository: string;
  head: string | null;
  base: ProfileBundle | null;
}
interface Snapshot {
  cwd: string;
  head: string | null;
  branch: string;
  bundle: ProfileBundle | null;
}
interface SyncPlan {
  id: string;
  fingerprint: string;
  link: Link;
  remote: Snapshot;
  document: ProfileDocument;
  merged: ProfileBundle;
  preview: ProfileSyncPreview;
}
const flatten = (bundle: ProfileBundle | null) =>
  Object.fromEntries([
    ...Object.entries(bundle?.files ?? {}).map(([k, v]) => [`files/${k}`, v]),
    ...Object.entries(bundle?.personal ?? {}).map(([k, v]) => [
      `personal/${k}`,
      v,
    ]),
  ]);
const unflatten = (
  name: string,
  flat: Record<string, string>,
): ProfileBundle => ({
  format: "harness-manager-profile",
  version: flat["files/home/cli-settings.v1.json"] ? 3 : flat["files/home/components.v2.json"] ? 2 : 1,
  name,
  files: Object.fromEntries(
    Object.entries(flat)
      .filter(([k]) => k.startsWith("files/"))
      .map(([k, v]) => [k.slice(6), v]),
  ),
  personal: Object.fromEntries(
    Object.entries(flat)
      .filter(([k]) => k.startsWith("personal/"))
      .map(([k, v]) => [k.slice(9), v]),
  ),
});

/** 사용자 Git 폴더 대신 매번 독립 사본을 준비한다. fetch/reset으로 사용자의 작업을 덮지 않는다. */
export class ProfileSync {
  private plans = new Map<string, SyncPlan>();
  async receiveAutomatic(id: string, signal: AbortSignal): Promise<string> {
    if (!await this.link(id)) return "원격 프로필 연결 없음";
    const preview = await this.preview(id, "receive", signal);
    if (preview.conflicts.length) return "원격 프로필 충돌 · 수동 검토 필요";
    const plan = this.plans.get(preview.token)!;
    const before = plan.document.files, after = plan.merged.files;
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => before[key] !== after[key]);
    if (!changed.length) { this.plans.delete(preview.token); return "원격 프로필과 동일"; }
    if (changed.some(key => key !== "home/components.v2.json") || stringify(plan.merged.personal) !== stringify(Object.fromEntries(Object.entries(plan.document.personal).filter(([key]) => plan.document.portable.includes(key))))) return "원격 설정·개인 항목 변경 · 수동 수신 필요";
    const old = parseDefinition(before["home/components.v2.json"] ?? null), next = parseDefinition(after["home/components.v2.json"] ?? null);
    if (!old.automatic || next.automatic !== old.automatic || old.components.length !== next.components.length) return "원격 정책·항목 추가/제거 · 수동 수신 필요";
    for (const item of next.components) {
      const previous = old.components.find(c => c.id === item.id);
      if (!previous || previous.kind !== item.kind || previous.source.kind !== item.source.kind || previous.source.repository !== item.source.repository || previous.source.directory !== item.source.directory || stringify(previous.targets) !== stringify(item.targets) || !ordinaryFiles(item) || !ordinaryFiles(previous) || Object.keys(previous.files).some(f => !(f in item.files))) return "원격 출처·실행 코드·적용 대상 변경 · 수동 수신 필요";
    }
    await this.apply(id, preview.token, {}, signal); return "일반 문서 원격 프로필 수신 완료";
  }
  constructor(
    private store: SetupProfileStore,
    private runner: CommandRunner = processRunner,
    private env = process.env,
  ) {}
  private folder(id: string) {
    return path.join(this.store.stateDir, "profiles", id);
  }
  private async link(id: string): Promise<Link | null> {
    return fs
      .readFile(path.join(this.folder(id), "github.json"), "utf8")
      .then((text) => JSON.parse(text) as Link)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
  }
  private async run(
    command: string,
    args: string[],
    signal: AbortSignal,
    log: LogSink = () => undefined,
    cwd?: string,
  ): Promise<string> {
    let output = "";
    let overflow = false;
    const result = await this.runner.run(
      {
        command,
        args,
        cwd,
        env: {
          ...this.env,
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "never",
          GH_PROMPT_DISABLED: "1",
        },
        timeoutMs: 5 * 60_000,
      },
      (stream, line) => {
        if (stream === "stdout" && !overflow) output += line + "\n";
        if (output.length > 20 * 1024 * 1024) {
          overflow = true;
          output = "";
        }
        log(stream, line);
      },
      signal,
    );
    if (overflow) throw new RequestError(422, "GitHub 응답이 너무 큽니다");
    if (signal.aborted) throw new Error("동기화를 취소했습니다");
    if (result.notFound)
      throw new RequestError(
        422,
        `${command}가 필요합니다. GitHub 도구 준비를 실행하세요.`,
      );
    if (result.code !== 0 || result.timedOut)
      throw new RequestError(
        422,
        `${command} ${args[0]} 실패. 로그인·권한·네트워크를 확인하세요.`,
      );
    return output.trim();
  }
  private git(args: string[], cwd: string, signal: AbortSignal) {
    return this.run(
      "git",
      [
        "-c",
        "core.hooksPath=",
        "-c",
        "credential.helper=",
        "-c",
        "credential.helper=!gh auth git-credential",
        ...args,
      ],
      signal,
      undefined,
      cwd,
    );
  }
  private async info(
    repository: string,
    signal: AbortSignal,
  ): Promise<{ defaultBranchRef: { name: string } | null }> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
      throw new RequestError(400, "저장소는 소유자/이름 형식이어야 합니다");
    const info = JSON.parse(
      await this.run(
        "gh",
        ["repo", "view", repository, "--json", "isPrivate,defaultBranchRef"],
        signal,
      ),
    );
    if (info.isPrivate !== true)
      throw new RequestError(
        409,
        "비공개 저장소만 연결·동기화할 수 있습니다. 개인 설정을 전송하지 않았습니다.",
      );
    return info;
  }
  async tools(signal: AbortSignal, log: LogSink): Promise<void> {
    if (process.platform !== "win32")
      throw new RequestError(
        422,
        "Git과 GitHub CLI를 운영체제 패키지 관리자로 설치한 뒤 다시 연결하세요",
      );
    for (const [bin, id] of [
      ["git", "Git.Git"],
      ["gh", "GitHub.cli"],
    ]) {
      this.env = await refreshWindowsEnvironment(this.env);
      if (await findOnPath(bin, process.platform, this.env)) {
        log("info", `${bin}: 이미 설치되어 있습니다`);
        continue;
      }
      await this.run(
        "winget",
        [
          "install",
          "--id",
          id,
          "--exact",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
        signal,
        log,
      );
    }
  }
  async login(signal: AbortSignal, log: LogSink): Promise<void> {
    await this.run(
      "gh",
      [
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--web",
      ],
      signal,
      log,
    );
  }
  async status(id: string, signal: AbortSignal): Promise<ProfileSyncStatus> {
    const profile = await this.store.get(id);
    const link = await this.link(id);
    try {
      await this.run("git", ["--version"], signal);
      const account = await this.run(
        "gh",
        ["api", "user", "--jq", ".login"],
        signal,
      );
      if (!link)
        return {
          connected: false,
          available: true,
          account,
          detail: "비공개 저장소를 만들거나 연결할 수 있습니다",
        };
      const info = await this.info(link.repository, signal);
      const ref = info.defaultBranchRef?.name;
      const head = ref
        ? await this.run(
            "gh",
            [
              "api",
              `repos/${link.repository}/commits/${encodeURIComponent(ref)}`,
              "--jq",
              ".sha",
            ],
            signal,
          )
        : null;
      const local = flatten(bundleProfile(profile.name, await readDocument(profile)).bundle);
      const baseline = flatten(link.base);
      return {
        connected: true,
        available: true,
        account,
        repository: link.repository,
        changed: head !== link.head,
        outgoing: [...new Set([...Object.keys(local), ...Object.keys(baseline)])].some(key => local[key] !== baseline[key]),
        detail:
          head !== link.head
            ? "원격 변경이 있습니다. 받기 미리보기를 확인하세요."
            : "원격 변경 없음 · 보내기·받기는 수동으로 실행합니다",
      };
    } catch (error) {
      return {
        connected: Boolean(link),
        available: false,
        repository: link?.repository,
        detail: (error as Error).message,
      };
    }
  }
  async connect(
    id: string,
    repository: string,
    create: boolean,
    signal: AbortSignal,
  ): Promise<ProfileSyncStatus> {
    let profile = await this.store.get(id);
    if (
      profile.kind === "legacy" ||
      profile.archived
    )
      throw new RequestError(409, "개인 프로필을 먼저 만드세요");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
      throw new RequestError(400, "저장소는 소유자/이름 형식이어야 합니다");
    if (create)
      await this.run(
        "gh",
        [
          "repo",
          "create",
          repository,
          "--private",
          "--description",
          "Harness Manager personal profile",
        ],
        signal,
      );
    await this.info(repository, signal);
    if (profile.kind === "builtin") {
      const prepared = await this.store.create("내 설정", profile.id);
      id = prepared.activeId;
      profile = await this.store.get(id);
    }
    await withLock(() =>
      writeProfileFile(
        this.folder(id),
        "github.json",
        stringify({ repository, head: null, base: null }),
      ),
    );
    return this.status(id, signal);
  }
  private async snapshot(link: Link, signal: AbortSignal): Promise<Snapshot> {
    const info = await this.info(link.repository, signal);
    const parent = path.join(this.store.stateDir, "profile-sync");
    if (
      isCloudSynced(
        parent,
        await readCloudRoots(this.env, process.platform),
        [],
      )
    )
      throw new RequestError(
        409,
        "클라우드 동기화 폴더 밖에서 GitHub 동기화를 사용하세요",
      );
    await fs.mkdir(parent, { recursive: true });
    const cwd = path.join(parent, randomUUID());
    await this.git(
      [
        "clone",
        "--single-branch",
        "--",
        `https://github.com/${link.repository}.git`,
        cwd,
      ],
      parent,
      signal,
    );
    const branch = info.defaultBranchRef?.name ?? "main";
    const head = info.defaultBranchRef
      ? await this.git(["rev-parse", "HEAD"], cwd, signal)
      : null;
    if (!head) await this.git(["checkout", "-b", branch], cwd, signal);
    const text = await readProfileFile(cwd, FILE, 16 * 1024 * 1024);
    if (head && text === null)
      throw new RequestError(
        422,
        "HM 프로필 파일이 없는 저장소입니다. 비어 있는 새 저장소를 사용하세요.",
      );
    return {
      cwd,
      branch,
      head,
      bundle: text === null ? null : parseBundle(text),
    };
  }
  async preview(
    id: string,
    direction: "send" | "receive",
    signal: AbortSignal,
  ): Promise<ProfileSyncPreview> {
    const profile = await this.store.get(id);
    const document = await readDocument(profile);
    const link = await this.link(id);
    if (!link) throw new RequestError(409, "GitHub 저장소를 먼저 연결하세요");
    const { bundle: local, notes } = bundleProfile(profile.name, document);
    const remote = await this.snapshot(link, signal);
    if (direction === "send" && remote.head !== link.head)
      throw new RequestError(
        409,
        "원격이 변경되었습니다. 먼저 받기 미리보기를 확인하세요.",
      );
    if (direction === "receive" && !remote.bundle)
      throw new RequestError(
        409,
        "원격 프로필이 없습니다. 먼저 보내기를 실행하세요.",
      );
    const before = flatten(local),
      other = flatten(remote.bundle),
      base = flatten(link.base),
      merged = { ...before };
    const conflicts: string[] = [];
    if (direction === "receive")
      for (const file of new Set([
        ...Object.keys(before),
        ...Object.keys(other),
        ...Object.keys(base),
      ])) {
        if (!link.base || before[file] === base[file]) {
          if (other[file] === undefined) delete merged[file];
          else merged[file] = other[file];
        } else if (other[file] !== base[file] && before[file] !== other[file])
          conflicts.push(file);
      }
    const target = direction === "send" ? before : merged;
    const comparison = direction === "send" ? other : before;
    const changes = [
      ...new Set([
        ...Object.keys(comparison),
        ...Object.keys(target),
        ...conflicts,
      ]),
    ]
      .filter(
        (key) => comparison[key] !== target[key] || conflicts.includes(key),
      )
      .map((file) => ({
        file,
        diff: unifiedDiff(
          file,
          comparison[file] ?? null,
          conflicts.includes(file) ? (other[file] ?? "") : (target[file] ?? ""),
        ),
      }));
    const token = randomUUID();
    const preview: ProfileSyncPreview = {
      token,
      direction,
      conflicts,
      changes,
      notes: [
        ...notes,
        ...(!link.base && direction === "receive"
          ? [
              "처음 받기: 원격 프로필을 기준으로 저장하며 현재 프로필은 백업합니다.",
            ]
          : []),
      ],
    };
    if (this.plans.size >= 20)
      this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(token, {
      id,
      link,
      remote,
      document,
      fingerprint: documentFingerprint(document),
      merged: unflatten(profile.name, target),
      preview,
    });
    return preview;
  }
  async apply(
    id: string,
    token: string,
    choices: Record<string, "local" | "remote">,
    signal: AbortSignal,
  ): Promise<ProfileSyncStatus> {
    const plan = this.plans.get(token);
    if (!plan || plan.id !== id)
      throw new RequestError(409, "동기화 미리보기를 다시 만드세요");
    const profile = await this.store.get(id);
    if (
      profile.archived ||
      profile.kind === "builtin" ||
      profile.kind === "legacy"
    )
      throw new RequestError(409, "활성 개인 프로필만 동기화할 수 있습니다");
    const check = async () => {
      if (
        documentFingerprint(await readDocument(profile)) !== plan.fingerprint ||
        stringify(await this.link(id)) !== stringify(plan.link)
      )
        throw new RequestError(
          409,
          "프로필이나 연결이 변경되었습니다. 다시 미리보기 하세요.",
        );
    };
    await check();
    await this.info(plan.link.repository, signal);
    const refs = await this.git(
      ["ls-remote", "origin", `refs/heads/${plan.remote.branch}`],
      plan.remote.cwd,
      signal,
    );
    if ((refs.split(/\s+/)[0] || null) !== plan.remote.head)
      throw new RequestError(
        409,
        "원격이 변경되었습니다. 다시 미리보기 하세요.",
      );
    if (plan.preview.direction === "send") {
      await writeProfileFile(plan.remote.cwd, FILE, stringify(plan.merged));
      await this.git(["add", "--", FILE], plan.remote.cwd, signal);
      if (
        await this.git(
          ["diff", "--cached", "--name-only"],
          plan.remote.cwd,
          signal,
        )
      ) {
        const user = JSON.parse(await this.run("gh", ["api", "user"], signal));
        await this.git(
          [
            "-c",
            `user.name=${user.login}`,
            "-c",
            `user.email=${user.id}+${user.login}@users.noreply.github.com`,
            "commit",
            "-m",
            "chore: update personal setup profile",
          ],
          plan.remote.cwd,
          signal,
        );
        await this.info(plan.link.repository, signal);
        await this.git(
          ["push", "origin", `HEAD:refs/heads/${plan.remote.branch}`],
          plan.remote.cwd,
          signal,
        );
      }
      const head = await this.git(
        ["rev-parse", "HEAD"],
        plan.remote.cwd,
        signal,
      );
      await withLock(async () => {
        await check();
        await writeProfileFile(
          this.folder(id),
          "github.json",
          stringify({ ...plan.link, head, base: plan.merged }),
        );
      });
    } else {
      const flat = flatten(plan.merged),
        remote = flatten(plan.remote.bundle);
      if (
        Object.keys(choices).some(
          (key) => !plan.preview.conflicts.includes(key),
        )
      )
        throw new RequestError(400, "알 수 없는 충돌 항목입니다");
      for (const file of plan.preview.conflicts) {
        if (choices[file] !== "local" && choices[file] !== "remote")
          throw new RequestError(400, `충돌 해결을 선택하세요: ${file}`);
        if (choices[file] === "remote") {
          if (remote[file] === undefined) delete flat[file];
          else flat[file] = remote[file];
        }
      }
      const merged = parseBundle(stringify(unflatten(profile.name, flat)));
      const personal = { ...plan.document.personal, ...merged.personal };
      // 원격에서 지운 이동 대상은 로컬에도 비운다. 이동하지 않던 개인 설정은 보존한다.
      for (const key of plan.document.portable)
        if (!(key in merged.personal))
          personal[key] = key.endsWith(".json") ? "{}\n" : "";
      await withLock(async () => {
        await check();
        await writeDocument(profile, {
          ...plan.document,
          files: merged.files,
          personal,
          portable: Object.keys(merged.personal),
        });
        await writeProfileFile(
          this.folder(id),
          "github.json",
          stringify({
            ...plan.link,
            head: plan.remote.head,
            base: plan.remote.bundle,
          }),
        );
      });
    }
    this.plans.delete(token);
    return this.status(id, signal);
  }
  /** 전송은 이 서비스가 맡고, 수신 파일과 PC 적용은 작업대의 같은 저널로 넘긴다. */
  async prepareReceive(id: string, signal: AbortSignal) {
    const preview = await this.preview(id, "receive", signal);
    const plan = this.plans.get(preview.token)!;
    this.plans.delete(preview.token);
    if (preview.conflicts.length) throw new RequestError(409, `같은 파일이 양쪽에서 바뀌었습니다: ${preview.conflicts.join(", ")}. 앱 설정의 고급 프로필에서 충돌을 해결한 뒤 다시 받으세요.`);
    const profile = await this.store.get(id);
    const merged = parseBundle(stringify(plan.merged));
    const personal = { ...plan.document.personal, ...merged.personal };
    for (const key of plan.document.portable) if (!(key in merged.personal)) personal[key] = key.endsWith(".json") ? "{}\n" : "";
    const document = { ...plan.document, files: merged.files, personal, portable: Object.keys(merged.personal) };
    const checkLocal = async () => {
      if (documentFingerprint(await readDocument(profile)) !== plan.fingerprint || stringify(await this.link(id)) !== stringify(plan.link)) throw new RequestError(409, "내 설정이나 연결이 변경되었습니다. 다시 검토하세요.");
    };
    return { profile, before: plan.document, document,
      metadata: { path: path.join(this.folder(id), "github.json"), before: await readProfileFile(this.folder(id), "github.json"), after: stringify({ ...plan.link, head: plan.remote.head, base: plan.remote.bundle }) },
      checkLocal,
      verify: async (signal: AbortSignal) => {
        await checkLocal(); await this.info(plan.link.repository, signal);
        const refs = await this.git(["ls-remote", "origin", `refs/heads/${plan.remote.branch}`], plan.remote.cwd, signal);
        if ((refs.split(/\s+/)[0] || null) !== plan.remote.head) throw new RequestError(409, "다른 PC의 설정이 바뀌었습니다. 다시 검토하세요.");
      },
    };
  }
}
