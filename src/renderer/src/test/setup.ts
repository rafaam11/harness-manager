import "@testing-library/jest-dom/vitest";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resetToasts } from "../components/toast";

// 백업·프로필 초기화까지 실제 사용자 홈 밖에서 수행한다.
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "hm-test-home-"));
const saved = { HM_HOME: process.env.HM_HOME, HM_CLAUDE_HOME: process.env.HM_CLAUDE_HOME, HM_CODEX_HOME: process.env.HM_CODEX_HOME, CODEX_HOME: process.env.CODEX_HOME };
process.env.HM_HOME = testHome;
delete process.env.HM_CLAUDE_HOME;
delete process.env.HM_CODEX_HOME;
delete process.env.CODEX_HOME;
afterAll(() => {
  for (const [key,value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (path.resolve(testHome).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(testHome, { recursive: true, force: true });
});

// 토스트는 모듈 수준 저장소라, 지우지 않으면 한 케이스의 토스트가 다음 렌더에 나타난다.
afterEach(() => resetToasts());

// jsdom은 그리지 않으므로 motion이 퇴장 노드를 프레임 대기로 DOM에 남긴다.
MotionGlobalConfig.skipAnimations = true;

// motion의 reduced-motion 확인이 matchMedia를 읽는데 jsdom에는 없다.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
