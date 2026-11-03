import { useEffect, useState } from "react";
import type { AutomationStatus, VersionLock, WorkbenchPlan, WorkbenchSnapshot } from "@shared/workbench-types";
import { call } from "../api/client";
import { Banner, PageHeader, Panel, Tabs } from "../components/ui";
import { ChangePreview } from "../components/ChangePreview";
import type { PageContext, PageKey } from "./registry";

const MAINTENANCE_TOOLS: { page: PageKey; label: string; detail: string }[] = [
  { page: "dashboard", label: "환경 상태판", detail: "설치·설정 상태를 점검합니다." },
  { page: "install", label: "일괄 설치", detail: "프로필에 정의한 패키지·플러그인·MCP를 이 PC에 설치합니다." },
  { page: "capture", label: "이 PC의 설정 가져오기", detail: "이 PC에서 바꾼 설정을 프로필로 가져옵니다." },
  { page: "cleanup", label: "정리·복원", detail: "깨진 링크·중복 스킬·오래된 로그를 보관하고 되돌립니다." },
  { page: "external-api", label: "외부 API", detail: "정보원·k-skill·청사진 카탈로그를 봅니다." },
];

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
      {tab === "advanced" && <><Panel head="고급 프로필"><div className="pc-inline"><strong>{snapshot?.profile.name}</strong><button className="btn" onClick={() => navigate("profiles")}>고급 프로필 관리</button></div><p className="muted">설치 항목과 관리 설정을 표로 편집하고, 프로필을 파일이나 GitHub로 옮깁니다.</p></Panel>
      <Panel head="유지 관리"><table className="data-table"><thead><tr><th>도구</th><th>하는 일</th></tr></thead><tbody>{MAINTENANCE_TOOLS.map(tool => <tr key={tool.page}><td className="settings-tool-cell"><button className="btn ghost" onClick={() => navigate(tool.page)}>{tool.label}</button></td><td>{tool.detail}</td></tr>)}</tbody></table></Panel>
      <Panel head="적용 버전"><button className="btn ghost" disabled={busy} onClick={() => void work(async () => setLock(await call("workbench:lock")))}>버전 기록 보기</button>{lock && <><p className="muted">{lock.at ? `마지막 적용: ${lock.at}` : "적용 기록 없음"}</p>{(lock.entries.length > 0 || Boolean(lock.environment?.length)) && <table className="data-table"><thead><tr><th>구분</th><th>식별자</th><th>버전</th></tr></thead><tbody>{lock.entries.map(entry => <tr key={`component:${entry.id}`}><td>구성요소</td><td className="mono">{entry.id}</td><td className="mono">{entry.source.revision?.slice(0, 12) ?? entry.digest.slice(0, 12)}</td></tr>)}{lock.environment?.map(entry => <tr key={`environment:${entry.id}`}><td>환경</td><td className="mono">{entry.id}</td><td className="mono">{entry.version}</td></tr>)}</tbody></table>}</>}</Panel></>}
    </div>
    {plan && <ChangePreview plan={plan} busy={busy} onClose={() => setPlan(null)} onApply={() => void work(async () => { await call("workbench:apply", plan.token); setPlan(null); await load(); })} applyLabel="설정 저장" />}
  </div>;
}
