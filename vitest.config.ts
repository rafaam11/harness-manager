import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // 기본은 node. 컴포넌트 테스트는 파일 머리에 `// @vitest-environment jsdom`을 단다.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/renderer/src/test/setup.ts"],
    globals: false,
    pool: "forks",
    clearMocks: true,
    // repo-sync·capture 테스트는 실제 git과 임시 파일을 쓴다. Windows에서 fork들이 몰리면 기본 5초를 넘긴다.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  // electron.vite.config.ts의 renderer와 같은 별칭(@shared 값 import가 테스트에서도 풀리게).
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@renderer": path.resolve(__dirname, "src/renderer/src"),
    },
  },
});
