import { useEffect, useRef, useState } from "react";
import type { HookDiagnostic, ProjectComparison, UpdateCandidate, WorkbenchPlan } from "@shared/workbench-types";
import { call } from "../api/client";
import { Banner, PageHeader, EmptyState } from "./ui";
import { useModalFocus } from "./useModalFocus";
export type WorkbenchTool = "github" | "updates" | "diagnostics";
export function WorkbenchTools({ tool, busy, error, warnings, work, onPlan, onClose }: {
  tool: WorkbenchTool; busy: boolean; error: string; warnings: string[];
  work(task: () => Promise<void>): void; onPlan(plan: WorkbenchPlan): void; onClose(): void;
}) {
  const [repository, setRepository] = useState("");
  const [directories, setDirectories] = useState<string[] | null>(null);
  const [updates, setUpdates] = useState<UpdateCandidate[]>([]);
  const [hooks, setHooks] = useState<HookDiagnostic[] | null>(null);
  const [comparison, setComparison] = useState<ProjectComparison | null>(null);
  const root = useRef<HTMLElement>(null);
  useModalFocus(root);
  useEffect(() => { if (tool === "updates") work(async () => setUpdates(await call("workbench:updates"))); }, [tool]);
  const title = tool === "github" ? "GitHub에서 가져오기" : tool === "updates" ? "업데이트" : "환경 진단";
  return <section ref={root} className="pc-modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => { if (e.key === "Escape" && !busy) { e.stopPropagation(); onClose(); } }}><div className="pc-dialog"><PageHeader title={title}><button className="btn ghost" disabled={busy} onClick={onClose}>닫기</button></PageHeader>{error && <Banner tone="err">{error}</Banner>}<div className="pc-scroll">
    {tool === "github" && <><p>저장소에서 스킬을 찾아 양쪽 CLI에 추가합니다.</p><label className="pc-search"><input aria-label="GitHub 저장소" placeholder="owner/repository" value={repository} onChange={e => { setRepository(e.target.value); setDirectories(null); }} /></label><button className="btn" disabled={busy || !repository} onClick={() => work(async () => setDirectories((await call("workbench:discover", repository)).directories))}>스킬 찾기</button>{directories?.length === 0 && <EmptyState>SKILL.md가 있는 폴더를 찾지 못했습니다.</EmptyState>}{directories?.map(directory => <p key={directory}>{directory || "저장소 루트"} <button className="btn ghost" disabled={busy} onClick={() => work(async () => onPlan(await call("changes:import", repository, directory)))}>변경 검토</button></p>)}</>}
    {tool === "updates" && <>{!updates.length && <EmptyState>{busy ? "업데이트 확인 중…" : "새 업데이트가 없습니다."}</EmptyState>}{updates.map(update => <div key={update.id}><h3>{update.name}</h3><p>{update.reason}</p><p>{update.current?.slice(0, 8)} → {update.available?.slice(0, 8)}</p>{update.available && <button className="btn" disabled={busy} onClick={() => work(async () => onPlan(await call("changes:update", update.id)))}>변경 검토</button>}</div>)}</>}
    {tool === "diagnostics" && <><p>읽기 전용으로 hook과 프로젝트 설정을 확인합니다.</p><div className="pc-inline"><button className="btn ghost" disabled={busy} onClick={() => work(async () => setHooks(await call("workbench:hooks")))}>hook 검사</button><button className="btn ghost" disabled={busy} onClick={() => work(async () => setComparison(await call("workbench:project")))}>프로젝트 비교</button></div>{warnings.map((warning, index) => <p key={index}>{warning}</p>)}{hooks?.map((hook, index) => <p key={index}>{hook.provider} · {hook.event} · {hook.source}<br />{hook.issues.join(" · ") || "정적 검사 이상 없음"}</p>)}{comparison && <><p>{comparison.folder}</p>{comparison.entries.map((entry, index) => <p key={index}>{entry.provider} · {entry.file}: {entry.detail}</p>)}</>}</>}
  </div></div></section>;
}
