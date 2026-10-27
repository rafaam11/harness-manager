import fs from "node:fs/promises";
import path from "node:path";
import type { RepairSnapshot } from "@shared/repair-types";
import { processRunner, type CommandRunner, type LogSink } from "../install/exec.js";
import { scanExposure } from "../capture/exposure.js";
import { redactInstallText } from "../install/journal.js";
import { readCloudRoots, isCloudSynced } from "../repo-sync/cloud.js";
import type { PrepareRepairSource } from "./session.js";

type SourceResult = NonNullable<RepairSnapshot["source"]>;
const SOURCE_FILE = /^(?:src\/|scripts\/|docs\/|(?:package(?:-lock)?\.json|electron\.vite\.config\.ts|vitest\.config\.ts|tsconfig\.[\w.-]+\.json)$)/;
const PRIVATE_FILE = /(?:^|\/)(?:\.env(?:\.|$)|credentials[^/]*|auth\.json|.*\.local\.[^/]+|profile(?:s)?)(?:\/|$)/i;

export function assertPublishable(files: string[], contents: string[], home: string, env: NodeJS.ProcessEnv, privateTerms: string[] = []): void {
  if (!files.length || files.some((file) => !SOURCE_FILE.test(file) || PRIVATE_FILE.test(file) || file.split("/").includes(".."))) {
    throw new Error("공통 앱 소스 밖의 변경이 있습니다. 개인 프로필·설정은 공개 HM 저장소에 반영하지 않습니다.");
  }
  for (let i = 0; i < contents.length; i++) {
    if (scanExposure(contents[i], { home, privateTerms }).some((flag) => flag.kind === "home-path" || flag.kind === "private-term") || redactInstallText(contents[i], env) !== contents[i] || /-----BEGIN .*PRIVATE KEY-----|\b(?:gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|sk-[\w-]{20,})/.test(contents[i])) {
      throw new Error(`공개하면 안 되는 값이 있을 수 있어 커밋하지 않았습니다: ${files[i]}`);
    }
  }
}

