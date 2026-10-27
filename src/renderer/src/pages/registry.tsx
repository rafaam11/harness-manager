import type { ReactNode } from "react";
import type { ProviderFilter } from "@shared/provider-types";
import Capture from "./Capture";
import Catalog from "./Catalog";
import Cleanup from "./Cleanup";
import ConfigEditor from "./ConfigEditor";
import Dashboard from "./Dashboard";
import ExternalApi from "./ExternalApi";
import Install from "./Install";
import Wizard from "./Wizard";

export interface PageContext {
  providerFilter: ProviderFilter;
  /** 다른 화면으로 옮긴다(위저드가 끝나면 상태판으로). */
  navigate(page: PageKey): void;
}

export interface PageDefinition {
  label: string;
  /** 마스터-디테일처럼 가용 너비를 전부 쓰는 화면. */
  wide?: boolean;
  render(context: PageContext): ReactNode;
}

/**
 * 화면 목록의 단일 출처. App.tsx는 이 레지스트리를 돌며 내비게이션과 본문을 그릴 뿐이다
 * (mcw App.tsx가 2,800줄까지 불어난 것을 반면교사로, 화면별 분기를 App에 두지 않는다).
 */
export const PAGES = {
  dashboard: { label: "상태판", render: () => <Dashboard /> },
  install: { label: "설치", render: () => <Install /> },
  catalog: { label: "카탈로그", wide: true, render: ({ providerFilter }) => <Catalog providerFilter={providerFilter} /> },
  cleanup: { label: "정리", render: () => <Cleanup /> },
  configs: { label: "설정 편집기", render: ({ providerFilter }) => <ConfigEditor providerFilter={providerFilter} /> },
  capture: { label: "가져오기", render: () => <Capture /> },
  "external-api": { label: "외부 API", wide: true, render: () => <ExternalApi /> },
  // 내비게이션에 없다. 타이틀바의 "셋업 위저드" 버튼으로만 연다.
  wizard: { label: "셋업 위저드", render: ({ navigate }) => <Wizard onFinish={() => navigate("dashboard")} /> },
} satisfies Record<string, PageDefinition>;

export type PageKey = keyof typeof PAGES;

// 첫 화면은 상태판이다(D: 상태판 + 섹션 탭).
export const PAGE_ORDER: PageKey[] = ["dashboard", "install", "catalog", "cleanup", "configs", "capture", "external-api"];
