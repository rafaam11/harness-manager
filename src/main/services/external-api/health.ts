import type { Catalog } from "@shared/external-api/schema";
import type { ExternalLinkCheck } from "@shared/external-api/types";

/**
 * 정보원 공식 링크가 살아 있는지 HEAD로 확인한다(jk-external-api scripts/check-external-health.ts에서 옮김).
 * 예전에는 주간 CI가 돌렸지만 이제 "공식 링크 점검" 버튼으로만 돈다. 405(HEAD 미지원)는 살아 있는 것으로 본다.
 */
export async function checkOfficialLinks(
  catalog: Catalog,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<ExternalLinkCheck[]> {
  return Promise.all(
    catalog.sources.map(async (source): Promise<ExternalLinkCheck> => {
      const base = { id: source.id, name: source.name, url: source.officialUrl };
      try {
        const response = await fetcher(source.officialUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
        return { ...base, ok: response.ok || response.status === 405, status: response.status };
      } catch (error) {
        return { ...base, ok: false, error: error instanceof Error ? error.message : "request failed" };
      }
    }),
  );
}
