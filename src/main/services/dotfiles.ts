import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

/**
 * dotfiles(M6 후속)가 다루는 바깥 파일의 위치와 git 전역 설정 읽기·쓰기.
 * - PowerShell 프로필: Windows PowerShell 5.1의 현재 사용자·현재 호스트 프로필 하나만 다룬다.
 * - git: `git config`로만 읽고 쓴다. ini 파일을 직접 고치지 않아 형식·include·조건부 설정을 git이 지킨다.
 */

/** 문서 폴더는 OneDrive 등으로 옮겨져 있을 수 있어 OS에 묻는다. 실패하면 `~/Documents`. */
export async function resolveDocumentsDir(home: string): Promise<string> {
  // HM_HOME 격리 실행에서 OS가 알려 주는 실제 문서 폴더를 쓰면 시험 install이 진짜 PS 프로필을 고친다.
  if (process.platform !== "win32" || process.env.HM_HOME) return path.join(home, "Documents");
  const output = await new Promise<string>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Environment]::GetFolderPath('MyDocuments')"],
      { windowsHide: true, timeout: 10_000, encoding: "utf8" },
      (error, stdout) => resolve(error ? "" : String(stdout).trim()),
    );
  });
  return output || path.join(home || os.homedir(), "Documents");
}

export function powershellProfilePath(documentsDir: string): string {
  return path.join(documentsDir, "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1");
}

/** `--global` 대신 쓸 파일. 테스트가 실제 ~/.gitconfig를 건드리지 않게 바꿔 끼운다. */
export type GitConfigScope = { file?: string };

function scopeArgs(scope: GitConfigScope): string[] {
  return scope.file ? ["--file", scope.file] : ["--global"];
}

function runGit(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { windowsHide: true, timeout: 10_000, encoding: "utf8" }, (error, stdout) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    });
  });
}

/** 키마다 값 하나. 없으면 그 키는 결과에 없다. 여러 값이 있는 키는 마지막 값(git이 쓰는 값)이다. */
export async function readGitConfig(keys: readonly string[], scope: GitConfigScope): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const result = await runGit(["config", ...scopeArgs(scope), "--get", key]);
    if (result.code === 0) out[key] = result.stdout.replace(/\r?\n$/, "");
  }
  return out;
}

export function gitConfigSetArgs(key: string, value: string, scope: GitConfigScope): string[] {
  return ["config", ...scopeArgs(scope), key, value];
}

/** PowerShell 5.1은 BOM 없는 파일을 시스템 코드 페이지로 읽어 한글이 깨진다. 비교할 때는 BOM을 뗀다. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
