import { useEffect, useState } from "react";
import type { ProfileSyncPreview, ProfileSyncStatus } from "@shared/setup-profile-types";
import type { WorkbenchPlan } from "@shared/workbench-types";
import { ApiError, call } from "../api/client";
import { Banner, Check, PageHeader, Panel, StatusTag } from "../components/ui";
import { ChangePreview } from "../components/ChangePreview";
import { PcReports } from "../components/PcReports";
import ProfilePreviewDialog from "../components/ProfilePreviewDialog";
import { useConfirmDialog } from "../components/confirm-dialog";
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
  const [conflict, setConflict] = useState<ProfileSyncPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>({});
  const [logs, setLogs] = useState<string[]>([]);
  const { confirm, dialog } = useConfirmDialog();
  const load = async () => { const profiles = await call("profiles:list"); setId(profiles.activeId); setStatus(await call("profiles:github-status", profiles.activeId)); };
  const work = async (task: () => Promise<void>) => { setBusy(true); setError(""); try { await task(); } catch (e) { setError((e as Error).message); setPlan(null); } finally { setBusy(false); } };
  useEffect(() => {
    void work(load);
    return window.hm.on("profiles:log", (event) => setLogs((lines) => [...lines.slice(-100), event.text]));
  }, []);
  const reviewSend = () => void work(async () => {
    const preview = await call("profiles:sync-plan", id, "send"); setDirection("send");
    setPlan({ token: preview.token, title: "내 설정 보내기", files: preview.changes.map(change => ({ path: change.file, diff: change.diff })), notes: preview.notes, commands: [], automatic: false, scope: "settings" });
  });
  const reviewReceive = () => void work(async () => {
    setDirection("receive");
    try {
      setPlan(await call("changes:receive"));
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.status === 409)) throw caught;
      // 충돌만 파일별로 고를 수 있다. 다른 409(원격 없음 등)는 그대로 보여 준다.
      const preview = await call("profiles:sync-plan", id, "receive");
      if (!preview.conflicts.length) throw caught;
      setChoices({});
      setConflict(preview);
    }
  });
  // 확인은 work 밖에서 묻는다. 안에서 물으면 대화상자 뒤에서 busy와 취소 버튼이 먼저 뜬다.
  const prepareTools = async () => {
    const ok = await confirm({ title: "GitHub 도구 준비", message: "Windows에서 Git.Git과 GitHub.cli를 winget으로 설치합니다. 설치 후 열린 터미널을 다시 열어 주세요.", confirmLabel: "설치" });
    if (ok) void work(async () => { setLogs([]); await call("profiles:github-tools"); await load(); });
  };
  const connect = async () => {
    const repo = repository.trim();
    const ok = await confirm({
      title: create ? "비공개 저장소 만들기" : "저장소 연결",
      message: `${repo}\n${create ? "이 비공개 저장소를 새로 만듭니다." : "비공개 HM 프로필 저장소에 연결합니다."} 프로필 전송은 미리보기 후 별도로 실행합니다.`,
      confirmLabel: create ? "만들기" : "연결",
    });
    if (ok) void work(async () => { await call("profiles:github-connect", id, repo, create); setConnecting(false); await load(); });
  };
  return <div className="pc-page">
    {dialog}
    <PageHeader title="동기화" meta="여러 PC에서 같은 내 설정 사용"><button className="btn ghost" disabled={busy} onClick={() => void work(load)}>다시 확인</button></PageHeader>
    {/* 충돌 대화상자가 열려 있으면 오류는 대화상자 안에 보인다. */}
    {error && !conflict && <Banner tone="err">{error}</Banner>}
    <div className="pc-settings-body">
      <Panel head="연결"><div className="pc-inline"><StatusTag tone={status?.connected ? "ok" : "muted"}>{status ? status.connected ? "연결됨" : "연결 안 됨" : "확인 중"}</StatusTag><strong>{status?.repository ?? "비공개 GitHub 저장소"}</strong>{status?.account && <span className="muted">{status.account}</span>}</div>
        <p>{status ? status.detail : "연결 상태 확인 중…"}</p>
        <button className="btn ghost" disabled={busy} onClick={() => setConnecting(!connecting)}>{connecting ? "연결 설정 닫기" : status?.connected ? "연결 변경" : "저장소 연결"}</button>
        {connecting && <div className="pc-connect"><label>저장소<input aria-label="동기화 저장소" placeholder="owner/private-repository" value={repository} onChange={e => setRepository(e.target.value)} /></label><Check checked={create} onChange={() => setCreate(!create)}>새 비공개 저장소 만들기</Check><button className="btn" disabled={busy || !repository.trim()} onClick={() => void connect()}>연결</button></div>}
        {/* available은 gh 호출 성공 여부다. 이미 다른 계정으로 로그인한 PC도 연결 설정에서 계정을 바꿀 수 있어야 한다. */}
        {(connecting || (status && !status.available)) && <div className="pc-inline"><button className="btn ghost" disabled={busy} onClick={() => void prepareTools()}>GitHub 도구 준비</button><button className="btn ghost" disabled={busy} onClick={() => void work(async () => { setLogs([]); await call("profiles:github-login"); await load(); })}>GitHub 로그인</button></div>}
        {/* gh auth login의 일회용 코드가 여기 나온다. 없으면 로그인을 마칠 수 없다. */}
        {logs.length > 0 && <pre className="capture-diff">{logs.join("\n")}</pre>}
      </Panel>
      <div className="pc-sync-grid">
        <Panel head="이 PC → 다른 PC"><p>{status?.outgoing ? "보낼 변경이 있습니다." : status?.connected ? "저장한 내 설정을 공유합니다." : "저장소 연결 후 사용할 수 있습니다."}</p><button className="btn" disabled={busy || !status?.connected || !status.available} onClick={reviewSend}>내 설정 보내기</button></Panel>
        <Panel head="다른 PC → 이 PC"><p>{status?.connected && !status.available ? "연결 상태를 먼저 확인하세요." : status?.changed ? "다른 PC의 변경이 있습니다." : status?.connected ? "다른 PC의 새 변경이 없습니다." : "저장소 연결 후 사용할 수 있습니다."}</p><button className="btn" disabled={busy || !status?.connected || !status.available} onClick={reviewReceive}>다른 PC의 변경 받기</button></Panel>
      </div>
      <p className="muted">받을 때 내 설정과 PC 변경을 함께 검토합니다. 로그인 정보는 전송하지 않습니다.</p>
      <button className="btn ghost" onClick={() => navigate("workbench")}>이 PC 설정 보기</button>
      <PcReports connected={Boolean(status?.connected && status.available)} onInspectPlugin={(provider, pluginId) => { localStorage.setItem("hm-cli-scope", provider); sessionStorage.setItem("hm-cli-entry-mode", "extensions"); sessionStorage.setItem(`extensions-selected-${provider}`, pluginId); sessionStorage.setItem(`extensions-query-${provider}`, pluginId); navigate("workbench"); }} />
    </div>
    {busy && <button className="btn ghost pc-cancel" onClick={() => void call("profiles:cancel")}>작업 취소</button>}
    {plan && <ChangePreview plan={plan} busy={busy} onClose={() => setPlan(null)} applyLabel={direction === "send" ? "내 설정 보내기" : "이 PC에 적용"} onApply={() => void work(async () => { if (direction === "send") await call("profiles:sync", id, plan.token, {}); else await call("workbench:apply", plan.token); setPlan(null); await load(); })} />}
    {/* 충돌 선택은 쓰기 없이 병합 계획을 만들며 PC 영향까지 한 번 더 검토한다. */}
    {conflict && <ProfilePreviewDialog
      preview={conflict}
      action="sync"
      busy={busy}
      error={error}
      choices={choices}
      onChoose={(file, choice) => setChoices({ ...choices, [file]: choice })}
      onApply={() => void work(async () => { const next = await call("changes:resolved-receive", id, conflict.token, choices); setConflict(null); setDirection("receive"); setPlan(next); })}
      onClose={() => { setConflict(null); setError(""); }}
    />}
  </div>;
}
