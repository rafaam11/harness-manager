import type { ReactNode } from "react";
import type { ProviderFilter } from "@shared/provider-types";
import Catalog from "./Catalog";
import Cleanup from "./Cleanup";
import ConfigEditor from "./ConfigEditor";

export interface PageContext {
  providerFilter: ProviderFilter;
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
  catalog: { label: "카탈로그", wide: true, render: ({ providerFilter }) => <Catalog providerFilter={providerFilter} /> },
  cleanup: { label: "정리", render: () => <Cleanup /> },
  configs: { label: "설정 편집기", render: ({ providerFilter }) => <ConfigEditor providerFilter={providerFilter} /> },
} satisfies Record<string, PageDefinition>;

export type PageKey = keyof typeof PAGES;

export const PAGE_ORDER: PageKey[] = ["catalog", "cleanup", "configs"];
