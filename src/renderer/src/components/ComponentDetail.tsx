import { useEffect, useState } from "react";
import type { ManagedComponent, ComponentObservation, ChangeRecord, WorkbenchPlan, ComponentDefinition } from "@shared/workbench-types";
import { COMPONENT_LABELS, COMPATIBILITY_LABELS } from "@shared/workbench-types";
import { call } from "../api/client";
import { Banner, StatusTag, Tabs } from "./ui";
import { SkillExample } from "./SkillExample";

export function observationLabel(observation?: ComponentObservation) {
  if (!observation) return "—";
  if (observation.stale) return "재확인 필요";
  if (observation.enabled === false) return "비활성";
  if (observation.recognition === "confirmed") return "인식됨";
  if (observation.compatibility === "unsupported") return "미지원";
  if (observation.comparison === "outside") return "대상 아님";
  if (observation.comparison === "match") return "설정 일치";
  if (observation.comparison === "different") return "설정 차이";
  if (observation.installed === false) return "설치 안 됨";
  if (observation.installed === true) return "인식 미검증";
  return "확인 못함";
}
export function ComponentDetail({ item, busy, work, onPlan, onEdit, onManagePlugin, scopeId = "global" }: {
  item: ManagedComponent; busy: boolean; work(task: () => Promise<void>): void;
  scopeId?: string;
  onManagePlugin?(provider: "claude" | "codex", pluginId: string): void;
  onPlan(plan: WorkbenchPlan): void; onEdit(value: ComponentDefinition): void;
}) {
  const [tab, setTab] = useState<"settings" | "diagnostics" | "history">("settings");
  const [records, setRecords] = useState<ChangeRecord[]>([]);
  useEffect(() => { setTab("settings"); }, [item.id]);
  const packageSkill = item.observations.some(o => o.pluginId || o.system);
  const relevant = records.filter(record => record.files.some(file => file.path.replaceAll("\\", "/").includes(`/skills/${item.definitionId ?? item.name}/`) || (item.kind === "instruction" && /(?:CLAUDE|AGENTS)\.md$/.test(file.path))));
  return <>
    <Tabs label="항목 상세" value={tab} onChange={value => { setTab(value); if (value === "history") work(async () => setRecords(await call("workbench:history"))); }} items={[{ id: "settings", label: "설정" }, { id: "diagnostics", label: "진단" }, { id: "history", label: "기록" }]} />
    <div className="pc-scroll">
      {tab === "settings" && <><StatusTag tone="muted">{item.managed ? "공유 기준에 포함" : "공유 기준에 포함되지 않음"}</StatusTag><p>{item.description || COMPONENT_LABELS[item.kind]}</p>
        <table className="pc-comparison"><thead><tr><th>대상</th><th>상태</th></tr></thead><tbody>{(["claude", "codex"] as const).map(provider => <tr key={provider}><td>{provider === "claude" ? "Claude Code" : "Codex"}</td><td>{observationLabel(item.observations.find(o => o.provider === provider))}</td></tr>)}</tbody></table>
        <dl className="pc-facts"><dt>출처</dt><dd>{item.source}</dd><dt>종류</dt><dd>{COMPONENT_LABELS[item.kind]}</dd></dl>{item.issue && <Banner tone="warn">{item.issue}</Banner>}
      </>}
      {tab === "diagnostics" && <>{item.observations.map(observation => <section key={observation.provider}><h3>{observation.provider === "claude" ? "Claude Code" : "Codex"}</h3><dl className="pc-facts"><dt>호환성</dt><dd>{COMPATIBILITY_LABELS[observation.compatibility]}</dd><dt>설치・활성</dt><dd>{observation.installed === true ? "파일/설정 발견" : "설치 미확인"} · {observation.enabled === null ? "활성 미확인" : observation.enabled ? "활성" : "비활성"}</dd><dt>새 CLI 인식</dt><dd>{observation.stale ? "재확인 필요" : observation.recognition === "confirmed" ? "확인됨" : "확인 안 됨"}</dd><dt>{item.kind === "mcp" ? "연결 검사" : "예제 실행"}</dt><dd>{observation.execution === "confirmed" ? "확인됨" : "확인 안 됨"}</dd>{observation.identityPath && <><dt>실제 경로</dt><dd>{observation.identityPath}</dd></>}{observation.pluginId && <><dt>소속 플러그인</dt><dd>{observation.pluginId}</dd></>}{observation.cwd && <><dt>검사 위치</dt><dd>{observation.cwd}</dd></>}{observation.version && <><dt>항목 버전</dt><dd>{observation.version}</dd></>}{observation.cliVersion && <><dt>CLI 버전</dt><dd>{observation.cliVersion}</dd></>}<dt>확인 시각</dt><dd>{new Date(observation.checkedAt).toLocaleString("ko-KR")}</dd></dl><p>{observation.detail}</p><p>{observation.recognitionDetail}</p></section>)}
        {item.kind === "mcp" && item.id.startsWith("mcp:") && <button className="btn ghost" disabled={busy} onClick={() => work(async () => onPlan(await call("workbench:probe", item.id)))}>MCP 연결 검사</button>}
        {packageSkill && <p className="muted">플러그인 소속 스킬은 CLI의 확장 탭에서 패키지 단위로 관리합니다. 기본 시스템 스킬은 CLI 업데이트로 관리합니다.</p>}
        {item.kind === "skill" && <SkillExample key={item.id} item={item} scopeId={scopeId} />}
      </>}
      {tab === "history" && <>{relevant.length ? relevant.map(record => <p key={record.id}>{record.title}<br /><small className="muted">{new Date(record.at).toLocaleString("ko-KR")}</small></p>) : <p>이 항목의 파일 변경 기록이 없습니다.</p>}<p className="muted">복원은 변경 기록 화면에서 할 수 있습니다.</p></>}
    </div>
    <footer className="pc-footer">
      {item.observations.filter(o => o.pluginId).map(o => <button className="btn ghost" key={o.provider} disabled={busy} onClick={() => onManagePlugin?.(o.provider, o.pluginId!)}>소속 플러그인 관리</button>)}
      {item.definitionId && !packageSkill && <button className="btn ghost" disabled={busy} onClick={() => work(async () => { const value = await call("workbench:definition", item.definitionId!); if (value) onEdit(value); })}>편집</button>}
      {item.managed && <button className="btn" disabled={busy} onClick={() => work(async () => onPlan(await call("workbench:preview", [item.id])))}>변경 검토</button>}
      {!item.managed && !packageSkill && !item.id.startsWith("recognition:") && !item.id.startsWith("project:") && item.catalogPath && ["skill", "instruction"].includes(item.kind) && <button className="btn" disabled={busy} onClick={() => work(async () => onPlan(await call("changes:adopt", item.id)))}>공유 기준에 추가</button>}
    </footer>
  </>;
}
