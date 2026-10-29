import { useEffect, useState } from "react";
import type { ManagedComponent, ComponentObservation, ChangeRecord, WorkbenchPlan, ComponentDefinition } from "@shared/workbench-types";
import { COMPONENT_LABELS, COMPATIBILITY_LABELS } from "@shared/workbench-types";
import { call } from "../api/client";
import { Banner, StatusTag, Tabs } from "./ui";

export function observationLabel(observation?: ComponentObservation) {
  if (!observation) return "—";
  if (observation.compatibility === "unsupported") return "미지원";
  if (observation.comparison === "outside") return "대상 아님";
  if (observation.comparison === "match") return "설정 일치";
  if (observation.comparison === "different") return "설정 차이";
  if (observation.installed === false) return "설치 안 됨";
  if (observation.installed === true) return observation.enabled === false ? "꺼짐" : "설치됨";
  return "확인 못함";
}
export function ComponentDetail({ item, busy, work, onPlan, onEdit }: {
  item: ManagedComponent; busy: boolean; work(task: () => Promise<void>): void;
  onPlan(plan: WorkbenchPlan): void; onEdit(value: ComponentDefinition): void;
}) {
  const [tab, setTab] = useState<"settings" | "diagnostics" | "history">("settings");
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  const [recognition, setRecognition] = useState<{ cwd: string; skills: string[] } | null>(null);
  useEffect(() => { setTab("settings"); setRecognition(null); }, [item.id]);
  const relevant = records.filter(record => record.files.some(file => file.path.replaceAll("\\", "/").includes(`/skills/${item.definitionId ?? item.name}/`) || (item.kind === "instruction" && /(?:CLAUDE|AGENTS)\.md$/.test(file.path))));
  return <>
    <Tabs label="항목 상세" value={tab} onChange={value => { setTab(value); if (value === "history") work(async () => setRecords(await call("workbench:history"))); }} items={[{ id: "settings", label: "설정" }, { id: "diagnostics", label: "진단" }, { id: "history", label: "기록" }]} />
    <div className="pc-scroll">
      {tab === "settings" && <><StatusTag tone="muted">{item.managed ? "내 설정에 포함" : "이 PC에만 있음"}</StatusTag><p>{item.description || COMPONENT_LABELS[item.kind]}</p>
        <table className="pc-comparison"><thead><tr><th>대상</th><th>상태</th></tr></thead><tbody>{(["claude", "codex"] as const).map(provider => <tr key={provider}><td>{provider === "claude" ? "Claude Code" : "Codex"}</td><td>{observationLabel(item.observations.find(o => o.provider === provider))}</td></tr>)}</tbody></table>
        <dl className="pc-facts"><dt>출처</dt><dd>{item.source}</dd><dt>종류</dt><dd>{COMPONENT_LABELS[item.kind]}</dd></dl>{item.issue && <Banner tone="warn">{item.issue}</Banner>}
      </>}
      {tab === "diagnostics" && <>{item.observations.map(observation => <section key={observation.provider}><h3>{observation.provider === "claude" ? "Claude Code" : "Codex"}</h3><dl className="pc-facts"><dt>호환성</dt><dd>{COMPATIBILITY_LABELS[observation.compatibility]}</dd><dt>세션 인식</dt><dd>{observation.recognition === "confirmed" || (observation.provider === "codex" && recognition?.skills.includes(item.definitionId ?? item.name)) ? "확인됨" : "확인 안 됨"}</dd><dt>실행 검사</dt><dd>{observation.execution === "confirmed" ? "확인됨" : "확인 안 됨"}</dd>{observation.version && <><dt>버전</dt><dd>{observation.version}</dd></>}<dt>확인 시각</dt><dd>{new Date(observation.checkedAt).toLocaleString("ko-KR")}</dd></dl><p>{observation.detail}</p></section>)}
        {item.kind === "mcp" && item.id.startsWith("mcp:") && <button className="btn ghost" disabled={busy} onClick={() => work(async () => onPlan(await call("workbench:probe", item.id)))}>MCP 연결 검사</button>}
        {item.kind === "skill" && <button className="btn ghost" disabled={busy} onClick={() => work(async () => setRecognition(await call("catalog:codex-visible-skills")))}>Codex 인식 확인</button>}
        {recognition && <p className="muted">검사 위치: {recognition.cwd} · {recognition.skills.includes(item.definitionId ?? item.name) ? "같은 이름 인식 · 출처는 별도 확인 필요" : "새 입력에서 이 이름을 찾지 못함"}</p>}
      </>}
      {tab === "history" && <>{relevant.length ? relevant.map(record => <p key={record.id}>{record.title}<br /><small className="muted">{new Date(record.at).toLocaleString("ko-KR")}</small></p>) : <p>이 항목의 파일 변경 기록이 없습니다.</p>}<p className="muted">복원은 변경 기록 화면에서 할 수 있습니다.</p></>}
    </div>
    <footer className="pc-footer">
      {item.definitionId && <button className="btn ghost" disabled={busy} onClick={() => work(async () => { const value = await call("workbench:definition", item.definitionId!); if (value) onEdit(value); })}>편집</button>}
      {item.managed && <button className="btn" disabled={busy} onClick={() => work(async () => onPlan(await call("workbench:preview", [item.id])))}>변경 검토</button>}
      {!item.managed && item.catalogPath && ["skill", "instruction"].includes(item.kind) && <button className="btn" disabled={busy} onClick={() => work(async () => onPlan(await call("changes:adopt", item.id)))}>내 설정에 추가</button>}
    </footer>
  </>;
}
