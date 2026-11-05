import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { quoteForCmd } from "../install/exec.js";

export interface MetadataProcessOptions {
  executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal;
  timeoutMs?: number; input?: string;
  onMessage?: (message: unknown, send: (message: unknown) => void, finish: (error?: Error) => void) => void;
  initialMessage?: unknown;
}
/** Bounded stdio transport; neither user content nor RPC data passes through a shell. */
export async function metadataProcess(options: MetadataProcessOptions): Promise<string> {
  if (options.signal.aborted) throw new Error("검사를 취소했습니다");
  const shim = /\.(cmd|bat)$/i.test(options.executable);
  const args = shim ? ["/d", "/s", "/c", `"${[quoteForCmd(options.executable), ...options.args.map(quoteForCmd)].join(" ")}"`] : options.args;
  return new Promise((resolve, reject) => {
    const child = spawn(shim ? options.env.ComSpec ?? "cmd.exe" : options.executable, args, { cwd: options.cwd, env: options.env, windowsHide: true, windowsVerbatimArguments: shim, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    const decoder = new StringDecoder("utf8");
    let output = "", pending = "", bytes = 0, settled = false, outcome: Error | null | undefined;
    let stopping = Promise.resolve();
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
        stopping = new Promise(done => { killer.once("close", () => done()); killer.once("error", () => { child.kill(); done(); }); });
      } else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const finish = (error?: Error) => { if (outcome !== undefined) return; outcome = error ?? null; stop(); };
    const timer = setTimeout(() => finish(new Error("검사 제한 시간을 넘었습니다")), options.timeoutMs ?? 20_000);
    const abort = () => finish(new Error("검사를 취소했습니다"));
    options.signal.addEventListener("abort", abort, { once: true });
    const send = (message: unknown) => { if (outcome === undefined && !child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + "\n"); };
    child.stdin.on("error", error => { if (outcome === undefined) finish(error); });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) { finish(new Error("검사 출력 크기 제한을 넘었습니다")); return; }
      const text = decoder.write(chunk); output += text; pending += text;
      if (!options.onMessage) return;
      let index: number;
      while ((index = pending.indexOf("\n")) >= 0 && outcome === undefined) {
        const line = pending.slice(0, index).trim(); pending = pending.slice(index + 1);
        if (!line) continue;
        try { options.onMessage(JSON.parse(line), send, finish); } catch { finish(new Error("CLI 구조화 응답 형식이 다릅니다")); }
      }
    });
    // stderr can contain account details; bound it but never persist or return it.
    child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) finish(new Error("검사 출력 크기 제한을 넘었습니다")); });
    const complete = (error?: Error, code?: number | null) => {
      if (settled) return; settled = true; clearTimeout(timer); options.signal.removeEventListener("abort", abort);
      void stopping.then(() => { const failure = error ?? (outcome !== undefined ? outcome : code !== 0 ? new Error("CLI 검사가 실패했습니다 · 설치·인증·버전을 확인하세요") : undefined); if (failure) reject(failure); else resolve(output); });
    };
    child.once("error", error => complete(error));
    child.once("close", code => complete(undefined, code));
    child.once("spawn", () => { if (options.initialMessage) send(options.initialMessage); else child.stdin.end(options.input ?? ""); });
    if (options.signal.aborted) abort();
  });
}
