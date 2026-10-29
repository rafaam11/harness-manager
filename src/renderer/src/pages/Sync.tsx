import { useEffect, useState } from "react";
import type { ProfileSyncStatus } from "@shared/setup-profile-types";
import type { WorkbenchPlan } from "@shared/workbench-types";
import { call } from "../api/client";
import { Banner, Check, PageHeader, Panel, StatusTag } from "../components/ui";
import { ChangePreview } from "../components/ChangePreview";
import type { PageContext } from "./registry";

export default function Sync({ navigate }: PageContext) {
  const [id, setId] = useState("");
  const [status, setStatus] = useState<ProfileSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [repository, setRepository] = useState("");
  const [create, setCreate] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [plan, setPlan] = useState<WorkbenchPlan | null>(null);
  const [direction, setDirection] = useState<"send" | "receive">("send");
  const load = async () => { const profiles = await call("profiles:list"); setId(profiles.activeId); setStatus(await call("profiles:github-status", profiles.activeId)); };
  const work = async (task: () => Promise<void>) => { setBusy(true); setError(""); try { await task(); } catch (e) { setError((e as Error).message); setPlan(null); } finally { setBusy(false); } };
  useEffect(() => { void work(load); }, []);
  const reviewSend = () => void work(async () => {
    const preview = await call("profiles:sync-plan", id, "send"); setDirection("send");
    setPlan({ token: preview.token, title: "내 설정 보내기", files: preview.changes.map(change => ({ path: change.file, diff: change.diff })), notes: preview.notes, commands: [], automatic: false, scope: "settings" });
  });
  return <div className="pc-page">
    <PageHeader title="동기화" meta="여러 PC에서 같은 내 설정 사용"><button className="btn ghost" disabled={busy} onClick={() => void work(load)}>다시 확인</button></PageHeader>
    {error && <Banner tone="err">{error}</Banner>}
    <div className="pc-settings-body">
      <Panel head="연결"><div className="pc-inline"><StatusTag tone={status?.connected ? "ok" : "muted"}>{status ? status.connected ? "연결됨" : "연결 안 됨" : "확인 중"}</StatusTag><strong>{status?.repository ?? "비공개 GitHub 저장소"}</strong>{status?.account && <span className="muted">{status.account}</span>}</div>
        <p>{status ? status.detail : "연결 상태 확인 중…"}</p>
        <button className="btn ghost" disabled={busy} onClick={() => setConnecting(!connecting)}>{connecting ? "연결 설정 닫기" : status?.connected ? "연결 변경" : "저장소 연결"}</button>
        {connecting && <div className="pc-connect"><label>저장소<input aria-label="동기화 저장소" placeholder="owner/private-repository" value={repository} onChange={e => setRepository(e.target.value)} /></label><Check checked={create} onChange={() => setCreate(!create)}>새 비공개 저장소 만들기</Check><button className="btn" disabled={busy || !repository} onClick={() => void work(async () => { await call("profiles:github-connect", id, repository, create); setConnecting(false); await load(); })}>연결</button></div>}
        {status && !status.available && <div className="pc-inline"><button className="btn ghost" disabled={busy} onClick={() => void work(async () => { await call("profiles:github-tools"); await load(); })}>GitHub 도구 준비</button><button className="btn ghost" disabled={busy} onClick={() => void work(async () => { await call("profiles:github-login"); await load(); })}>GitHub 로그인</button></div>}
      </Panel>
      <div className="pc-sync-grid">
        <Panel head="이 PC → 다른 PC"><p>{status?.outgoing ? "보낼 변경이 있습니다." : status?.connected ? "저장한 내 설정을 공유합니다." : "저장소 연결 후 사용할 수 있습니다."}</p><button className="btn" disabled={busy || !status?.connected || !status.available} onClick={reviewSend}>내 설정 보내기</button></Panel>
        <Panel head="다른 PC → 이 PC"><p>{status?.connected && !status.available ? "연결 상태를 먼저 확인하세요." : status?.changed ? "다른 PC의 변경이 있습니다." : status?.connected ? "다른 PC의 새 변경이 없습니다." : "저장소 연결 후 사용할 수 있습니다."}</p><button className="btn" disabled={busy || !status?.connected || !status.available} onClick={() => void work(async () => { setDirection("receive"); setPlan(await call("changes:receive")); })}>다른 PC의 변경 받기</button></Panel>
      </div>
      <p className="muted">받을 때 내 설정과 PC 변경을 함께 검토합니다. 로그인 정보는 전송하지 않습니다.</p>
      <button className="btn ghost" onClick={() => navigate("workbench")}>이 PC 설정 보기</button>
    </div>
    {busy && <button className="btn ghost pc-cancel" onClick={() => void call("profiles:cancel")}>작업 취소</button>}
    {plan && <ChangePreview plan={plan} busy={busy} onClose={() => setPlan(null)} applyLabel={direction === "send" ? "내 설정 보내기" : "이 PC에 적용"} onApply={() => void work(async () => { if (direction === "send") await call("profiles:sync", id, plan.token, {}); else await call("workbench:apply", plan.token); setPlan(null); await load(); })} />}
  </div>;
}
