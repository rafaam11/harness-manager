import { useEffect, useState } from "react";
import type { ChangeRecord, WorkbenchPlan } from "@shared/workbench-types";
import { call } from "../api/client";
import { Banner, EmptyState, PageHeader, StatusTag } from "../components/ui";
import { ChangePreview } from "../components/ChangePreview";
import { Pager } from "../components/Pager";
import { usePagination } from "../components/usePagination";

const STATUS = { pending: "적용 중", done: "완료", failed: "실패", restored: "복원됨", "recovery-needed": "복구 필요" };
export default function History() {
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<WorkbenchPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => setRecords(await call("workbench:history"));
  const work = async (task: () => Promise<void>) => { setBusy(true); setError(""); try { await task(); } catch (e) { setError((e as Error).message); setPlan(null); } finally { setBusy(false); } };
  useEffect(() => { void work(load); }, []);
  const pager = usePagination(records.length);
  const record = records.find(record => record.id === selected);
  return <div className="pc-page">
    <PageHeader title="변경 기록" meta="적용 결과 확인과 복원"><button className="btn ghost" disabled={busy} onClick={() => void work(load)}>다시 확인</button></PageHeader>
    {error && <Banner tone="err">{error}</Banner>}
    <div className="pc-split">
      <section className="pc-master" aria-label="변경 기록 목록">
        <div className="pc-table" role="table" aria-label="변경 기록">
          <div className="pc-history-columns pc-column-head" role="row"><span role="columnheader">변경</span><span role="columnheader">결과</span><span role="columnheader">실행</span><span role="columnheader">시각</span></div>
          <div className="pc-rows" ref={pager.ref} role="rowgroup">{records.slice(pager.start, pager.start + pager.size).map(record => <div className="pc-history-columns pc-row" role="row" aria-selected={selected === record.id} key={record.id}>
            <span role="cell"><button className="pc-name" title={record.title} onClick={() => setSelected(record.id)}>{record.title}</button></span><span role="cell">{STATUS[record.status]}</span><span role="cell">{record.actor === "automatic" ? "자동" : "사용자"}</span><span role="cell" title={new Date(record.at).toLocaleString("ko-KR")}>{new Date(record.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>)}{!records.length && <EmptyState>아직 변경 기록이 없습니다.</EmptyState>}</div>
        </div>
        <Pager count={records.length} page={pager.page} pages={pager.pages} onChange={pager.setPage} />
      </section>
      <aside className="pc-detail" data-open={Boolean(record)} aria-label="변경 상세"><div className="pc-detail-title"><h2>{record?.title ?? "변경 상세"}</h2>{record && <button className="btn ghost" onClick={() => setSelected(null)}>닫기</button>}</div>
        <div className="pc-scroll">{record ? <><StatusTag tone={record.status === "failed" || record.status === "recovery-needed" ? "warn" : "muted"}>{STATUS[record.status]}</StatusTag><p>{new Date(record.at).toLocaleString("ko-KR")}</p><p>{record.detail}</p><p className="muted">{record.files.length}개 파일</p><details><summary>변경한 파일</summary>{record.files.map(file => <p className="pc-path" key={file.path}>{file.path}</p>)}</details>{!record.restorable && <p className="muted">{record.files.length ? "복원 완료 또는 복원 대상 없음" : "외부 명령·진단은 설정 복원 대상이 없습니다."}</p>}</> : <EmptyState>기록을 선택하면 결과와 복원 범위를 확인합니다.</EmptyState>}</div>
        {record?.restorable && <footer className="pc-footer"><span className="muted">이후 수정한 파일은 덮어쓰지 않습니다.</span><button className="btn" disabled={busy} onClick={() => void work(async () => setPlan(await call("workbench:restore", record.id)))}>복원 검토</button></footer>}
      </aside>
    </div>
    {plan && <ChangePreview plan={plan} busy={busy} onClose={() => setPlan(null)} applyLabel="검토한 변경 복원" onApply={() => void work(async () => { await call("workbench:apply", plan.token); setPlan(null); await load(); })} />}
  </div>;
}
