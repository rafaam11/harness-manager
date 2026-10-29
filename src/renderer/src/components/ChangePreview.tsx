import { useRef, useState } from "react";
import type { WorkbenchPlan } from "@shared/workbench-types";
import { PageHeader, StatusTag } from "./ui";
import { useModalFocus } from "./useModalFocus";
import { call } from "../api/client";

export function ChangePreview({ plan, busy, onApply, onClose, applyLabel = "이 PC에 적용" }: {
  plan: WorkbenchPlan; busy: boolean; onApply(): void; onClose(): void; applyLabel?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const [details, setDetails] = useState(false);
  useModalFocus(root);
  const close = () => { void call("changes:discard", plan.token).catch(() => undefined); onClose(); };
  return <section ref={root} className="pc-modal" role="dialog" aria-modal="true" aria-label="변경 검토" onKeyDown={event => {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); close(); }
  }}>
    <div className="pc-dialog">
      <PageHeader title="변경 검토"><button className="btn ghost" disabled={busy} onClick={close}>닫기</button></PageHeader>
      <div className="pc-review-summary"><h2>{plan.title}</h2>
        <div className="pc-inline">{plan.targets?.map(target => <StatusTag key={target} tone="muted">{target === "claude" ? "Claude Code" : "Codex"}</StatusTag>)}<span>{plan.files.length}개 파일 · {plan.commands.length}개 작업</span></div>
        {plan.scope === "settings-and-pc" && <p>{plan.title.endsWith("복원") ? "내 설정과 PC 파일을 이전 상태로 되돌립니다." : "내 설정에 저장하고 이 PC에 함께 반영합니다."}</p>}
        {plan.notes.map((note, index) => <p className="muted" key={index}>{note}</p>)}
      </div>
      <button className="btn ghost pc-disclosure" aria-expanded={details} onClick={() => setDetails(!details)}>자세히 {details ? "접기" : "보기 · 파일 차이와 실행 명령"}</button>
      <div className="pc-scroll">{details && <>{plan.files.map(file => <details key={file.path}><summary>{file.path}</summary><pre className="wb-diff">{file.diff}</pre></details>)}{plan.commands.map((command, index) => <pre className="wb-diff" key={index}>{command}</pre>)}</>}</div>
      <footer className="pc-footer"><span className="muted">결과는 변경 기록에서 확인할 수 있습니다.</span><button className="btn primary" disabled={busy} onClick={onApply}>{busy ? "적용 중…" : applyLabel}</button></footer>
    </div>
  </section>;
}
