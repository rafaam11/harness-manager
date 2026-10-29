import { useEffect, useState } from "react";
import type { ChangeRecord, WorkbenchPlan, AutomationStatus } from "@shared/workbench-types";
import { call } from "../api/client";
import { Banner, EmptyState, PageHeader, Panel, StatusTag } from "../components/ui";
import { ChangePreview } from "./Workbench";
const STATUS = { pending: "적용 중", done: "완료", failed: "실패", restored: "복원됨", "recovery-needed": "복구 필요" };
export default function History() {
  const [records, setRecords] = useState<ChangeRecord[]>([]); const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [plan, setPlan] = useState<WorkbenchPlan | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const load = async () => { const [history, automation] = await Promise.all([call("workbench:history"), call("workbench:automation")]); setRecords(history); setStatus(automation); };
  const run = async (task: () => Promise<void>) => { setBusy(true); setError(""); try { await task(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { void run(load); }, []);
  return <div className="wb-page"><PageHeader title="변경 내역" meta="설정 변경·검증·복원 기록"><button className="btn" disabled={busy} onClick={() => void run(load)}>새로고침</button></PageHeader>{error && <Banner tone="err">{error}</Banner>}<Panel head="자동 적용"><p>{status?.detail}</p>{status?.checkedAt && <p>마지막 확인 {new Date(status.checkedAt).toLocaleString("ko-KR")}</p>}<button className="btn" disabled={busy} onClick={() => void run(async () => { await call("workbench:check"); await load(); })}>지금 확인</button>{status?.pending.map(p => <p key={p.id}>{p.name}: {p.reason}</p>)}</Panel>{!records.length && <EmptyState>아직 변경 기록이 없습니다. 작업대에서 적용한 변경이 여기에 쌓입니다.</EmptyState>}{records.map(record => <Panel key={record.id} head={<><StatusTag tone={record.status === "failed" || record.status === "recovery-needed" ? "warn" : "muted"}>{STATUS[record.status]}</StatusTag> {record.title}</>}><p>{new Date(record.at).toLocaleString("ko-KR")} · {record.actor === "automatic" ? "자동 적용" : "사용자 적용"}</p><p>{record.detail}</p>{record.files.map(file => <p key={file.path} className="muted">{file.path}</p>)}{record.restorable ? <button className="btn" disabled={busy} onClick={() => void run(async () => setPlan(await call("workbench:restore", record.id)))}>복원 미리보기</button> : <p className="muted">{record.files.length ? "복원 완료 또는 복원 대상 없음" : "진단·외부 명령 · 설정 복원 대상 없음"}</p>}</Panel>)}{plan && <ChangePreview plan={plan} busy={busy} onClose={() => setPlan(null)} onApply={() => void run(async () => { await call("workbench:apply", plan.token); setPlan(null); await load(); })} />}</div>;
}
