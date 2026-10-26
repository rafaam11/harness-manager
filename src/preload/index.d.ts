import type { HarnessBridge } from "@shared/api-types";

declare global {
  interface Window {
    hm: HarnessBridge;
  }
}
