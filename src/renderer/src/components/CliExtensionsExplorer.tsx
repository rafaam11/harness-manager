import { useEffect, useState } from "react";
import type { ProviderId } from "@shared/provider-types";
import type { ExtensionDescriptor, JsonValue, SettingsEdit } from "@shared/cli-settings-types";
import type { WorkbenchPlan } from "@shared/workbench-types";
import { call } from "../api/client";
import { Banner, EmptyState, StatusTag } from "./ui";
import { usePagination } from "./usePagination";
import { Pager } from "./Pager";
import { SettingValueEditor, initialValue } from "./SettingValueEditor";
import { useConfirmDialog } from "./confirm-dialog";

export default function CliExtensionsExplorer({ provider, revision, onPlan }: { provider: ProviderId; revision: number; onPlan(plan: WorkbenchPlan): void }) {
  const [extensions, setExtensions] = useState<ExtensionDescriptor[]>([]);
  const [query, setQuery] = useState(() => sessionStorage.getItem(`extensions-query-${provider}`) ?? "");
  const [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem(`extensions-selected-${provider}`));
  const [values, setValues] = useState<Record<string, JsonValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState("");
  const [dirty, setDirty] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  const work = async (task: () => Promise<void>) => { setBusy(true); setError(""); try { await task(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const load = async () => {
    // 저장 완료 후 재조회가 느려도 이미 적용한 편집에 이탈 확인을 띄우지 않는다.
    setDirty(false); setValues({}); setInvalid("");
    setExtensions(await call("cli-settings:extensions", provider));
  };
  useEffect(() => { void work(load); }, [provider, revision]);
  useEffect(() => {
    const guard = (event: Event) => { if (!dirty) return; event.preventDefault(); void confirm({ title: "옵션 편집을 마칠까요?", message: "아직 적용하지 않은 옵션이 있습니다.", confirmLabel: "편집 내용 버리기", danger: true }).then(ok => { if (ok) (event as CustomEvent<{ proceed(): void }>).detail.proceed(); }); };
    window.addEventListener("hm:before-navigate", guard); return () => window.removeEventListener("hm:before-navigate", guard);
  }, [dirty, confirm]);
  useEffect(() => { sessionStorage.setItem(`extensions-query-${provider}`, query); if (selected) sessionStorage.setItem(`extensions-selected-${provider}`, selected); }, [provider, query, selected]);
  const rows = extensions.filter(e => `${e.title} ${e.id} ${e.description}`.toLowerCase().includes(query.toLowerCase()));
  const pager = usePagination(rows.length, query);
  const item = extensions.find(e => e.id === selected);
  const select = async (id: string | null) => { if (dirty && !await confirm({ title: "다른 확장을 볼까요?", confirmLabel: "편집 내용 버리기", danger: true })) return; setSelected(id); setDirty(false); setValues({}); setInvalid(""); };
  const reviewOptions = () => void work(async () => {
    const edits: SettingsEdit[] = Object.entries(values).map(([id, value]) => ({ provider, id, operation: "set", value }));
    onPlan(await call("cli-settings:prepare", edits));
  });
  return <div className="cli-explorer">{error && <Banner tone="err">{error}</Banner>}
    <div className="pc-toolbar"><input className="cli-search" aria-label="확장 검색" placeholder="기능 이름·플러그인 검색" value={query} onChange={e => setQuery(e.target.value)} /><button className="btn ghost" disabled={busy || dirty} onClick={() => void work(load)}>다시 확인</button></div>
    <div className="pc-split"><section className="pc-master" aria-label="확장 목록"><div className="pc-table" role="table" aria-label="CLI 확장"><div className="cli-setting-columns pc-column-head" role="row"><span role="columnheader">확장</span><span role="columnheader">설치</span><span role="columnheader">사용</span></div><div className="pc-rows" ref={pager.ref} role="rowgroup">{rows.slice(pager.start, pager.start + pager.size).map(row => <div className="cli-setting-columns pc-row" role="row" key={row.id} aria-selected={selected === row.id}><span role="cell"><button className="pc-name" onClick={() => void select(row.id)}>{row.title}</button></span><span role="cell">{row.installed ? "설치됨" : "설치 안 됨"}</span><span role="cell">{row.enabled === null ? "확인 안 됨" : row.enabled ? "켜짐" : "꺼짐"}</span></div>)}{!rows.length && <EmptyState>{busy ? "확장을 확인하고 있습니다…" : "일치하는 확장이 없습니다."}</EmptyState>}</div></div><Pager count={rows.length} page={pager.page} pages={pager.pages} onChange={pager.setPage} /></section>
      <aside className="pc-detail" data-open={Boolean(item)} aria-label="확장 상세"><div className="pc-detail-title"><h2>{item?.title ?? "확장 상세"}</h2>{item && <button className="btn ghost" onClick={() => void select(null)}>닫기</button>}</div><div className="pc-scroll">{item ? <><code className="cli-key">{item.id}</code><p>{item.description}</p><div className="pc-inline"><StatusTag tone="muted">{provider === "claude" ? "Claude 전용" : "Codex 전용"}</StatusTag><span className="muted">{item.version ? `버전 ${item.version}` : "미설치"}</span></div><p>{item.detail}</p>{item.counterpart && <Banner tone="warn">대응 방식: {item.counterpart}</Banner>}{item.readonly && <Banner tone="warn">{item.readonly}</Banner>}
        {item.options.map(option => <section className="cli-option" key={option.id}><h3>{option.title}</h3><p className="muted">{option.description}</p>{option.readonly ? <p>{option.readonly}</p> : <SettingValueEditor key={option.id + revision} schema={option.schema} label={option.title} value={values[option.id] ?? option.desired?.value ?? option.current ?? (option.defaultDescription !== undefined ? JSON.parse(option.defaultDescription) : initialValue(option.schema))} onChange={value => { setValues(old => ({ ...old, [option.id]: value })); setDirty(true); }} onInvalid={setInvalid} />}</section>)}{!item.options.length && <p className="muted">이 확장이 공개한 편집 가능한 옵션은 없습니다.</p>}{invalid && <Banner tone="err">{invalid}</Banner>}
      </> : <EmptyState>확장을 선택하면 설치·켜기·끄기와 옵션을 관리합니다.</EmptyState>}</div>
      {item && !item.readonly && <footer className="pc-footer"><button className="btn ghost" disabled={busy || dirty} onClick={() => void work(async () => onPlan(await call("cli-settings:prepare", [], { provider, id: item.id, enabled: !item.enabled })))}>{item.installed ? item.enabled ? "끄기 검토" : "켜기 검토" : "설치·켜기 검토"}</button><button className="btn" disabled={busy || !dirty || Boolean(invalid)} onClick={reviewOptions}>옵션 변경 검토</button></footer>}</aside>
    </div>{dialog}
  </div>;
}
