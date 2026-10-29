import { useEffect, useState } from "react";
import type { AutomationStatus, VersionLock, WorkbenchPlan, WorkbenchSnapshot } from "@shared/workbench-types";
import { call } from "../api/client";
import { Banner, PageHeader, Panel, Tabs } from "../components/ui";
import { ChangePreview } from "../components/ChangePreview";
import type { PageContext } from "./registry";

export default function Settings({ navigate }: PageContext) {
  const [tab, setTab] = useState<"general" | "advanced">("general");
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [lock, setLock] = useState<VersionLock | null>(null);
  const [plan, setPlan] = useState<WorkbenchPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => { const [snapshot, status] = await Promise.all([call("workbench:snapshot"), call("workbench:automation")]); setSnapshot(snapshot); setStatus(status); };
  const work = async (task: () => Promise<void>) => { setBusy(true); setError(""); try { await task(); } catch (e) { setError((e as Error).message); setPlan(null); } finally { setBusy(false); } };
  useEffect(() => { void work(load); }, []);
  return <div className="pc-page"><PageHeader title="앱 설정" /><Tabs<"general" | "advanced"> label="앱 설정" value={tab} onChange={setTab} items={[{ id: "general", label: "일반" }, { id: "advanced", label: "고급" }]} />
    {error && <Banner tone="err">{error}</Banner>}
    <div className="pc-settings-body">
      {tab === "general" && <><Panel head="문서 자동 적용"><div className="pc-inline"><strong>{snapshot?.automatic ? "켜짐" : "꺼짐"}</strong><button className="btn ghost" disabled={busy || !snapshot || snapshot.profile.kind === "builtin"} onClick={() => void work(async () => setPlan(await call("workbench:migrate", !snapshot!.automatic)))}>{snapshot?.automatic ? "자동 적용 끄기" : "자동 적용 켜기"}</button></div><p>일반 스킬과 지침만 자동으로 맞춥니다. 실행 코드·권한·hook·MCP·패키지는 검토를 기다립니다.</p><p className="muted">{snapshot?.profile.kind === "builtin" ? "첫 항목을 추가하면 내 설정을 준비합니다." : status?.detail}</p><button className="btn ghost" disabled={busy} onClick={() => void work(async () => { await call("workbench:check"); await load(); })}>지금 확인</button></Panel>
      {status?.pending.length ? <Panel head="검토 대기">{status.pending.map(item => <p key={item.id}>{item.name} · {item.reason}</p>)}</Panel> : null}
      <Panel head="앱 업데이트"><p>설치된 앱의 새 버전을 확인합니다.</p><button className="btn ghost" disabled={busy} onClick={() => void work(async () => { await call("updater:check"); })}>업데이트 확인</button></Panel></>}
      {tab === "advanced" && <><Panel head="내 설정 저장소"><p>현재: {snapshot?.profile.name}</p><p className="muted">여러 설정 사본, 폴더 연결, 원본 파일과 이동 항목을 관리합니다.</p><button className="btn ghost" onClick={() => navigate("profiles")}>고급 프로필 관리</button></Panel>
      <Panel head="유지 관리"><div className="pc-inline"><button className="btn ghost" onClick={() => navigate("dashboard")}>환경 상태판</button><button className="btn ghost" onClick={() => navigate("install")}>일괄 설치</button><button className="btn ghost" onClick={() => navigate("capture")}>이 PC의 설정 가져오기</button><button className="btn ghost" onClick={() => navigate("cleanup")}>정리·복원</button><button className="btn ghost" onClick={() => navigate("external-api")}>외부 API</button></div></Panel>
      <Panel head="적용 버전"><button className="btn ghost" disabled={busy} onClick={() => void work(async () => setLock(await call("workbench:lock")))}>버전 기록 보기</button>{lock && <><p>{lock.at || "적용 기록 없음"}</p>{lock.entries.map(entry => <p key={entry.id}>{entry.id} · {entry.source.revision?.slice(0, 12) ?? entry.digest.slice(0, 12)}</p>)}{lock.environment?.map(entry => <p key={entry.id}>{entry.id} · {entry.version}</p>)}</>}</Panel></>}
    </div>
    {plan && <ChangePreview plan={plan} busy={busy} onClose={() => setPlan(null)} onApply={() => void work(async () => { await call("workbench:apply", plan.token); setPlan(null); await load(); })} applyLabel="설정 저장" />}
  </div>;
}