/** 동시 복구의 소스 반영은 하나씩 fetch → merge → 검증 → push한다. 사용자 작업 트리는 수정하지 않는다. */
export function createRepairSource(runner: CommandRunner = processRunner): PrepareRepairSource {
  let publishing: Promise<unknown> = Promise.resolve();
  return async (ctx, stateDir, signal, log) => {
    const workspaces = path.join(stateDir, "workspaces");
    await fs.mkdir(workspaces, { recursive: true });
    const workspace = await fs.mkdtemp(path.join(workspaces, "fix-"));
    const hooks = path.join(workspace, "empty-hooks");
    await fs.mkdir(hooks);
    const cwd = path.join(workspace, "source");
    const env = { ...ctx.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ELECTRON_SKIP_BINARY_DOWNLOAD: "1" };
    const command = async (file: string, args: string[], directory: string, sink: LogSink = log) => {
      if (signal.aborted) throw new Error("복구를 취소했습니다");
      let output = "";
      const result = await runner.run({ command: file, args, cwd: directory, env, timeoutMs: 15 * 60_000 }, (stream, text) => {
        if (stream === "stdout") output += text + "\n";
        if (output.length > 4 * 1024 * 1024) output = output.slice(-4 * 1024 * 1024);
        sink(stream, text);
      }, signal);
      if (signal.aborted) throw new Error("복구를 취소했습니다");
      if (result.code !== 0 || result.timedOut || result.notFound) throw new Error(`${file} ${args[0]} 실패${result.timedOut ? " (시간 초과)" : ""}. 작업 사본과 로그를 확인하세요.`);
      return output.trim();
    };
    const git = (args: string[], directory = cwd, quiet = false) => command("git", ["-c", `core.hooksPath=${hooks}`, ...args], directory, quiet ? () => undefined : log);
    let unavailable: string | undefined;
    let baseCommit = "";
    let privateTerms: string[] = [];
    try {
      if (isCloudSynced(workspace, await readCloudRoots(env, process.platform), [])) throw new Error("클라우드 동기화 폴더에는 자동 커밋하지 않습니다");
      const remote = await git(["remote", "get-url", "origin"], ctx.repoRoot, true);
      if (!/^(?:https:\/\/github\.com\/|git@github\.com:)[\w.-]+\/harness-manager(?:\.git)?$/.test(remote)) throw new Error("HM의 GitHub 원격 저장소를 확인하지 못했습니다");
      // 원격에서 직접 복제하므로 사용자의 미커밋 파일이나 아직 push하지 않은 커밋은 들어오지 않는다.
      await git(["clone", "--single-branch", "--branch", "dev", "--", remote, cwd], workspace);
      const pkg = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
      if (pkg.name !== "harness-manager") throw new Error("HM 소스 저장소가 아닙니다");
      baseCommit = await git(["rev-parse", "HEAD"], cwd, true);
      if (ctx.profileDir) {
        const terms = JSON.parse(await fs.readFile(path.join(ctx.profileDir, "private-terms.json"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return '{"terms":[]}'; throw error; }));
        if (!Array.isArray(terms.terms) || !terms.terms.every((value: unknown) => typeof value === "string")) throw new Error("비공개 낱말 목록 형식을 확인하세요");
        privateTerms = terms.terms;
      }
    } catch (error) {
      unavailable = redactInstallText((error as Error).message, env);
      log("info", `소스 자동 반영 준비 실패: ${unavailable}. PC 복구는 계속합니다.`);
      await fs.mkdir(cwd, { recursive: true });
    }
    return {
      cwd,
      instructions: unavailable
        ? "소스 저장소를 준비하지 못했습니다. PC의 지정 항목만 복구하고 소스 변경·커밋·push·배포는 수행하지 마세요."
        : "현재 폴더는 HM 소스의 작업 전용 사본입니다. 공통 설치 엔진의 버그이면 src/ 또는 scripts/에 원인을 수정하고 회귀 테스트를 추가하세요. 개인 취향·프로필·실제 홈 설정·로그·비밀값을 앱 소스에 넣지 마세요. 커밋과 push는 HM 호스트가 테스트 후 순서대로 자동 수행하므로 직접 git commit/push를 호출하지 마세요. 배포·태그 생성은 하지 마세요. 이 호스트 절차는 사용자가 명시적으로 요청했습니다.",
      publish: async (): Promise<SourceResult> => {
        if (unavailable) return { state: "failed", detail: unavailable, workspace: cwd };
        const publish = async (): Promise<SourceResult> => {
          // AI가 직접 만든 커밋도 자동 반영 범위에 들어오지 않게 출발점을 확인한다.
          const branch = await git(["branch", "--show-current"], cwd, true);
          if (branch !== "dev") throw new Error("작업 브랜치가 바뀌어 자동 반영을 중단했습니다");
          if (await git(["rev-parse", "HEAD"], cwd, true) !== baseCommit) throw new Error("호스트 밖에서 커밋이 변경되어 자동 반영을 중단했습니다");
          const changed = await git(["-c", "core.quotePath=false", "diff", "--name-only", "HEAD"], cwd, true);
          const untracked = await git(["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"], cwd, true);
          const files = [...new Set((changed + "\n" + untracked).split(/\r?\n/).filter(Boolean))];
          if (!files.length) return { state: "unchanged", detail: "공통 앱 소스 변경 없음", workspace: cwd };
          const inspect = async () => {
            const contents: string[] = [];
            for (const file of files) {
              if (!SOURCE_FILE.test(file) || PRIVATE_FILE.test(file)) throw new Error("개인 프로필 또는 허용 범위 밖 파일이 변경되었습니다");
              const full = path.resolve(cwd, file);
              if (!full.startsWith(path.resolve(cwd) + path.sep)) throw new Error("작업 사본 밖 파일입니다");
              const info = await fs.lstat(full).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
              if (info && (!info.isFile() || info.size > 2 * 1024 * 1024)) throw new Error(`일반 소스 파일이 아닙니다: ${file}`);
              if (info && !(await fs.realpath(full)).startsWith((await fs.realpath(cwd)) + path.sep)) throw new Error("작업 사본 밖으로 연결된 파일입니다");
              contents.push(info ? await fs.readFile(full, "utf8") : "");
            }
            assertPublishable(files, contents, ctx.home, env, privateTerms);
          };
          await inspect();
          log("info", "소스 검증: 의존성 준비 → 테스트 → 타입 검사 → 빌드");
          const validate = async () => {
            await command("npm", ["ci", "--no-audit", "--no-fund"], cwd);
            await command("npm", ["test"], cwd);
            await command("npm", ["run", "typecheck"], cwd);
            await command("npm", ["run", "build"], cwd);
          };
          await validate();
          await inspect();
          const afterFiles = [...new Set(((await git(["-c", "core.quotePath=false", "diff", "--name-only", "HEAD"], cwd, true)) + "\n" + (await git(["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"], cwd, true))).split(/\r?\n/).filter(Boolean))];
          if (afterFiles.some((file) => !files.includes(file))) throw new Error("검증 과정에서 다른 파일이 변경되었습니다. 작업 사본을 확인하세요.");
          await git(["add", "--", ...files]);
          await git(["commit", "-m", "fix: repair setup failure detected by harness-manager"]);
          await git(["fetch", "origin", "dev"]);
          const behind = await git(["rev-list", "--count", "HEAD..origin/dev"], cwd, true);
          if (behind !== "0") { await git(["merge", "--no-edit", "origin/dev"]); await validate(); }
          if (await git(["status", "--porcelain"], cwd, true)) throw new Error("검증 이후 작업 사본에 미커밋 변경이 있어 푸시하지 않았습니다");
          // push 거절·충돌 시에는 이 사본을 남긴다. force/reset/stash는 사용하지 않는다.
          await git(["push", "origin", "HEAD:refs/heads/dev"]);
          const commit = await git(["rev-parse", "HEAD"], cwd, true);
          return { state: "published", detail: "테스트를 통과한 변경을 dev에 커밋·푸시했습니다", workspace: cwd, commit };
        };
        const pending = publishing.then(publish, publish);
        publishing = pending.catch(() => undefined);
        return pending;
      },
    };
  };
}
