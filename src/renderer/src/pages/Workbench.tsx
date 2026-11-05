import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import type { ComponentDefinition, ManagedComponent, WorkbenchPlan, WorkbenchSnapshot, RecognitionScope } from "@shared/workbench-types";
import { COMPONENT_LABELS } from "@shared/workbench-types";
import { call } from "../api/client";
import { Banner, EmptyState, PageHeader, Tabs } from "../components/ui";
import { ChangePreview } from "../components/ChangePreview";
import { ComponentEditor } from "../components/ComponentEditor";
import { ComponentDetail, observationLabel } from "../components/ComponentDetail";
import { WorkbenchTools, type WorkbenchTool } from "../components/WorkbenchTools";
import { Pager } from "../components/Pager";
import { usePagination } from "../components/usePagination";
import { useConfirmDialog } from "../components/confirm-dialog";

import CliSettingsExplorer from "../components/CliSettingsExplorer";
import CliExtensionsExplorer from "../components/CliExtensionsExplorer";

export default function Workbench() {
  const [scope, setScope] = useState<"common" | "claude" | "codex">(() => { const saved = localStorage.getItem("hm-cli-scope"); return saved === "common" || saved === "claude" ? saved : "codex"; });
  const [mode, setMode] = useState<"settings" | "extensions" | "components">(() => sessionStorage.getItem("hm-cli-entry-mode") === "extensions" ? "extensions" : "components");
  useEffect(() => { sessionStorage.removeItem("hm-cli-entry-mode"); }, []);
  const [inspectionScope, setInspectionScope] = useState<RecognitionScope | null>(null);
  const [revision, setRevision] = useState(0);
  const navigateScope = (next: () => void) => { const proceed = () => { setEditor(null); next(); }; if (window.dispatchEvent(new CustomEvent("hm:before-navigate", { cancelable: true, detail: { proceed } }))) proceed(); };
  useEffect(() => { localStorage.setItem("hm-cli-scope", scope); localStorage.setItem("hm-cli-mode", mode); }, [scope, mode]);
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const loadSequence = useRef(0), workCount = useRef(0);
  const [query, setQuery] = useState(() => localStorage.getItem("hm-component-query") ?? "");
  useEffect(() => { localStorage.setItem("hm-component-query", query); }, [query]);
  const [kind, setKind] = useState("all");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [plan, setPlan] = useState<WorkbenchPlan | null>(null);
  const [editor, setEditor] = useState<ComponentDefinition | null>(null);
  const [original, setOriginal] = useState("");
  const [editingExisting, setEditingExisting] = useState(false);
  const [tool, setTool] = useState<WorkbenchTool | null>(null);
  const { confirm, dialog } = useConfirmDialog();
  const dirty = editor !== null && JSON.stringify(editor) !== original;
  const load = async (refresh = false, selectedScope = inspectionScope) => {
    const sequence = ++loadSequence.current;
    const next = scope === "common" ? await call("workbench:snapshot") : await call("recognition:list", { provider: scope, scopeId: selectedScope?.id ?? "global", refresh });
    if (sequence !== loadSequence.current) return;
    setSnapshot(next);
    setChecked(current => current.filter(id => next.components.some(item => item.id === id)));
  };
  const work = async (task: () => Promise<void>) => { workCount.current++; setBusy(true); setError(""); setNotice(""); try { await task(); } catch (e) { setError((e as Error).message); setPlan(null); } finally { workCount.current--; setBusy(workCount.current > 0); } };
  useEffect(() => { void work(async () => { await load(true); }); }, [scope]);
  useEffect(() => {
    const beforeNavigate = (event: Event) => {
      // 적용 후 목록을 다시 읽는 동안에도 이동은 허용한다. 보호할 대상은 미적용 편집이다.
      if (!dirty) return;
      event.preventDefault();
      if (!busy) void confirm({ title: "편집을 마칠까요?", message: "아직 적용하지 않은 내용이 있습니다.", confirmLabel: "편집 내용 버리기", danger: true }).then(ok => { if (ok) (event as CustomEvent<{ proceed(): void }>).detail.proceed(); });
    };
    window.addEventListener("hm:before-navigate", beforeNavigate);
    return () => window.removeEventListener("hm:before-navigate", beforeNavigate);
  }, [dirty, busy, confirm]);
  const leaveEditor = async () => !dirty || await confirm({ title: "편집을 마칠까요?", message: "아직 적용하지 않은 내용이 있습니다.", confirmLabel: "편집 내용 버리기", danger: true });
  const edit = (value: ComponentDefinition) => { setEditor(value); setEditingExisting(Boolean(value.id)); setOriginal(JSON.stringify(value)); setTool(null); };
  const create = async (kind: "skill" | "instruction") => {
    if (!await leaveEditor()) return;
    edit({ id: "", name: "", kind, description: "", targets: ["claude", "codex"], source: { kind: "profile" }, files: { [kind === "skill" ? "SKILL.md" : "instructions.md"]: "" } });
  };
  const item = snapshot?.components.find(row => row.id === selected);
  const rows = snapshot?.components.filter(row => {
    const observations = row.observations.filter(o => scope === "common" || o.provider === scope);
    return (scope === "common" ? row.managed : observations.length > 0 && (row.kind !== "environment" || kind === "environment")) && (kind === "all" || row.kind === kind) && (filter !== "managed" || row.managed) && (filter !== "outside" || !row.managed) && (filter !== "confirmed" || observations.some(o => o.recognition === "confirmed" && !o.stale)) && (filter !== "disabled" || observations.some(o => o.enabled === false)) && (filter !== "unverified" || observations.some(o => o.recognition !== "confirmed" || o.stale)) && (filter !== "issues" || row.issue || observations.some(o => o.installed === false)) && `${row.name} ${row.description} ${row.source}`.toLowerCase().includes(query.toLowerCase());
  }) ?? [];
  const pager = usePagination(rows.length, `${query}:${kind}:${filter}`);
  const select = async (row: ManagedComponent) => { if (await leaveEditor()) { setSelected(row.id); setEditor(null); } };
  const closeDetail = async () => { if (await leaveEditor()) { setEditor(null); setSelected(null); } };
  const apply = () => void work(async () => {
    try { await call("workbench:apply", plan!.token); } catch (error) { await load(); throw error; }
    const id = editor?.id;
    setPlan(null); setEditor(null); setTool(null); setChecked([]);
    if (id) setSelected(`definition:${id}`);
    setRevision(value => value + 1);
    await load(scope !== "common"); setNotice(plan!.title.includes("연결 검사") ? "검사를 마쳤습니다. 진단 탭에서 결과를 확인하세요." : "파일 저장·적용을 마쳤습니다. CLI 인식 결과는 진단에서 별도로 확인하세요. 공유하려면 동기화에서 보내기를 검토하세요.");
  });
  return <div className="pc-page" onClick={event => { const button = (event.target as HTMLElement).closest(".pc-menu button"); button?.closest("details")?.removeAttribute("open"); }}>
    <PageHeader title="이 PC" meta={<span role="status">{notice || (scope !== "common" && mode !== "components" ? "CLI별 설정과 확장 관리" : snapshot ? `${rows.length}개 항목 · 차이 ${snapshot.components.filter(row => row.issue).length}개` : "환경 확인 중")}</span>}>
      {(scope === "common" || mode === "components") && <button className="btn ghost" disabled={busy} onClick={() => void work(async () => { await load(true); })}><RefreshCw size={16} /> 다시 확인</button>}
      {(scope === "common" || mode === "components") && <details className="pc-menu"><summary className="btn" role="button"><Plus size={16} /> 추가</summary><div><button disabled={busy} onClick={() => void create("skill")}>새 스킬</button><button disabled={busy} onClick={() => void create("instruction")}>새 지침</button><button disabled={busy} onClick={() => setTool("github")}>GitHub에서 가져오기</button></div></details>}
    </PageHeader>
    {error && <Banner tone="err">{error}</Banner>}
    <div className="pc-inline cli-scope"><Tabs<"common" | "claude" | "codex"> label="이 PC 대상" value={scope} onChange={value => navigateScope(() => { setScope(value); setMode("components"); setSelected(null); })} items={[{ id: "common", label: "공통" }, { id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex" }]} />{scope !== "common" && <Tabs<"settings" | "extensions" | "components"> label="CLI 관리" value={mode} onChange={value => navigateScope(() => setMode(value))} items={[{ id: "components", label: "CLI 인식 목록" }, { id: "settings", label: "설정" }, { id: "extensions", label: "확장" }]} />}</div>
    {scope !== "common" && mode === "components" && <>
      <div className="pc-inline"><span>검사 범위: {inspectionScope?.kind === "project" ? `프로젝트 · ${inspectionScope.cwd}` : "전역"}</span><button className="btn ghost" disabled={busy} onClick={() => void work(async () => { const next = await call("recognition:scope", true); if (next) { setInspectionScope(next); setSelected(null); await load(true, next); } })}>프로젝트 선택</button>{inspectionScope?.kind === "project" && <button className="btn ghost" disabled={busy} onClick={() => void work(async () => { setInspectionScope(null); setSelected(null); await load(false, null); })}>전역으로</button>}{busy && <button className="btn ghost" onClick={() => void call("install:cancel")}>검사 취소</button>}</div>
      {snapshot?.recognition?.filter(report => report.provider === scope).map(report => <Banner key={report.provider} tone={report.status === "success" && !report.stale ? "ok" : "warn"}>{report.stale ? "재확인 필요 · " : ""}{report.detail}{report.lastSuccessAt && ` · 마지막 성공 ${new Date(report.lastSuccessAt).toLocaleString("ko-KR")}`} · {report.version}</Banner>)}
    </>}
    {scope !== "common" && mode === "settings" ? <CliSettingsExplorer key={scope} provider={scope} revision={revision} onPlan={setPlan} /> : scope !== "common" && mode === "extensions" ? <CliExtensionsExplorer key={scope} provider={scope} revision={revision} onPlan={setPlan} /> : <>
    <div className="pc-toolbar">
      <label className="pc-search"><Search size={16} /><input aria-label="구성요소 검색" placeholder="이름, 설명 검색" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <select aria-label="구성요소 종류" value={kind} onChange={e => setKind(e.target.value)}><option value="all">모든 종류</option>{Object.entries(COMPONENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="구성요소 필터" value={filter} onChange={e => setFilter(e.target.value)}>{[["all", "전체"], ["confirmed", "인식됨"], ["disabled", "비활성"], ["unverified", "미검증"], ["outside", "공유 기준 제외"], ["managed", "공유 기준 포함"], ["issues", "차이 있음"]].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <details className="pc-menu"><summary className="btn ghost" role="button">더 보기</summary><div><button disabled={busy} onClick={() => setTool("updates")}>업데이트 확인</button><button onClick={() => setTool("diagnostics")}>환경 진단</button></div></details>
    </div>
    <div className="pc-split">
      <section className="pc-master" aria-label="구성요소 목록">
        <div role="table" aria-label="이 PC 구성요소" className="pc-table">
          <div role="row" className="pc-columns pc-column-head"><span role="columnheader" /><span role="columnheader">이름</span><span role="columnheader">종류</span><span role="columnheader">Claude</span><span role="columnheader">Codex</span></div>
          <div role="rowgroup" className="pc-rows" ref={pager.ref}>
            {rows.slice(pager.start, pager.start + pager.size).map(row => <div role="row" className="pc-columns pc-row" aria-selected={row.id === selected} key={row.id}>
              <span role="cell">{row.managed && <input type="checkbox" aria-label={`${row.name} 선택`} checked={checked.includes(row.id)} onChange={() => setChecked(ids => ids.includes(row.id) ? ids.filter(id => id !== row.id) : [...ids, row.id])} />}</span>
              <span role="cell"><button className="pc-name" aria-label={row.name} title={`${row.name} · ${row.source}`} disabled={busy} onClick={() => void select(row)}>{row.name}<span className="pc-origin">{row.source}</span></button></span>
              <span role="cell" className="muted">{COMPONENT_LABELS[row.kind]}</span>
              {(["claude", "codex"] as const).map(provider => { const observation = row.observations.find(o => o.provider === provider); return <span role="cell" key={provider} data-issue={observation?.comparison === "different" || observation?.installed === false}>{observationLabel(observation)}</span>; })}
            </div>)}
            {!rows.length && <EmptyState>{busy ? "확인하고 있습니다…" : "조건에 맞는 항목이 없습니다."}</EmptyState>}
          </div>
        </div>
        <Pager count={rows.length} page={pager.page} pages={pager.pages} onChange={pager.setPage} />
        <footer className="pc-footer"><span className="muted">{checked.length ? `${checked.length}개 선택` : "항목을 선택해 자세히 보세요"}</span><button className="btn" disabled={busy || !checked.length} onClick={() => void work(async () => setPlan(await call("workbench:preview", checked)))}>변경 검토</button></footer>
      </section>
      <aside className="pc-detail" data-open={Boolean(editor || item)} aria-label="선택한 항목">
        <div className="pc-detail-title"><h2>{editor ? editingExisting ? editor.name : "새 항목" : item?.name ?? "항목 상세"}</h2><button className="btn ghost" aria-label="상세 닫기" disabled={busy} onClick={() => void closeDetail()}><X size={16} /></button></div>
        {editor ? <ComponentEditor value={editor} existing={editingExisting} busy={busy} onChange={setEditor} onCancel={() => void closeDetail()} onReview={() => void work(async () => setPlan(await call("changes:prepare", editor)))} /> : item ? <ComponentDetail item={item} scopeId={inspectionScope?.id ?? "global"} busy={busy} work={task => void work(task)} onPlan={setPlan} onEdit={edit} onManagePlugin={(provider, pluginId) => navigateScope(() => { sessionStorage.setItem(`extensions-selected-${provider}`, pluginId); sessionStorage.setItem(`extensions-query-${provider}`, pluginId); setScope(provider); setMode("extensions"); })} /> : <EmptyState>목록에서 항목을 선택하세요.<p>설정과 진단을 여기에서 확인합니다.</p></EmptyState>}
      </aside>
    </div>
    </>}
    {tool && <WorkbenchTools tool={tool} busy={busy} error={error} warnings={snapshot?.warnings ?? []} work={task => void work(task)} onPlan={setPlan} onClose={() => setTool(null)} />}
    {plan && <ChangePreview plan={plan} busy={busy} onClose={() => setPlan(null)} onApply={apply} applyLabel={plan.title.includes("연결 검사") ? "검사 실행" : "이 PC에 적용"} />}
    {dialog}
  </div>;
}
