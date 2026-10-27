import type { ReactNode } from "react";
import {
  Archive,
  BookOpen,
  Download,
  FileCog,
  Globe,
  Import,
  LayoutDashboard,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import Capture from "./Capture";
import Catalog from "./Catalog";
import Cleanup from "./Cleanup";
import ConfigEditor from "./ConfigEditor";
import Dashboard from "./Dashboard";
import ExternalApi from "./ExternalApi";
import Install from "./Install";
import Wizard from "./Wizard";

export interface PageContext {
  /** 다른 화면으로 옮긴다(위저드가 끝나면 상태판으로). */
  navigate(page: PageKey): void;
}

export interface PageDefinition {
  /** 화면 제목·툴팁에 쓰는 전체 이름. */
  label: string;
  /** 사이드바 아이콘 아래에 붙는 짧은 이름. 아이콘만으로 뜻을 전하지 않는다(UI 규약). */
  short: string;
  icon: LucideIcon;
  /** 마스터-디테일처럼 가용 너비를 전부 쓰는 화면. */
  wide?: boolean;
  /** 사용자 설정 파일을 쓰는 화면. 실행 중인 CLI와 충돌할 수 있어 이런 화면에서만 경고를 띄운다. */
  writesUserFiles?: boolean;
  render(context: PageContext): ReactNode;
}

/**
 * 화면 목록의 단일 출처. App.tsx는 이 레지스트리를 돌며 사이드바와 본문을 그릴 뿐이다
 * (mcw App.tsx가 2,800줄까지 불어난 것을 반면교사로, 화면별 분기를 App에 두지 않는다).
 */
export const PAGES = {
  dashboard: { label: "상태판", short: "상태판", icon: LayoutDashboard, render: () => <Dashboard /> },
  install: { label: "설치", short: "설치", icon: Download, writesUserFiles: true, render: () => <Install /> },
  catalog: { label: "카탈로그", short: "카탈로그", icon: BookOpen, wide: true, render: () => <Catalog /> },
  cleanup: { label: "정리", short: "정리", icon: Archive, writesUserFiles: true, render: () => <Cleanup /> },
  configs: { label: "설정 편집기", short: "설정", icon: FileCog, writesUserFiles: true, render: () => <ConfigEditor /> },
  capture: { label: "가져오기", short: "가져오기", icon: Import, render: () => <Capture /> },
  "external-api": { label: "외부 API", short: "외부 API", icon: Globe, wide: true, render: () => <ExternalApi /> },
  // 사이드바에 없다. 타이틀바의 "셋업 위저드" 버튼으로만 연다.
  wizard: {
    label: "셋업 위저드",
    short: "위저드",
    icon: Wand2,
    writesUserFiles: true,
    render: ({ navigate }) => <Wizard onFinish={() => navigate("dashboard")} />,
  },
} satisfies Record<string, PageDefinition>;

export type PageKey = keyof typeof PAGES;

// 첫 화면은 상태판이다(상태판 + 섹션 탭).
export const PAGE_ORDER: PageKey[] = ["dashboard", "install", "catalog", "cleanup", "configs", "capture", "external-api"];
