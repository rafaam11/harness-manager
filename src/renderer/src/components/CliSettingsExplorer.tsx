import { useEffect, useState } from "react";
import type { ProviderId } from "@shared/provider-types";
import type { JsonValue, SettingsSnapshot, SettingDescriptor, SettingsEdit } from "@shared/cli-settings-types";
import { call } from "../api/client";
import { Banner, EmptyState, StatusTag } from "./ui";
import { usePagination } from "./usePagination";
import { Pager } from "./Pager";
import { SettingValueEditor, initialValue } from "./SettingValueEditor";
import { useConfirmDialog } from "./confirm-dialog";
import type { WorkbenchPlan } from "@shared/workbench-types";

export default function CliSettingsExplorer({ provider, revision, onPlan }: { provider: ProviderId; revision: number; onPlan(plan: WorkbenchPlan): void }) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [query, setQuery] = useState(() => sessionStorage.getItem(`settings-query-${provider}`) ?? "");
  const [category, setCategory] = useState("all");
  const [onlyManaged, setOnlyManaged] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem(`settings-selected-${provider}`));
  const [draft, setDraft] = useState<JsonValue>("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  const run = async (task: () => Promise<void>) => { setBusy(true); setError(""); try { await task(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { setDirty(false); setInvalid(""); void run(async () => setSnapshot(await call("cli-settings:list", provider))); }, [provider, revision]);
  useEffect(() => { sessionStorage.setItem(`settings-query-${provider}`, query); if (selected) sessionStorage.setItem(`settings-selected-${provider}`, selected); }, [query, selected, provider]);
  useEffect(() => {
    const guard = (event: Event) => { if (!dirty) return; event.preventDefault(); void confirm({ title: "설정 편집을 마칠까요?", message: "아직 적용하지 않은 값이 있습니다.", confirmLabel: "편집 내용 버리기", danger: true }).then(ok => { if (ok) (event as CustomEvent<{ proceed(): void }>).detail.proceed(); }); };
    window.addEventListener("hm:before-navigate", guard); return () => window.removeEventListener("hm:before-navigate", guard);
  }, [dirty, confirm]);
  const item = snapshot?.settings.find(s => s.id === selected);
  useEffect(() => { if (item && !dirty) setDraft(item.desired?.operation === "set" ? item.desired.value! : item.current ?? initialValue(item.schema, item.type)); }, [item, dirty]);
  const rows = snapshot?.settings.filter(s => (category === "all" || s.category === category) && (!onlyManaged || s.managed) && `${s.title} ${s.path.join(".")} ${s.description}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const pager = usePagination(rows.length, `${query}:${category}:${onlyManaged}`);
  const select = async (next: SettingDescriptor) => {
    if (dirty && !await confirm({ title: "다른 설정을 볼까요?", message: "아직 적용하지 않은 값이 있습니다.", confirmLabel: "편집 내용 버리기", danger: true })) return;
    setSelected(next.id); setDirty(false); setInvalid("");
  };
  const review = (operation: SettingsEdit["operation"]) => void run(async () => {
    const edit: SettingsEdit = { provider, id: item!.id, operation, ...(operation === "set" ? { value: draft } : {}) };
    onPlan(await call("cli-settings:prepare", [edit]));
  });
  return <div className="cli-explorer">
    {error && <Banner tone="err">{error}</Banner>}
    <div className="pc-toolbar"><input className="cli-search" aria-label="CLI 설정 검색" placeholder="설정 이름·키·설명 검색" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="설정 범주" value={category} onChange={e => setCategory(e.target.value)}><option value="all">모든 범주</option>{[...new Set(snapshot?.settings.map(s => s.category))].map(c => <option key={c} value={c}>{c}</option>)}</select><label className="check"><input type="checkbox" checked={onlyManaged} onChange={e => setOnlyManaged(e.target.checked)} />내 설정만</label><button className="btn ghost" disabled={busy} onClick={() => void run(async () => setSnapshot(await call("cli-settings:list", provider)))}>다시 확인</button></div>
    <div className="cli-caption muted">{snapshot?.version ?? "CLI 버전 확인 안 됨"} · 카탈로그 {snapshot?.schemaDate} · {snapshot?.settings.length ?? 0}개 항목</div>
    <div className="pc-split"><section className="pc-master" aria-label="CLI 설정 목록"><div className="pc-table" role="table" aria-label="CLI 설정"><div className="cli-setting-columns pc-column-head" role="row"><span role="columnheader">설정</span><span role="columnheader">범주</span><span role="columnheader">상태</span></div><div className="pc-rows" ref={pager.ref} role="rowgroup">{rows.slice(pager.start, pager.start + pager.size).map(s => <div className="cli-setting-columns pc-row" role="row" aria-selected={s.id === selected} key={s.id}><span role="cell"><button className="pc-name" title={s.path.join(".")} onClick={() => void select(s)}>{s.title === s.path.join(".") ? s.title : `${s.title} · ${s.path.join(".")}`}</button></span><span role="cell" className="muted">{s.category}</span><span role="cell">{s.readonly ? "읽기 전용" : s.managed ? "관리 중" : s.current === undefined ? "기본값" : "PC에 설정됨"}</span></div>)}{!rows.length && <EmptyState>{busy ? "설정을 읽고 있습니다…" : "일치하는 설정이 없습니다."}</EmptyState>}</div></div><Pager count={rows.length} page={pager.page} pages={pager.pages} onChange={pager.setPage} /></section>
      <aside className="pc-detail" data-open={Boolean(item)} aria-label="CLI 설정 상세"><div className="pc-detail-title"><h2>{item?.title ?? "설정 상세"}</h2>{item && <button className="btn ghost" onClick={() => { if (!dirty) setSelected(null); else void confirm({ title: "편집을 마칠까요?", confirmLabel: "편집 내용 버리기", danger: true }).then(ok => { if (ok) { setSelected(null); setDirty(false); } }); }}>닫기</button>}</div>
        <div className="pc-scroll">{item ? <><code className="cli-key">{item.path.join(".")}</code><p>{item.description}</p><StatusTag tone="muted">{item.managed ? "내 설정에 포함" : "이 PC의 저장값"}</StatusTag><p className="muted">기본값: {item.defaultDescription}</p><p className="muted">출처: {item.storage === "global" ? "Claude 전역 상태 파일" : item.storage === "managed" ? "조직 정책 전용" : "사용자 설정 파일"}</p>{item.desired && <details><summary>PC 저장값과 내 설정 비교</summary><pre className="wb-diff">{JSON.stringify({ "PC 저장값": item.current ?? "미지정", "내 설정": item.desired.operation === "remove" ? "기본값 사용" : item.desired.value }, null, 2)}</pre></details>}{item.readonly ? <><Banner tone="warn">{item.readonly}</Banner><pre className="wb-diff">{item.current === undefined ? "이 파일에는 지정된 값이 없습니다." : JSON.stringify(item.current, null, 2)}</pre></> : <SettingValueEditor key={item.id + ":" + revision} value={draft} schema={item.schema} label="설정값" onChange={value => { setDraft(value); setDirty(true); }} onInvalid={setInvalid} />}{invalid && <Banner tone="err">{invalid}</Banner>}<p className="muted">현재 세션의 최종 적용값은 별도 확인 대상입니다.</p>{item.source.startsWith("https://") && <button className="btn ghost" onClick={() => void call("app:open-external", item.source)}>공식 설명</button>}</> : <EmptyState>설정을 선택하면 현재 값과 편집기를 엽니다.</EmptyState>}</div>
        {item && !item.readonly && <footer className="pc-footer"><div className="pc-inline"><button className="btn ghost" disabled={busy} onClick={() => review("remove")}>기본값 사용</button>{item.managed && <button className="btn ghost" disabled={busy} onClick={() => review("release")}>관리 해제</button>}</div><button className="btn" disabled={busy || Boolean(invalid)} onClick={() => review("set")}>변경 검토</button></footer>}
      </aside></div>{dialog}
  </div>;
}
