import "@testing-library/jest-dom/vitest";
import { MotionGlobalConfig } from "motion/react";
import { afterEach } from "vitest";
import { resetToasts } from "../components/toast";

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
