import { execFile } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { findOnPath } from "../providers/provider-launch.js";
import type { CommandSpec } from "./install/exec.js";

export const TERMINAL_NOTICE = "환경이 변경되었습니다. 이미 열려 있던 터미널과 터미널을 여는 앱을 완전히 종료한 뒤 다시 여세요.";

export interface NodeRuntimeState {
  state: "ready" | "fresh" | "empty-nvm" | "blocked";
  detail: string;
  node: string | null;
  nodeVersion: string | null;
  npmVersion: string | null;
  candidates: { path: string; realPath: string; version: string | null }[];
  registrations: { name: string; version: string; location: string | null; id: string }[];
  nvm: string | null;
  nvmRoot: string | null;
  nvmLink: string | null;
  versions: string[];
  environment: Record<string, string | null>;
  pathChanged: boolean;
}

export function nodeRuntimeCommand(repoRoot: string | null, mode: "inspect" | "install"): CommandSpec {
  // PowerShell은 Electron의 asar 가상 파일을 읽지 못하므로 unpack된 파일을 사용한다.
  const nativeDir = __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  const bundled = [path.join(nativeDir, "node-runtime.ps1"), path.join(nativeDir, "..", "node-runtime.ps1")].find(existsSync);
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", bundled ?? path.join(repoRoot ?? process.cwd(), "scripts", "node-runtime.ps1"), mode === "inspect" ? "-Inspect" : "-Install"],
    timeoutMs: mode === "inspect" ? 30_000 : 15 * 60_000,
  };
}

const execute = promisify(execFile);

/** bootstrap과 같은 보호 검사. 읽기 실패를 신규 PC로 간주하지 않는다. */
export async function inspectNodeRuntime(repoRoot: string | null, env: NodeJS.ProcessEnv): Promise<NodeRuntimeState> {
  if (process.platform !== "win32") {
    const versionOf = async (file: string | null) => {
      if (!file) return null;
      try { return (await execute(file, ["--version"], { env, timeout: 8_000 })).stdout.trim(); }
      catch { return null; }
    };
    const node = await findOnPath("node", process.platform, env);
    const npm = await findOnPath("npm", process.platform, env);
    const [nodeVersion, npmVersion] = await Promise.all([versionOf(node), versionOf(npm)]);
    const parts = /^v(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion ?? "");
    const ready = Boolean(parts && (Number(parts[1]) > 22 || (Number(parts[1]) === 22 && Number(parts[2]) >= 12)) && npmVersion);
    return {
      state: ready ? "ready" : "blocked",
      detail: ready ? `${nodeVersion} · ${node} · npm ${npmVersion} — 기존 설치 유지` : "Node 22.12 이상과 npm 실행을 확인하세요. NVM 자동 설치는 Windows에서만 지원합니다",
      node, nodeVersion, npmVersion,
      candidates: node ? [{ path: node, realPath: await fs.realpath(node), version: nodeVersion }] : [],
      registrations: [], nvm: null, nvmRoot: null, nvmLink: null, versions: [], environment: {}, pathChanged: false,
    };
  }
  const spec = nodeRuntimeCommand(repoRoot, "inspect");
  const { stdout } = await execute(spec.command, spec.args, { env, windowsHide: true, timeout: spec.timeoutMs, maxBuffer: 1024 * 1024 });
  const value = JSON.parse(stdout.replace(/^\uFEFF/, "")) as NodeRuntimeState;
  if (!["ready", "fresh", "empty-nvm", "blocked"].includes(value.state) || typeof value.detail !== "string" || !Array.isArray(value.candidates)) {
    throw new Error("Node 진단 결과를 읽을 수 없습니다");
  }
  return value;
}
