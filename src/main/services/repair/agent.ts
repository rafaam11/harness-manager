import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import fs from "node:fs/promises";
import path from "node:path";
import type { ProviderId } from "@shared/provider-types";
import type { RepairProvider } from "@shared/repair-types";
import { findOnPath } from "../../providers/provider-launch.js";
import { readVersionLine } from "../doctor/doctor.js";
import { quoteForCmd, type LogSink } from "../install/exec.js";
import { writeFileChecked } from "../capture/capture.js";
import { createAgentProtocol } from "./protocol.js";

export interface AgentOptions {
  provider: ProviderId;
  executable: string;
  cwd: string;
  stateDir: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  signal: AbortSignal;
  log: LogSink;
  approve(title: string, detail: string): Promise<boolean>;
}
export type AgentRunner = (options: AgentOptions) => Promise<void>;

export async function repairProviders(env: NodeJS.ProcessEnv): Promise<RepairProvider[]> {
  return Promise.all((["codex", "claude"] as const).map(async (id) => {
    const file = await findOnPath(id, process.platform, env);
    const version = file ? await readVersionLine(file, ["--version"], env) : null;
    return { id, available: Boolean(version), detail: version ?? `${id}를 실행할 수 없습니다. 터미널에서 설치·로그인 및 Node/PATH를 확인하거나 다른 AI를 선택하세요.` };
  }));
}

/** 프롬프트는 stdin JSON으로만 전달한다. .cmd의 셸 해석에 로그나 사용자 내용을 넣지 않는다. */
export const runRepairAgent: AgentRunner = async (options) => {
  const { provider, env, signal, executable, log } = options;
  if (signal.aborted) throw new Error("복구를 취소했습니다");
  let settingsPath: string | undefined;
  const args = provider === "codex"
    ? ["app-server", "--listen", "stdio://", "-c", "mcp_servers={}", "-c", "features.hooks=false"]
    : ["--print", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json", "--permission-prompt-tool", "stdio", "--permission-mode", "manual", "--strict-mcp-config", "--tools", "Bash,PowerShell,Read,Glob,Grep,Write,Edit", "--max-turns", "20", "--setting-sources", "user"];
  if (provider === "claude") {
    await fs.mkdir(options.stateDir, { recursive: true });
    const directory = await fs.mkdtemp(path.join(options.stateDir, "claude-"));
    settingsPath = path.join(directory, "settings.json");
    // 로컬의 자동 허용 규칙보다 ask가 우선한다. 복구 중 외부 hook은 실행하지 않는다.
    await writeFileChecked(settingsPath, null, JSON.stringify({ disableAllHooks: true, permissions: { ask: ["Bash", "PowerShell", "Write", "Edit"] } }));
    args.push("--settings", settingsPath);
  }
  const shim = /\.(cmd|bat)$/i.test(executable);
  const file = shim ? env.ComSpec ?? "cmd.exe" : executable;
  const argv = shim ? ["/d", "/s", "/c", `"${[quoteForCmd(executable), ...args.map(quoteForCmd)].join(" ")}"`] : args;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, argv, { cwd: options.cwd, env, windowsHide: true, windowsVerbatimArguments: shim, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
      let settled = false;
      let outcome: Error | null | undefined;
      let stopping: Promise<void> = Promise.resolve();
      let buffer = "";
      const decoder = new StringDecoder("utf8");
      const kill = () => {
        if (!child.pid) return;
        if (process.platform === "win32") {
          const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
          stopping = new Promise((resolveStop) => {
            killer.once("close", () => resolveStop());
            killer.once("error", () => { child.kill(); resolveStop(); });
          });
        } else {
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }
      };
      const complete = (error?: string) => { if (outcome !== undefined) return; outcome = error ? new Error(error) : null; kill(); };
      const protocol = createAgentProtocol(provider, options.cwd, options.prompt, {
        log, approve: options.approve, done: complete,
        send: (message) => { if (!child.stdin.destroyed && outcome === undefined) child.stdin.write(JSON.stringify(message) + "\n"); },
      });
      const timer = setTimeout(() => complete("AI 복구가 15분 제한을 넘었습니다. 로그를 확인하고 다시 요청하세요."), 15 * 60_000);
      const abort = () => complete("복구를 취소했습니다");
      signal.addEventListener("abort", abort, { once: true });
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        const failure = error ?? outcome;
        if (failure) reject(failure); else resolve();
      };
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += decoder.write(chunk);
        if (buffer.length > 2 * 1024 * 1024) { complete("AI 출력 한 줄이 허용 크기를 넘었습니다"); return; }
        let index: number;
        while ((index = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
          if (!line) continue;
          try { void protocol.receive(JSON.parse(line)).catch((error: Error) => complete(error.message)); }
          catch { complete("AI 응답 형식을 읽지 못했습니다. CLI 버전을 확인하세요."); }
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (text: string) => log("stderr", text));
      child.stdin.on("error", (error) => complete(error.message));
      child.on("error", finish);
      child.on("close", (code) => { void stopping.then(() => finish(outcome === undefined ? new Error(`AI가 결과 없이 종료되었습니다 (코드 ${code}). 로그인·CLI 버전과 로그를 확인하세요.`) : undefined)); });
      child.once("spawn", () => { if (signal.aborted) abort(); else protocol.start(); });
      if (signal.aborted) abort();
    });
  } finally {
    // 디렉터리는 우리 전용 mkdtemp 결과이며 설정 파일 하나만 지운다.
    if (settingsPath) { await fs.unlink(settingsPath).catch(() => undefined); await fs.rmdir(path.dirname(settingsPath)).catch(() => undefined); }
  }
};
