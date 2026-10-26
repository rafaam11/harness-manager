import { WINDOW_STATE_EVENT_CHANNEL } from "@shared/api-types";
import { Copy, Minus, Moon, Square, Sun, Wand2, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { call } from "../api/client";
import type { TitleBarEntry, TitleBarMenu } from "../title-bar-menu";
import { useDismissable } from "../use-dismissable";

interface TitleBarProps {
  menus: TitleBarMenu[];
  onAction(id: string): void;
  theme: "dark" | "light";
  onToggleTheme(): void;
  /** 셋업 위저드를 연다. 첫 화면은 상태판이고 위저드는 이 버튼으로만 연다(스펙 §5-9). */
  onOpenWizard(): void;
}

/**
 * 창의 기본 캡션을 없앴으므로(window-chrome.ts) 메뉴·제목·창 버튼을 직접 그린다.
 * 바 전체가 드래그 영역이고, 누르는 것들만 `-webkit-app-region: no-drag`로 빠진다.
 */
export function TitleBar({ menus, onAction, theme, onToggleTheme, onOpenWizard }: TitleBarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const menuButtons = useRef(new Map<string, HTMLButtonElement>());

  const closeMenus = useCallback(() => setOpenMenuId(null), []);
  const menuBar = useDismissable(closeMenus);

  useEffect(() => {
    void call("window:state")
      .then((state) => setMaximized(state.maximized))
      .catch(() => undefined);
    return window.hm.on(WINDOW_STATE_EVENT_CHANNEL, (state) => setMaximized(state.maximized));
  }, []);

  /** 키보드 위치의 기준은 인덱스가 아니라 포커스다 — 버튼은 이미 읽는 순서대로 문서에 있다. */
  const moveFocus = (listId: string, delta: number) => {
    const items = [
      ...(menuBar.current?.querySelectorAll<HTMLButtonElement>(`button[data-menu-list="${listId}"]`) ?? []),
    ].filter((entry) => !entry.disabled);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = index === -1 ? (delta > 0 ? 0 : items.length - 1) : (index + delta + items.length) % items.length;
    items[next]?.focus();
  };

  const openMenu = (menuId: string) => {
    setOpenMenuId(menuId);
    menuButtons.current.get(menuId)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!openMenuId) return;
    if (event.key === "Escape") {
      event.preventDefault();
      const menuId = openMenuId;
      closeMenus();
      menuButtons.current.get(menuId)?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(openMenuId, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const index = menus.findIndex((menu) => menu.id === openMenuId);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = menus[(index + step + menus.length) % menus.length];
      if (next) openMenu(next.id);
    }
  };

  const renderEntry = (entry: TitleBarEntry, listId: string, index: number) => {
    if (entry.kind === "separator") {
      return <div key={`separator-${listId}-${index}`} className="title-bar-separator" role="separator" />;
    }
    return (
      <button
        key={entry.id}
        type="button"
        role="menuitem"
        data-menu-list={listId}
        disabled={entry.disabled}
        onClick={() => {
          closeMenus();
          onAction(entry.id);
        }}
      >
        <span className="title-bar-item-label">{entry.label}</span>
        {entry.shortcut ? <span className="title-bar-shortcut">{entry.shortcut}</span> : null}
      </button>
    );
  };

  return (
    <div className="title-bar">
      <div className="title-bar-menus" role="menubar" ref={menuBar} onKeyDown={handleKeyDown}>
        <span className="title-bar-icon" aria-hidden="true">
          <Wrench size={15} />
        </span>
        {menus.map((menu) => (
          <div className="title-bar-menu-anchor" key={menu.id}>
            <button
              type="button"
              role="menuitem"
              className={`title-bar-menu-button ${openMenuId === menu.id ? "open" : ""}`}
              aria-haspopup="menu"
              aria-expanded={openMenuId === menu.id}
              ref={(node) => {
                if (node) menuButtons.current.set(menu.id, node);
                else menuButtons.current.delete(menu.id);
              }}
              // 메뉴 하나가 열리면 메뉴줄처럼 동작한다: 다른 메뉴에 올리면 바로 바뀐다.
              onMouseEnter={() => {
                if (openMenuId && openMenuId !== menu.id) setOpenMenuId(menu.id);
              }}
              onClick={() => (openMenuId === menu.id ? closeMenus() : openMenu(menu.id))}
            >
              {menu.label}
            </button>
            {openMenuId === menu.id ? (
              <div className="provider-menu title-bar-dropdown" role="menu" aria-label={menu.label}>
                {menu.entries.map((entry, index) => renderEntry(entry, menu.id, index))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="title-bar-title">하네스 매니저</div>

      <div className="window-controls">
        <button type="button" className="title-bar-wizard" onClick={onOpenWizard}>
          <Wand2 size={14} />
          셋업 위저드
        </button>
        <button
          type="button"
          className="title-bar-theme"
          aria-label={theme === "dark" ? "라이트 테마로 전환" : "다크 테마로 전환"}
          title={theme === "dark" ? "라이트 테마로 전환" : "다크 테마로 전환"}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button type="button" aria-label="최소화" onClick={() => void call("window:minimize")}>
          <Minus size={15} />
        </button>
        <button
          type="button"
          aria-label={maximized ? "이전 크기로 복원" : "최대화"}
          onClick={() => void call("window:toggle-maximize")}
        >
          {maximized ? <Copy size={13} /> : <Square size={13} />}
        </button>
        <button type="button" className="window-close" aria-label="닫기" onClick={() => void call("window:close")}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
