import { resolve } from "path";
import { readFileSync } from "node:fs";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), {
      name: "bundle-node-protection",
      generateBundle() {
        // 앱 업데이트만 받은 PC의 오래된 레포에도 보호 검사가 적용되어야 한다.
        this.emitFile({ type: "asset", fileName: "node-runtime.ps1", source: readFileSync(resolve("scripts/node-runtime.ps1")) });
      },
    }],
    // cli는 hm-cli 진입점이다(out/main/cli.js). electron을 import하지 않아 ELECTRON_RUN_AS_NODE·node로 돈다.
    build: {
      rollupOptions: {
        input: { index: resolve("src/main/index.ts"), cli: resolve("src/main/cli.ts") },
      },
    },
    resolve: {
      alias: { "@shared": resolve("src/shared") },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@shared": resolve("src/shared") },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [react()],
  },
});
