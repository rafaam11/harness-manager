# Korean Registry Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 분야·분류의 내부 영문 식별자는 유지하면서 모든 사용자 노출 화면에 일관된 한국어 표시명을 제공한다.

**Architecture:** `apps/site/src/lib/labels.ts`가 정보원 분야, k-skill 분류, 기술 분류의 중앙 표시 매핑을 소유한다. 컴포넌트와 Astro 상세 페이지는 렌더링할 때만 이 함수를 호출하며, 필터의 `value`, 검색 데이터, URL, 카탈로그 스키마에는 기존 영문 값을 그대로 전달한다.

**Tech Stack:** TypeScript, Preact, Astro, Vitest, Playwright

## Global Constraints

- 카탈로그 스키마와 원본 영문 식별자를 변경하지 않는다.
- 새 의존성을 추가하지 않는다.
- 미등록 값은 원문을 그대로 표시한다.
- ID, 기술명, 데이터 형식, 실행 환경은 번역 범위에서 제외한다.

---

### Task 1: 중앙 한국어 표시 매핑

**Files:**
- Create: `apps/site/src/lib/labels.ts`
- Create: `apps/site/src/lib/labels.test.ts`

**Interfaces:**
- Consumes: 카탈로그가 제공하는 영문 `string` 값
- Produces: `formatDomain(value: string): string`, `formatSkillCategory(value: string): string`, `formatTechnologyCategory(value: string): string`, `formatDomains(values: readonly string[], separator?: string): string`

- [ ] **Step 1: 알려진 값과 미등록 값에 대한 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { formatDomain, formatDomains, formatSkillCategory, formatTechnologyCategory } from "./labels.js";

describe("registry labels", () => {
  it.each([
    ["weather", "날씨"], ["public", "공공"], ["mobility", "교통"],
    ["geospatial", "공간정보"], ["statistics", "통계"],
  ])("formats domain %s", (value, label) => expect(formatDomain(value)).toBe(label));

  it.each([
    ["legal-documents", "법률 문서"], ["local-info", "지역 정보"],
    ["public-health", "공중보건"], ["real-estate", "부동산"], ["other", "기타"],
  ])("formats skill category %s", (value, label) => expect(formatSkillCategory(value)).toBe(label));

  it.each([
    ["protocol", "프로토콜"], ["format", "데이터 형식"],
    ["architecture", "아키텍처"], ["auth", "인증"],
  ])("formats technology category %s", (value, label) => expect(formatTechnologyCategory(value)).toBe(label));

  it("joins domains and preserves unknown values", () => {
    expect(formatDomains(["weather", "future-domain"])).toBe("날씨 · future-domain");
    expect(formatSkillCategory("future-category")).toBe("future-category");
  });
});
```

- [ ] **Step 2: 테스트가 누락 모듈 때문에 실패하는지 확인**

Run: `corepack pnpm --filter @jk-external-api/site test -- labels.test.ts`

Expected: FAIL because `./labels.js` cannot be resolved.

- [ ] **Step 3: 최소 중앙 매핑 구현**

`labels.ts`에 다음 전체 값을 명시적으로 매핑한다.

```ts
const domainLabels: Record<string, string> = {
  business: "사업", culture: "문화", environment: "환경", facility: "시설",
  geospatial: "공간정보", health: "건강", local: "지역", mobility: "교통",
  place: "장소", public: "공공", search: "검색", seoul: "서울",
  statistics: "통계", weather: "날씨",
};

const skillCategoryLabels: Record<string, string> = {
  automotive: "자동차", beauty: "뷰티", business: "비즈니스", civic: "시민·행정",
  convenience: "편의", culture: "문화", data: "데이터", documents: "문서",
  education: "교육", entertainment: "엔터테인먼트", finance: "금융", food: "식음료",
  health: "건강", healthcare: "의료", history: "역사", housing: "주거",
  information: "정보", ip: "지식재산", jobs: "일자리", legal: "법률",
  "legal-documents": "법률 문서", lifestyle: "생활", "local-info": "지역 정보",
  logistics: "물류", marketing: "마케팅", marketplace: "마켓플레이스",
  messaging: "메시징", news: "뉴스", other: "기타", procurement: "조달",
  "public-health": "공중보건", "real-estate": "부동산", recruiting: "채용",
  research: "연구", retail: "소매", security: "보안", setup: "설정",
  sports: "스포츠", transit: "대중교통", transport: "운송", travel: "여행",
  utility: "유틸리티", weather: "날씨", writing: "글쓰기",
};

const technologyCategoryLabels: Record<string, string> = {
  architecture: "아키텍처", auth: "인증", client: "클라이언트",
  data: "데이터", format: "데이터 형식", protocol: "프로토콜",
};

const format = (labels: Record<string, string>, value: string) => labels[value] ?? value;

