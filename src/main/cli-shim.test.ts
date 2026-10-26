import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHmCmd, hmCliLaunch, installHmCliShim, toBatchPath } from "./cli-shim.js";

const env = { LOCALAPPDATA: "C:\\Users\\홍길동\\AppData\\Local", USERPROFILE: "C:\\Users\\홍길동" };
const exe = "C:\\Users\\홍길동\\AppData\\Local\\Programs\\harness-manager\\Harness Manager.exe";
const script = "C:\\Users\\홍길동\\AppData\\Local\\Programs\\harness-manager\\resources\\app.asar\\out\\main\\cli.js";

describe("hm-cli 심", () => {
  it("한글 사용자 폴더는 환경변수 참조로 바꿔 배치 파일을 ASCII로 유지한다", () => {
    expect(toBatchPath(exe, env)).toBe("%LOCALAPPDATA%\\Programs\\harness-manager\\Harness Manager.exe");
    const cmd = buildHmCmd(exe, script, env);
    expect(cmd).not.toMatch(/[^\x00-\x7f]/);
    expect(cmd).not.toContain("chcp");
    expect(cmd).toContain('set "ELECTRON_RUN_AS_NODE=1"');
    expect(cmd).toContain(
      '"%LOCALAPPDATA%\\Programs\\harness-manager\\Harness Manager.exe" "%LOCALAPPDATA%\\Programs\\harness-manager\\resources\\app.asar\\out\\main\\cli.js" %*',
    );
  });

  it("알려진 접두 밖의 비ASCII 경로만 UTF-8로 전환한다", () => {
    expect(buildHmCmd("D:\\앱\\hm.exe", "D:\\앱\\cli.js", {})).toContain("chcp 65001 >nul");
  });

  it("다른 앱이 셸 없이 spawn할 실행 정보를 적는다", async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-bin-"));
    try {
      await installHmCliShim(binDir, exe, script, env);
      const launch = JSON.parse(fs.readFileSync(path.join(binDir, "hm-cli.json"), "utf8"));
      expect(launch).toEqual(hmCliLaunch(exe, script));
      expect(launch).toEqual({ schemaVersion: 1, command: exe, args: [script], env: { ELECTRON_RUN_AS_NODE: "1" } });
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  });
});

