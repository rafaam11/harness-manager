import type { Catalog } from "./schema";

/** "외부 API" 화면이 받는 카탈로그와 그 k-skill 스냅샷의 출처. */
export interface ExternalApiSnapshot {
  catalog: Catalog;
  skillsSource: "bundled" | "refreshed";
  /** 새로고침한 사본이면 받은 시각(ISO). 번들이면 null. */
  updatedAt: string | null;
  /** 저장된 사본을 읽지 못해 번들로 되돌린 경우 그 이유. */
  warning?: string;
}

export interface ExternalLinkCheck {
  id: string;
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}