export const formatDomain = (value: string) => format(domainLabels, value);
export const formatSkillCategory = (value: string) => format(skillCategoryLabels, value);
export const formatTechnologyCategory = (value: string) => format(technologyCategoryLabels, value);
export const formatDomains = (values: readonly string[], separator = " · ") => values.map(formatDomain).join(separator);
```

- [ ] **Step 4: 단위 테스트 통과 확인**

Run: `corepack pnpm --filter @jk-external-api/site test -- labels.test.ts`

Expected: PASS with all label tests green.

- [ ] **Step 5: 중앙 매핑 커밋**

```bash
git add apps/site/src/lib/labels.ts apps/site/src/lib/labels.test.ts
git commit -m "feat: add Korean registry labels"
```

### Task 2: 모든 레지스트리 노출 지점에 번역 적용

**Files:**
- Modify: `apps/site/src/components/RegistryTable.tsx`
- Modify: `apps/site/src/components/RegistryDialog.tsx`
- Modify: `apps/site/src/components/AtlasExplorer.tsx`
- Modify: `apps/site/src/pages/skills/[id].astro`
- Modify: `apps/site/src/pages/blueprints/[id].astro`
- Modify: `e2e/atlas.spec.ts`

**Interfaces:**
- Consumes: Task 1의 네 표시 함수
- Produces: 한국어 셀·필터 옵션·모달·Atlas·상세 화면, 기존 영문 필터 값

- [ ] **Step 1: 사용자 화면과 필터 값 회귀 테스트 작성**

```ts
test("registry categories use Korean labels without changing filter values", async ({ page }) => {
  await page.goto("./sources/");
  const domain = page.getByRole("combobox", { name: "분야", exact: true });
  await expect(domain.getByRole("option", { name: "교통" })).toHaveAttribute("value", "mobility");
  await domain.selectOption("mobility");
  await expect(page.getByRole("table", { name: "정보원 레지스트리" })).toContainText("교통");
  await expect(page.getByRole("table", { name: "정보원 레지스트리" })).not.toContainText("mobility");

  await page.goto("./technologies/");
  await expect(page.getByRole("table", { name: "기술 레지스트리" })).toContainText("프로토콜");

  await page.goto("./skills/");
  const category = page.getByRole("combobox", { name: "분류", exact: true });
  await expect(category.getByRole("option", { name: "법률 문서" })).toHaveAttribute("value", "legal-documents");
});
```

- [ ] **Step 2: E2E 테스트가 영문 표시 때문에 실패하는지 확인**

Run: `corepack pnpm e2e --grep "registry categories use Korean labels" --project=chromium`

Expected: FAIL because option names and table cells are still English.

- [ ] **Step 3: 목록·필터·모달 렌더링에 표시 함수 적용**

`RegistryTable.tsx`에서 원본 `fields.category`는 바꾸지 않고 다음 위치만 변환한다.

```tsx
const categoryLabel = (value: string) => kind === "source"
  ? formatDomain(value)
  : kind === "skill"
    ? formatSkillCategory(value)
    : formatTechnologyCategory(value);

<option value={item} key={item}>{categoryLabel(item)}</option>
```

열 값은 `formatDomains(source.domains)`, `formatSkillCategory(skill.category)`, `formatTechnologyCategory(technology.category)`를 사용한다. `RegistryDialog.tsx`의 skill·technology 분류도 동일한 함수를 사용한다.

- [ ] **Step 4: Atlas와 상세 페이지에 표시 함수 적용**

`AtlasExplorer.tsx`의 분야 필터 옵션, 레일 코드, 모바일 목록, 선택 기록에 `formatDomain` 또는 `formatDomains`를 적용한다. `skills/[id].astro`의 eyebrow에는 `formatSkillCategory`, `blueprints/[id].astro`의 정보원 분야에는 `formatDomain`을 적용한다.

- [ ] **Step 5: 단일 E2E와 단위 테스트 통과 확인**

Run: `corepack pnpm --filter @jk-external-api/site test && corepack pnpm e2e --grep "registry categories use Korean labels" --project=chromium`

Expected: site unit tests PASS and the focused Playwright test PASS.

- [ ] **Step 6: UI 적용 커밋**

```bash
git add apps/site/src/components apps/site/src/pages apps/site/src/lib e2e/atlas.spec.ts
git commit -m "feat: localize registry classifications"
```

### Task 3: 전체 회귀 검증과 배포

**Files:**
- Verify only; no production file changes expected

**Interfaces:**
- Consumes: Tasks 1–2의 완성된 UI
- Produces: Node.js 24 검증 증거와 GitHub Pages 배포

- [ ] **Step 1: 전체 정적·단위·빌드 검증**

Run: `corepack pnpm check`

Expected: lint, typecheck, all unit tests, Worker dry-run, Astro build PASS.

- [ ] **Step 2: 내부 링크 검증**

Run: `corepack pnpm links`

Expected: all generated HTML internal links resolve.

- [ ] **Step 3: 전체 브라우저 회귀 검증**

Run: `corepack pnpm e2e`

Expected: no unexpected failures; project-specific intentional skips only.

- [ ] **Step 4: 변경 검토와 브랜치 병합**

Run: `git diff main...HEAD --check && git status --short --branch`

Expected: no whitespace errors and only intended commits on `feat/korean-registry-labels`. Fast-forward `main` after verification.

- [ ] **Step 5: Pages 배포 및 운영 확인**

Run: `git push origin main`, then inspect `gh run list --workflow pages.yml --limit 1` and request `https://rafaam11.github.io/jk-external-api/`.

Expected: Pages workflow succeeds for the merged commit, the live URL returns HTTP 200, and the deployed HTML contains Korean 분야 labels.
