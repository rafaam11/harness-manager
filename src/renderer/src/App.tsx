import { useEffect, useMemo, useState } from "react";
import type { ProviderStatus } from "@shared/provider-types";
import { call } from "./api/client";
import { TitleBar } from "./components/TitleBar";
import { Toaster, showToast } from "./components/toast";
import { Banner } from "./components/ui";
import { PAGE_ORDER, PAGES, type PageKey } from "./pages/registry";
import { providerLabel } from "./provider-ui";
import { applyTheme, useResolvedTheme } from "./theme";
import { REPOSITORY_URL, buildTitleBarMenus } from "./title-bar-menu";

export default function App() {
  const [page, setPage] = useState<PageKey>(PAGE_ORDER[0]!);
  const [profileRevision, setProfileRevision] = useState(0);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [appVersion, setAppVersion] = useState("");
  const theme = useResolvedTheme();

  useEffect(() => {
    void call("app:version").then(setAppVersion).catch(() => undefined);
    const changed = () => setProfileRevision(n => n + 1);
    window.addEventListener("hm:profile-changed", changed);
    return () => window.removeEventListener("hm:profile-changed", changed);
  }, []);
  const navigate = (next: PageKey) => {
    const proceed = () => setPage(next);
    if (window.dispatchEvent(new CustomEvent("hm:before-navigate", { cancelable: true, detail: { proceed } }))) proceed();
  };

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
      <TitleBar menus={menus} onAction={handleMenuAction} theme={theme} onToggleTheme={toggleTheme} onOpenWizard={() => navigate("wizard")} />
      <div className="layout">
        {/* 아이콘 열. 아이콘 아래 짧은 이름을 함께 둔다 — 아이콘만으로 뜻을 전하지 않는다. */}
        <nav className="rail" aria-label="화면">
          {PAGE_ORDER.map((key) => {
            const entry = PAGES[key];
            const Icon = entry.icon;
            return (
              <button
                key={key}
                type="button"
                className="rail-item"
                aria-current={page === key ? "page" : undefined}
                title={entry.label}
                onClick={() => navigate(key)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{entry.short}</span>
              </button>
            );
          })}
        </nav>
        <main key={profileRevision} className={PAGE_ORDER.includes(page) ? "page-wide page-fixed" : "wide" in current && current.wide ? "page-wide" : undefined}>
          {"writesUserFiles" in current && current.writesUserFiles && runningProviders.length > 0 && (
            <Banner tone="warn">
              {runningProviders.map((status) => providerLabel(status.id)).join(", ")} 실행 중 · 설정 적용 전 해당 CLI를 닫아 주세요.
            </Banner>
          )}
          {current.render({ navigate })}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
