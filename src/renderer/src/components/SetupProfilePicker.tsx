import { useEffect, useState } from "react";
import type { SetupProfiles } from "@shared/setup-profile-types";
import { call } from "../api/client";
import { Banner, Panel, Toolbar } from "./ui";

export default function SetupProfilePicker({ disabled, onChanged }: { disabled: boolean; onChanged(): void }) {
  const [state, setState] = useState<SetupProfiles | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void call("profiles:list").then(setState).catch((caught: Error) => setError(caught.message)); }, []);
  const update = async (work: () => Promise<SetupProfiles>) => {
    setBusy(true); setError("");
    try { setState(await work()); onChanged(); }
    catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  };
  const active = state?.profiles.find((profile) => profile.id === state.activeId);
  return <Panel head={<span className="panel-title">사용자 프로필</span>}>
    <p>선택한 프로필의 패키지·설정·플러그인만 적용합니다. core / dev / full은 그 안의 설치 범위입니다.</p>
    {error && <Banner tone="err">{error}</Banner>}
    <Toolbar>
      <label>사용할 프로필 <select aria-label="사용할 프로필" disabled={disabled || busy || !state} value={state?.activeId ?? "default"} onChange={(event) => void update(() => call("profiles:select", event.target.value))}>
        {state?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select></label>
    </Toolbar>
    {active && <p className="muted">프로필 위치: {active.root}</p>}
    {active?.kind === "legacy" && <Banner tone="warn">이 프로필은 기존 jinmin 개인 설정입니다. 다른 사용자에게 자동 적용되지 않습니다. 아래에서 개인 사본을 만들어 분리할 수 있습니다.</Banner>}
    <Toolbar>
      <input className="search" aria-label="새 프로필 이름" placeholder="개인 프로필 이름" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={disabled || busy} />
      <button className="btn ghost" disabled={disabled || busy || !name.trim() || !state} onClick={() => void update(() => call("profiles:create", name.trim(), state!.activeId))}>현재 프로필 복사</button>
      <button className="btn ghost" disabled={disabled || busy || !name.trim()} onClick={() => void update(() => call("profiles:connect", name.trim()))}>프로필 폴더 연결</button>
    </Toolbar>
    <p className="muted">개인 프로필은 로컬 폴더에 보관합니다. 비공개 Git 저장소를 별도로 클론한 폴더도 연결할 수 있습니다. 토큰·로그인 파일은 포함하지 않습니다.</p>
  </Panel>;
}
