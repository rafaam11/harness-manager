import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Windows의 `where`는 같은 이름의 후보를 여러 개 돌려준다(npm 전역 설치는 확장자 없는 sh 심·.ps1·.cmd를 함께 만든다).
 * Node가 셸 없이 띄울 수 있는 것은 .exe뿐이고, .cmd는 셸이 필요하며, .ps1은 실행 정책에 막힐 수 있다.
 */
export function pickWindowsExecutable(candidates: string[]): string | null {
  const usable = candidates.map((candidate) => candidate.trim()).filter(Boolean);
  return (
    usable.find((candidate) => candidate.toLocaleLowerCase("en-US").endsWith(".exe")) ??
    usable.find((candidate) => candidate.toLocaleLowerCase("en-US").endsWith(".cmd")) ??
    usable.find((candidate) => !candidate.toLocaleLowerCase("en-US").endsWith(".ps1")) ??
    null
  );
}

/** PATH에서 명령을 찾는다. 3초 안에 못 찾으면 없는 것으로 본다(GUI 실행 시 PATH 문제는 platform-env가 맡는다). */
export async function findOnPath(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  try {
    const locator = platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(locator, [command], { env, windowsHide: true, timeout: 3_000 });
    const candidates = stdout.split(/\r?\n/).filter(Boolean);
    return platform === "win32" ? pickWindowsExecutable(candidates) : candidates[0] ?? null;
  } catch {
    return null;
  }
}

/** 감지 대상 하나. commands는 선호 순서다(예: PowerShell은 `pwsh`를 먼저 찾는다). */
export interface ExecutableDefinition {
  id: string;
  commands: readonly string[];
}

/** 정의마다 PATH에서 처음 찾은 실행 파일을 돌려준다. 하나도 못 찾으면 null. */
export async function detectExecutables(
  definitions: readonly ExecutableDefinition[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string | null>> {
  const resolved = await Promise.all(
    definitions.map(async (definition) => {
      for (const command of definition.commands) {
        const found = await findOnPath(command, platform, env);
        if (found) return [definition.id, found] as const;
      }
      return [definition.id, null] as const;
    }),
  );
  return Object.fromEntries(resolved);
}
