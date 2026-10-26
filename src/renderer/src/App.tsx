import { useEffect, useMemo, useState } from "react";
import type { ProviderFilter, ProviderStatus } from "@shared/provider-types";
import { call } from "./api/client";
import { TitleBar } from "./components/TitleBar";
import { Toaster, showToast } from "./components/toast";
import { UpdateBadge } from "./components/UpdateBadge";
import { PAGE_ORDER, PAGES, type PageKey } from "./pages/registry";
import {
  DEFAULT_PROVIDER_FILTER,
  PROVIDER_FILTER_OPTIONS,
  providerLabel,
  providerToneClass,
} from "./provider-ui";
import { applyTheme, useResolvedTheme } from "./theme";
import { REPOSITORY_URL, buildTitleBarMenus } from "./title-bar-menu";

export default function App() {
  const [page, setPage] = useState<PageKey>(PAGE_ORDER[0]!);
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>(DEFAULT_PROVIDER_FILTER);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [appVersion, setAppVersion] = useState("");
  const theme = useResolvedTheme();

  useEffect(() => {
    void call("app:version").then(setAppVersion).catch(() => undefined);
  }, []);

  // 실행 중인 CLI가 설정을 다시 쓰면 저장이 충돌한다. 그래서 상단 경고용으로 주기적으로 확인한다.
  useEffect(() => {
    let alive = true;
    const load = () =>
      call("provider:status")
        .then((statuses) => {
          if (alive) setProviderStatuses(statuses);
        })
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const toggleTheme = () => applyTheme(theme === "dark" ? "light" : "dark");
  const menus = useMemo(() => buildTitleBarMenus({ appVersion, theme }), [appVersion, theme]);

  const handleMenuAction = (id: string) => {
    switch (id) {
      case "view.toggle-theme":
        toggleTheme();
        return;
      case "help.check-updates":
        void call("updater:check").catch((error: Error) =>
          showToast({ tone: "error", title: "업데이트 확인 실패", detail: error.message }),
        );
        return;
      case "help.release-notes":
        void call("app:open-releases");
        return;
      case "help.repository":
        void call("app:open-external", REPOSITORY_URL);
        return;
    }
  };

  const runningProviders = providerStatuses.filter((status) => status.running);
  const current = PAGES[page];

  return (
    <div className="app-frame">
      <TitleBar menus={menus} onAction={handleMenuAction} theme={theme} onToggleTheme={toggleTheme} />
      <div className="layout">
        <nav>
          {PAGE_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className={`nav-item${page === key ? " active" : ""}`}
              onClick={() => setPage(key)}
            >
              {PAGES[key].label}
            </button>
          ))}
          <div className="nav-provider">
            <div className="nav-provider-label">Provider</div>
            <div className="provider-filter" role="tablist" aria-label="Provider filter">
              {PROVIDER_FILTER_OPTIONS.map(({ value, label, fullLabel }) => (
                <button
                  key={value}
                  className={`${providerToneClass(value)}${providerFilter === value ? " active" : ""}`}
                  onClick={() => setProviderFilter(value)}
                  aria-label={fullLabel}
                  title={fullLabel}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="nav-spacer" />
          <UpdateBadge />
        </nav>
        <main className={"wide" in current && current.wide ? "page-wide" : undefined}>
          {runningProviders.length > 0 && (
            <div className="banner warn">
              실행 중인 provider: {runningProviders.map((status) => providerLabel(status.id)).join(", ")} —
              설정 저장·정리 실행 시 충돌에 주의하세요.
            </div>
          )}
          {current.render({ providerFilter })}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
