import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

type ExecFile = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean },
) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile) as ExecFile;

function pathKey(env: Readonly<Record<string, string>>, platform: NodeJS.Platform): string {
  if (platform !== "win32") return "PATH";
  return Object.keys(env).find((candidate) => candidate.toUpperCase() === "PATH") ?? "Path";
}

export function prependPath(
  env: Record<string, string>,
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const key = pathKey(env, platform);
  const delimiter = platform === "win32" ? ";" : ":";
  return { ...env, [key]: env[key] ? `${dir}${delimiter}${env[key]}` : dir };
}

function fallbackLinuxPath(inherited: string | undefined): string {
  const values = [inherited, path.join(os.homedir(), ".local", "bin"), "/usr/local/bin", "/usr/bin", "/bin"];
  return [...new Set(values.filter((value): value is string => Boolean(value)))].join(":");
}

/**
 * A stray `"` in a Windows PATH entry (an installer leaving `C:\Program Files\WSL"`) makes cmd.exe and
 * Rust's `split_paths` treat everything after it as one quoted entry, so tools listed later vanish:
 * `codex update` cannot find `npm`, and the codex cmd shim cannot find `node`. Quotes are never part
 * of a Windows path, so drop them, along with empty entries.
 */
function sanitizeWindowsPath(env: Record<string, string>): Record<string, string> {
  const key = pathKey(env, "win32");
  const value = env[key];
  if (!value) return { ...env };
  const entries = value
    .split(";")
    .map((entry) => entry.replaceAll('"', "").trim())
    .filter(Boolean);
  return { ...env, [key]: entries.join(";") };
}

export async function discoverSessionEnvironment(
  inherited: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
  execute: ExecFile = execFileAsync,
): Promise<Record<string, string>> {
  if (platform === "win32") return sanitizeWindowsPath(inherited);
  let discovered = "";
  try {
    const result = await execute("/bin/bash", ["--login", "-c", `printf '%s' "$PATH"`], {
      env: inherited,
      timeout: 3_000,
      windowsHide: true,
    });
    discovered = result.stdout.trim();
  } catch {
    // A minimal deterministic PATH keeps GUI launches usable when shell startup files hang/fail.
  }
  return { ...inherited, PATH: discovered || fallbackLinuxPath(inherited.PATH) };
}

/** 설치 직후 레지스트리 환경을 읽되, 관련 키만 갱신하고 기존 프로세스의 다른 설정은 유지한다. */
export async function refreshWindowsEnvironment(
  inherited: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  execute: ExecFile = execFileAsync,
): Promise<NodeJS.ProcessEnv> {
  if (platform !== "win32") return { ...inherited };
  const script = [
    "[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false",
    "$result = @{}",
    "foreach ($name in @('NVM_HOME','NVM_SYMLINK')) { $value = [Environment]::GetEnvironmentVariable($name,'User'); if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name,'Machine') }; [Environment]::SetEnvironmentVariable($name,$value,'Process'); $result[$name] = $value }",
    "$machine = [Environment]::GetEnvironmentVariable('Path','Machine')",
    "$user = [Environment]::GetEnvironmentVariable('Path','User')",
    "$result.Path = [Environment]::ExpandEnvironmentVariables(\"$machine;$user\")",
    "$result | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: inherited, timeout: 10_000, windowsHide: true });
  return mergeWindowsEnvironment(inherited, JSON.parse(stdout.replace(/^\uFEFF/, "")) as Record<string, unknown>);
}

export function mergeWindowsEnvironment(inherited: NodeJS.ProcessEnv, stored: Record<string, unknown>): NodeJS.ProcessEnv {
  if (typeof stored.Path !== "string" || !stored.Path.trim()) throw new Error("Windows PATH를 읽지 못했습니다");
  const next = { ...inherited };
  // Path/PATH가 함께 있으면 Node가 이전 값을 자식에게 넘길 수 있다.
  for (const key of Object.keys(next)) if (["PATH", "NVM_HOME", "NVM_SYMLINK"].includes(key.toUpperCase())) delete next[key];
  next.Path = stored.Path.split(";").map((part) => part.replaceAll('"', "").trim()).filter(Boolean).join(";");
  for (const key of ["NVM_HOME", "NVM_SYMLINK"]) if (typeof stored[key] === "string" && stored[key]) next[key] = stored[key] as string;
  return next;
}
