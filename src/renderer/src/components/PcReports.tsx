import { useState } from "react";
import type { PcStatusPreview, PcStatusReport } from "@shared/pc-status-types";
import { call } from "../api/client";
import { Banner, Panel } from "./ui";

export function PcReports({ connected, onInspectPlugin }: { connected: boolean; onInspectPlugin?(provider: "claude" | "codex", pluginId: string): void }) {
  const [alias, setAlias] = useState("");
  const [preview, setPreview] = useState<PcStatusPreview | null>(null), [reports, setReports] = useState<PcStatusReport[]>([]);
  const [current, setCurrent] = useState<PcStatusReport | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const work = async (task: () => Promise<void>) => { setBusy(true); setError(""); setNotice(""); try { await task(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <Panel head="PC별 마지막 보고"><p>수동으로 보낸 마지막 전역 환경 상태입니다. 보고 시각을 기준으로 비교하며 실시간 접속 상태를 뜻하지 않습니다.</p>
    {error && <Banner tone="err">{error}</Banner>}{notice && <Banner tone="ok">{notice}</Banner>}
    <div className="pc-inline"><label>공유할 PC 별칭<input aria-label="공유할 PC 별칭" maxLength={40} value={alias} onChange={e => { setAlias(e.target.value); setPreview(null); }} placeholder="직접 정한 별칭" /></label><button className="btn ghost" disabled={busy} onClick={() => void work(async () => setAlias((await call("pc-status:identity")).alias))}>저장한 별칭</button></div>
    <div className="pc-inline"><button className="btn" disabled={busy || !connected || !alias.trim()} onClick={() => void work(async () => { const next = await call("pc-status:preview", alias.trim()); setPreview(next); setCurrent(next.report); })}>전송 내용 검토</button><button className="btn ghost" disabled={busy || !connected} onClick={() => void work(async () => { setReports(await call("pc-status:list")); setCurrent(await call("pc-status:current")); })}>다른 PC 보고 받기</button>{busy && <button className="btn ghost" onClick={() => void call("install:cancel")}>보고 작업 취소</button>}</div>
    <p className="muted">절대경로·프로젝트 이름·지침 본문·인증 정보·프롬프트·실행 로그를 제외합니다. 상태 보고를 받아도 PC 설정은 바뀌지 않습니다.</p>
    {preview && <><h3>전송할 상태 요약</h3><pre className="capture-diff">{JSON.stringify(preview.report, null, 2)}</pre><button className="btn" disabled={busy} onClick={() => void work(async () => { await call("pc-status:send", preview.token); setPreview(null); setNotice("이 PC의 마지막 상태를 보냈습니다. 공유 기준 전송은 별도입니다."); })}>검토한 PC 상태 보내기</button></>}
    {reports.map(report => <section key={report.pcId}><h3>{report.alias} · {new Date(report.reportedAt).toLocaleString("ko-KR")}</h3><p>CLI 버전: {Object.entries(report.cliVersions).map(([cli, version]) => `${cli} ${version}`).join(" · ") || "미확인"}</p><table className="pc-comparison"><thead><tr><th>항목·출처</th><th>마지막 보고</th><th>현재 PC·공유 기준</th></tr></thead><tbody>{report.items.map(item => {
      const local = current?.items.find(row => row.id === item.id);
      const differences = local ? [local.version !== item.version && "버전 차이", local.contentDigest && item.contentDigest && local.contentDigest !== item.contentDigest && "내용 차이", local.enabled !== item.enabled && "활성 설정 차이", local.managed !== item.managed && "공유 기준 포함 여부 차이"].filter(Boolean).join(" · ") : "";
      return <tr key={item.id}><td>{item.provider} · {item.name}<br />{item.source?.pluginId ?? "사용자 스킬"}</td><td>{item.stale ? "재확인 필요" : item.recognition === "confirmed" ? "인식됨" : "미검증"} · {item.version ?? "버전 미확인"}{item.enabled === false && " · 비활성"}</td><td>{!current ? "현재 PC 비교 미확인" : local ? `${local.recognition === "confirmed" && !local.stale ? "인식됨" : "미검증"} · ${local.managed ? "공유 기준 포함" : "공유 기준 제외"}${differences ? ` · ${differences}` : ""}` : item.source ? "이 PC에서 미발견 · 출처를 확인하고 설치를 검토하세요" : "이 PC에서 미발견 · 설치 출처가 없어 자동 설치할 수 없습니다"}{item.source && <button className="btn ghost" disabled={busy} onClick={() => onInspectPlugin?.(item.provider, item.source!.pluginId)}>플러그인 관리 열기</button>}</td></tr>;
    })}{current?.items.filter(item => !report.items.some(row => row.id === item.id)).map(item => <tr key={item.id}><td>{item.provider} · {item.name}</td><td>이 보고에 없음</td><td>현재 PC에서 발견 · {item.managed ? "공유 기준 포함" : "공유 기준 제외"}</td></tr>)}</tbody></table></section>)}
  </Panel>;
}
