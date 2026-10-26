import fs from "node:fs/promises";
import path from "node:path";

/**
 * 설치본의 hm-cli는 asar 안에 있어 `node`로 직접 못 돌린다. 앱 실행 파일을 `ELECTRON_RUN_AS_NODE=1`로 띄우면
 * node처럼 동작하고 asar도 읽는다. 앱이 기동할 때마다 그 명령을 두 형태로 `~/.harness-manager/bin`에 적는다.
 * - `hm.cmd`: 사람이 터미널에서 부른다. PATH에는 넣지 않는다(multi-cli-work control-cli-installer와 같은 선).
 * - `hm-cli.json`: 다른 앱(multi-cli-work)이 셸 없이 spawn한다. `.cmd`를 spawn하려면 셸이 필요하고,
 *   그러면 한글·공백 경로의 인자 인용이 깨지기 쉽다.
 */
export interface HmCliLaunch {
  schemaVersion: 1;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function hmCliLaunch(exePath: string, scriptPath: string): HmCliLaunch {
  return { schemaVersion: 1, command: exePath, args: [scriptPath], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

/**
 * cmd.exe는 배치 파일을 OEM 코드 페이지로 읽는다. 사용자 이름이 한글이면 절대경로가 깨지므로, 알려진 접두는
 * 환경변수 참조로 바꿔 파일을 ASCII로 유지한다. 그래도 남는 비ASCII가 있을 때만 UTF-8로 전환한다 —
 * `chcp`는 부른 쪽 콘솔의 코드 페이지까지 바꾸기 때문이다.
 */
export function toBatchPath(target: string, env: NodeJS.ProcessEnv): string {
  for (const key of ["LOCALAPPDATA", "APPDATA", "USERPROFILE", "ProgramFiles"]) {
    const prefix = env[key];
    if (!prefix) continue;
    const relative = path.win32.relative(prefix, target);
    if (relative && !relative.startsWith("..") && !path.win32.isAbsolute(relative)) return `%${key}%\\${relative}`;
  }
  return target;
}

export function buildHmCmd(exePath: string, scriptPath: string, env: NodeJS.ProcessEnv): string {
  const exe = toBatchPath(exePath, env);
  const script = toBatchPath(scriptPath, env);
  const needsUtf8 = /[^\x00-\x7f]/.test(exe + script);
  return [
    "@echo off",
    "setlocal",
    ...(needsUtf8 ? ["chcp 65001 >nul"] : []),
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${exe}" "${script}" %*`,
    "",
  ].join("\r\n");
}

async function writeIfChanged(filePath: string, content: string): Promise<void> {
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (current === content) return;
  const temp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temp, content, "utf8");
  await fs.rename(temp, filePath);
}

export async function installHmCliShim(
  binDir: string,
  exePath: string,
  scriptPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  await writeIfChanged(path.join(binDir, "hm-cli.json"), `${JSON.stringify(hmCliLaunch(exePath, scriptPath), null, 2)}\n`);
  if (process.platform === "win32") await writeIfChanged(path.join(binDir, "hm.cmd"), buildHmCmd(exePath, scriptPath, env));
}
