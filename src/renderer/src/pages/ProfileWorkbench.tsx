import { useEffect, useState } from "react";
import type { WorkbenchPlan, WorkbenchSnapshot, VersionLock } from "@shared/workbench-types";
import Profiles from "./Profiles";
import { ChangePreview } from "./Workbench";
import { call } from "../api/client";
import { Panel, Banner } from "../components/ui";
import type { PageContext } from "./registry";
export default function ProfileWorkbench(props: PageContext) {
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null); const [plan, setPlan] = useState<WorkbenchPlan | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [lock, setLock] = useState<VersionLock | null>(null);
  const reload = () => call("workbench:snapshot").then(setSnapshot);
  useEffect(() => { const load = () => { void reload().catch(e => setError(e.message)); }; load(); window.addEventListener("hm:profile-changed", load); return () => window.removeEventListener("hm:profile-changed", load); }, []);
  const run = async (task: () => Promise<void>) => { setBusy(true); setError(""); try { await task(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <>{error && <Banner tone="err">{error}</Banner>}<Panel head="v4 관리와 자동 적용 정책"><p>{snapshot?.profile.name} · {snapshot?.migrated ? snapshot.automatic ? "일반 스킬·지침 전체 자동 적용" : "자동 적용 꺼짐" : "기존 프로필 · 전환 전 자동 쓰기 없음"}</p><p>원격 변경은 자동 확인하고, 이 PC의 변경을 공유할 때는 검토 후 보냅니다. 실행 코드·권한·hook·MCP·플러그인은 수동 검토합니다.</p><div className="wb-detail-actions"><button className="btn" disabled={busy} onClick={() => void run(reload)}>선택한 프로필 새로고침</button><button className="btn primary" disabled={busy || !snapshot || snapshot.profile.kind === "builtin"} onClick={() => void run(async () => setPlan(await call("workbench:migrate", !snapshot!.automatic)))}>{snapshot?.migrated ? snapshot.automatic ? "자동 적용 끄기" : "자동 적용 켜기" : "v4 전환·정책 검토"}</button><button className="btn" onClick={() => props.navigate("workbench")}>구성요소 편집</button></div></Panel><Panel head="버전과 재현성"><button className="btn" disabled={busy} onClick={() => void run(async () => setLock(await call("workbench:lock")))}>적용 버전 기록 보기</button>{lock && <><p>기록 시각: {lock.at || "아직 적용하지 않았습니다"}</p>{lock.entries.map(entry => <p key={entry.id}>{entry.id} · {entry.source.repository ?? "프로필"} · {entry.source.revision?.slice(0, 12) ?? entry.digest.slice(0, 12)}</p>)}{lock.environment?.map(entry => <p key={entry.id}>{entry.id} · {entry.version} · {entry.detail}</p>)}</>}</Panel><Profiles {...props} />{plan && <ChangePreview plan={plan} busy={busy} onClose={() => setPlan(null)} onApply={() => void run(async () => { await call("workbench:apply", plan.token); setPlan(null); await reload(); })} />}</>;
}
