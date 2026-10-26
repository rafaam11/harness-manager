import { useEffect, useState } from "react";

export type ResolvedTheme = "dark" | "light";

/** localStorage에도 둔다 — 재시작 직후 첫 페인트부터 맞는 색이 나오게. */
export const THEME_STORAGE_KEY = "harness-manager.theme.v1";
/** v2가 쓰던 키. 첫 실행에서 한 번만 읽어 옮긴다. */
const LEGACY_THEME_STORAGE_KEY = "hm-theme";

/** 페이지 테마를 바꾸는 유일한 곳: CSS는 `data-theme`을 읽고, JS 쪽은 그것을 관찰한다. */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* unavailable storage */
  }
}

/** React가 그리기 전에: 지난 실행의 테마를 먼저 적용해 라이트 사용자에게 어두운 깜빡임이 없게 한다. */
export function applyStoredTheme(): void {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) ?? localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") document.documentElement.dataset.theme = stored;
  } catch {
    /* unavailable storage */
  }
}

export function currentTheme(): ResolvedTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * CSS 밖에서 색을 칠하는 컴포넌트(vanilla-jsoneditor 등)용 현재 테마. 설정이 아니라 `data-theme`을 따르므로
 * 스타일시트와 어긋날 수 없다.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(currentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    setTheme(currentTheme());
    return () => observer.disconnect();
  }, []);
  return theme;
}
