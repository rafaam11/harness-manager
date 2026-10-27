import { spawn } from "node:child_process";
import { findOnPath } from "../../providers/provider-launch.js";

/**
 * step이 부르는 외부 명령 하나. 명령과 인자는 manifest에서 main이 만든 값뿐이다(렌더러는 step id만 보낸다).
 * 셸을 거치지 않는다. 다만 npm·scoop 같은 `.cmd` 심은 cmd.exe가 있어야 돌아가므로, 그때만 인자를 엄격히
 * 검사한 뒤 cmd.exe에 한 줄로 넘긴다.
 */
export interface CommandSpec {
  command: string;
  args: string[];
  timeoutMs: number;
  /** 자식에게 전달할 전체 환경. 생략하면 현재 프로세스 환경을 쓴다. */
  env?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  code: number | null;
  timedOut: boolean;
  /** 실행 파일을 PATH에서 찾지 못했으면 true. */
  notFound: boolean;
}

export type LogSink = (stream: "stdout" | "stderr" | "info", line: string) => void;

export interface CommandRunner {
  run(spec: CommandSpec, log: LogSink, signal: AbortSignal): Promise<CommandResult>;
}

/** cmd.exe가 다른 뜻으로 읽는 문자. manifest 값에 이런 것이 있으면 심을 거쳐 실행하지 않는다. */
const CMD_UNSAFE = /["%^&|<>()!\r\n]/;

export function quoteForCmd(arg: string): string {
  if (CMD_UNSAFE.test(arg)) throw new Error(`cmd.exe로 넘길 수 없는 인자입니다: ${arg}`);
  return /[\s,;=]/.test(arg) || arg === "" ? `"${arg}"` : arg;
}

export function displayCommand(spec: Pick<CommandSpec, "command" | "args">): string {
  return [spec.command, ...spec.args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ");
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function lineSplitter(onLine: (line: string) => void): { push(chunk: Buffer): void; flush(): void } {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk.toString("utf8");
      const parts = pending.split(/\r?\n|\r/);
      pending = parts.pop() ?? "";
      for (const part of parts) {
        const clean = part.replace(ANSI, "").trimEnd();
        if (clean) onLine(clean);
      }
    },
    flush() {
      const clean = pending.replace(ANSI, "").trimEnd();
      if (clean) onLine(clean);
      pending = "";
    },
  };
}

export const processRunner: CommandRunner = {
  async run(spec, log, signal) {
    if (signal.aborted) return { code: null, timedOut: false, notFound: false };
    const env = spec.env ?? process.env;
    const resolved = await findOnPath(spec.command, process.platform, env);
    if (!resolved) return { code: null, timedOut: false, notFound: true };
    if (signal.aborted) return { code: null, timedOut: false, notFound: false };
    const isShim = /\.(cmd|bat)$/i.test(resolved);
    const file = isShim ? process.env.ComSpec || "cmd.exe" : resolved;
    const args = isShim ? ["/d", "/s", "/c", `"${[`"${resolved}"`, ...spec.args.map(quoteForCmd)].join(" ")}"`] : spec.args;
    return new Promise((resolve) => {
      const child = spawn(file, args, {
        windowsHide: true,
        windowsVerbatimArguments: isShim,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let timedOut = false;
      const kill = () => {
        // cmd.exe 아래의 진짜 설치기까지 끝내려면 프로세스 트리를 닫아야 한다.
        if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
        else child.kill();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, spec.timeoutMs);
      const onAbort = () => kill();
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) kill();
      const out = lineSplitter((line) => log("stdout", line));
      const err = lineSplitter((line) => log("stderr", line));
      child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
      const finish = (code: number | null) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        out.flush();
        err.flush();
        resolve({ code, timedOut, notFound: false });
      };
      child.on("error", (error) => {
        log("stderr", error.message);
        finish(null);
      });
      child.on("close", (code) => finish(code));
    });
  },
};
