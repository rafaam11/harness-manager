import { Database, Sparkles, Map, Blocks } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ExternalApiSnapshot, ExternalLinkCheck } from "@shared/external-api/types";
import { Banner, StatusTag, Tabs, ToolbarSpacer } from "../../components/ui";
import { call } from "../../api/client";
import { showToast } from "../../components/toast";
import type { RegistryView } from "../../external-api/registry";
import CompareDialog from "./CompareDialog";
import RegistryDialog from "./RegistryDialog";
import RegistryTable from "./RegistryTable";
import SourcesExplorer from "./SourcesExplorer";

type Tab = "sources" | "skills" | "blueprints" | "technologies";

const TABS: { id: Tab; label: string; icon: typeof Database }[] = [
  { id: "sources", label: "정보원", icon: Database },
  { id: "skills", label: "k-skill", icon: Sparkles },
  { id: "blueprints", label: "청사진", icon: Map },
  { id: "technologies", label: "기술", icon: Blocks },
];

/**
 * 외부 API 카탈로그(M12, jk-external-api 흡수). 한국 공공·외부 정보원과 그것을 쓰는 k-skill, 생활 문제 청사진,
 * 기술을 조회한다. 네트워크(스냅샷 새로고침·링크 점검)는 main이 하고, 이 화면은 채널만 부른다.
 */
export default function ExternalApi() {
  const [snapshot, setSnapshot] = useState<ExternalApiSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("sources");
  const [history, setHistory] = useState<RegistryView[]>([]);
  const [compareIds, setCompareIds] = useState<string[] | null>(null);
  const [links, setLinks] = useState<ExternalLinkCheck[] | null>(null);
  const [busy, setBusy] = useState<"refresh" | "links" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call("external-api:catalog").then(setSnapshot).catch((caught: Error) => setError(caught.message));
  }, []);

  const open = useCallback((view: RegistryView) => setHistory((current) => [...current, view]), []);
  const back = useCallback(() => setHistory((current) => current.slice(0, -1)), []);
  const close = useCallback(() => setHistory([]), []);
  const closeCompare = useCallback(() => setCompareIds(null), []);

  const refresh = async () => {
    setBusy("refresh");
    try {
      const next = await call("external-api:refresh");
      setSnapshot(next);
      showToast({ tone: "success", title: "k-skill 스냅샷을 새로 받았습니다", detail: `${next.catalog.skills.length}개` });
    } catch (caught) {
      showToast({ tone: "error", title: "스냅샷을 받지 못했습니다(기존 스냅샷 유지)", detail: (caught as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const checkLinks = async () => {
    setBusy("links");
    try {
      setLinks(await call("external-api:check-links"));
    } catch (caught) {
      showToast({ tone: "error", title: "링크를 점검하지 못했습니다", detail: (caught as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Banner tone="err">{error}</Banner>;
  if (!snapshot) return <p className="muted">불러오는 중…</p>;
  const { catalog } = snapshot;
  const broken = links?.filter((link) => !link.ok) ?? [];

  return (
    <div className="ext-page">
      <div className="page-head">
        <h2>외부 API</h2>
        <span className="page-head-meta">
          정보원 {catalog.sources.length} · k-skill {catalog.skills.length} · 청사진 {catalog.blueprints.length} · 기술 {catalog.technologies.length}
        </span>
        <ToolbarSpacer />
        <StatusTag tone="muted">
          {snapshot.skillsSource === "refreshed" && snapshot.updatedAt
            ? `k-skill ${new Date(snapshot.updatedAt).toLocaleDateString("ko-KR")} 받음`
            : "k-skill 앱 기본 스냅샷"}
        </StatusTag>
        <button type="button" className="btn ghost" onClick={() => void refresh()} disabled={busy !== null}>
          {busy === "refresh" ? "받는 중…" : "스냅샷 새로고침"}
        </button>
        <button type="button" className="btn ghost" onClick={() => void checkLinks()} disabled={busy !== null}>
          {busy === "links" ? "점검 중…" : "공식 링크 점검"}
        </button>
      </div>
      {snapshot.warning && <Banner tone="warn">{snapshot.warning}</Banner>}
      {links && (
        <Banner tone={broken.length === 0 ? "ok" : "warn"}>
          공식 링크 {links.length - broken.length}/{links.length}개 정상
          {broken.length > 0 && `: ${broken.map((link) => `${link.name}(${link.status ?? link.error})`).join(", ")}`}
        </Banner>
      )}

      <Tabs<Tab> label="외부 API 목록" value={tab} onChange={setTab} items={TABS.map(({ id, label, icon: Icon }) => ({ id, label: <><Icon size={17} aria-hidden="true" /> {label}</> }))} />

      {tab === "sources" && <SourcesExplorer catalog={catalog} onOpen={open} onCompare={setCompareIds} />}
      {tab === "skills" && <RegistryTable kind="skill" catalog={catalog} onOpen={open} />}
      {tab === "blueprints" && <RegistryTable kind="blueprint" catalog={catalog} onOpen={open} />}
      {tab === "technologies" && <RegistryTable kind="technology" catalog={catalog} onOpen={open} />}

      {compareIds && <CompareDialog catalog={catalog} initialIds={compareIds} onOpen={open} onClose={closeCompare} />}
      <RegistryDialog catalog={catalog} view={history.at(-1) ?? null} canGoBack={history.length > 1} onOpen={open} onBack={back} onClose={close} />

      <p className="muted ext-credit">
        k-skill 목록은 NomaDamas/k-skill(MIT)에서 받습니다. 정보원 데이터는 각 기관의 공식 문서를 따릅니다.
      </p>
    </div>
  );
}
