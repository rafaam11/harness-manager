/**
 * 타이틀바 메뉴를 데이터로 둔다. "왜 이 항목이 비활성인가"의 답이 모두 buildTitleBarMenus에 있어
 * 드롭다운을 렌더하지 않고도 테스트로 확인할 수 있다.
 */
export type TitleBarEntry =
  | { kind: "separator" }
  | { kind: "item"; id: string; label: string; shortcut?: string; disabled?: boolean };

export interface TitleBarMenu {
  id: string;
  label: string;
  entries: TitleBarEntry[];
}

export interface TitleBarMenuContext {
  appVersion: string;
  theme: "dark" | "light";
}

export const REPOSITORY_URL = "https://github.com/rafaam11/harness-manager";

const separator: TitleBarEntry = { kind: "separator" };

function item(id: string, label: string, options?: { disabled?: boolean }): TitleBarEntry {
  return { kind: "item", id, label, ...(options?.disabled ? { disabled: true } : {}) };
}

export function buildTitleBarMenus(context: TitleBarMenuContext): TitleBarMenu[] {
  return [
    {
      id: "view",
      label: "보기",
      entries: [item("view.toggle-theme", context.theme === "dark" ? "라이트 테마로" : "다크 테마로")],
    },
    {
      id: "help",
      label: "도움말",
      entries: [
        item("help.check-updates", "업데이트 확인"),
        item("help.release-notes", "릴리스 노트"),
        item("help.repository", "GitHub 저장소"),
        separator,
        item("help.version", context.appVersion ? `버전 v${context.appVersion}` : "버전", { disabled: true }),
      ],
    },
  ];
}
