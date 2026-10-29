import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { McpServer } from "@shared/api-types";
import { findOnPath } from "../../providers/provider-launch.js";
import { quoteForCmd } from "../install/exec.js";
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "harness-manager-diagnostics", version: "4.0.0" } } };
const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };
export interface McpProbeResult { ok: boolean; detail: string }
function accepted(value: any): boolean { return value?.jsonrpc === "2.0" && value.id === 1 && ["2025-06-18", "2025-03-26", "2024-11-05"].includes(value.result?.protocolVersion) && typeof value.result?.capabilities === "object" && typeof value.result?.serverInfo?.name === "string"; }
/** 초기화만 검사한다. tools/call·sampling·elicitation은 보내지 않는다. */
export async function probeMcp(server: McpServer, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<McpProbeResult> {
  const timeout = AbortSignal.timeout(10_000); const stop = AbortSignal.any([timeout, signal]);
  const expand = (text: string) => text.replace(/\$\{(\w+)\}/g, (_, key: string) => { const value = env[key]; if (!value) throw new Error(`환경변수 ${key}가 필요합니다`); return value; });
  if (server.transport === "http" && server.url) {
    const url = new URL(server.url); if (!["http:", "https:"].includes(url.protocol)) throw new Error("지원하지 않는 MCP URL입니다");
    const headers: Record<string, string> = { ...Object.fromEntries(Object.entries(server.headers ?? {}).map(([k, v]) => [k, expand(v)])), "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const response = await fetch(url, { method: "POST", body: JSON.stringify(initialize), headers, signal: stop, redirect: "error" });
    if (!response.ok) return { ok: false, detail: `MCP 초기화 실패 (${response.status})` };
    const reader = response.body?.getReader(); if (!reader) throw new Error("MCP 응답이 없습니다");
    let text = ""; let value: any;
    try {
      while (text.length < 256 * 1024) {
        const next = await reader.read(); if (next.done) break; text += Buffer.from(next.value).toString("utf8");
        if (response.headers.get("content-type")?.includes("text/event-stream")) {
          for (const line of text.split(/\r?\n/)) if (line.startsWith("data:")) { try { const candidate = JSON.parse(line.slice(5)); if (candidate.id === 1) value = candidate; } catch {} }
        } else { try { value = JSON.parse(text); } catch {} }
        if (value) break;
      }
    } finally { await reader.cancel().catch(() => undefined); }
    if (!accepted(value)) return { ok: false, detail: "지원하는 MCP 초기화 응답이 아닙니다" };
    const session = response.headers.get("mcp-session-id"); if (session) headers["Mcp-Session-Id"] = session;
    headers["MCP-Protocol-Version"] = value.result.protocolVersion;
    const ready = await fetch(url, { method: "POST", body: JSON.stringify(initialized), headers, signal: stop, redirect: "error" });
    await ready.body?.cancel();
    if (session) { const closed = await fetch(url, { method: "DELETE", headers, signal: stop, redirect: "error" }).catch(() => null); await closed?.body?.cancel(); }
    return { ok: ready.ok, detail: ready.ok ? "MCP 초기화 연결 확인 · 도구 호출은 실행하지 않음" : "MCP 초기화 알림을 서버가 거절했습니다" };
  }
  if (server.transport !== "stdio" || !server.command) return { ok: false, detail: "이 전송 방식은 자동 연결 검사를 지원하지 않습니다" };
  const childEnv = { ...env, ...Object.fromEntries(Object.entries(server.env ?? {}).map(([k, v]) => [k, expand(v)])) };
  const command = expand(server.command);
  const resolved = path.isAbsolute(command) ? (await fs.stat(command).catch(() => null))?.isFile() ? command : null : await findOnPath(command, process.platform, childEnv);
  if (!resolved) return { ok: false, detail: "MCP 실행 파일을 찾지 못했습니다" };
  const args = (server.args ?? []).map(expand); const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved);
  if (shim) quoteForCmd(resolved);
  const child = spawn(shim ? childEnv.ComSpec || "cmd.exe" : resolved, shim ? ["/d", "/s", "/c", `"${[`"${resolved}"`, ...args.map(quoteForCmd)].join(" ")}"`] : args, { env: childEnv, windowsHide: true, windowsVerbatimArguments: shim, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
  return new Promise(resolve => {
    let done = false, pending = "", bytes = 0;
    const finish = async (ok: boolean, detail: string) => {
      if (done) return; done = true; stop.removeEventListener("abort", abort);
      child.stdin.end(); await delay(150);
      if (child.exitCode === null && child.pid) {
        if (process.platform === "win32") await new Promise<void>(closed => { const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); killer.once("close", () => closed()); killer.once("error", () => { child.kill(); closed(); }); });
        else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill(); } }
      }
      resolve({ ok, detail });
    };
    const abort = () => { void finish(false, "MCP 연결 검사 시간 초과 또는 취소"); };
    stop.addEventListener("abort", abort, { once: true }); if (stop.aborted) abort();
    child.stdin.on("error", () => undefined);
    child.on("error", () => { void finish(false, "MCP 프로세스를 시작하지 못했습니다"); });
    child.on("close", () => { void finish(false, "초기화 전에 MCP 프로세스가 종료됐습니다"); });
    child.stderr.on("data", chunk => { bytes += chunk.length; if (bytes > 256 * 1024) void finish(false, "MCP 출력 제한 초과"); });
    child.stdout.on("data", chunk => {
      bytes += chunk.length; if (bytes > 256 * 1024) { void finish(false, "MCP 출력 제한 초과"); return; }
      pending += chunk.toString("utf8"); const lines = pending.split(/\r?\n/); pending = lines.pop() ?? "";
      for (const line of lines) { try { const value = JSON.parse(line); if (value.id === 1) { if (accepted(value)) child.stdin.write(JSON.stringify(initialized) + "\n"); void finish(accepted(value), accepted(value) ? "MCP 초기화 연결 확인 · 도구 호출은 실행하지 않음" : "지원하는 MCP 초기화 응답이 아닙니다"); } } catch { void finish(false, "MCP stdout 형식이 올바르지 않습니다"); } }
    });
    child.stdin.write(JSON.stringify(initialize) + "\n");
  });
}
