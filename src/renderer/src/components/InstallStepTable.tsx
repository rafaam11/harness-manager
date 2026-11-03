import { Fragment, useState } from "react";
import { DOCTOR_CHECK_LABELS, DOCTOR_SECTION_LABELS } from "@shared/doctor-types";
import { INSTALL_OUTCOME_LABELS, type InstallStep, type InstallStepResult } from "@shared/install-types";
import { ExpandButton, StatusTag } from "./ui";

const OUTCOME_TONE = { done: "ok", skipped: "muted", failed: "err", manual: "warn" } as const;
const STATE_TONE = { ok: "ok", drift: "warn", missing: "err", error: "err", info: "muted", skipped: "muted" } as const;

export interface InstallStepSelection {
  selected: ReadonlySet<string>;
  onChange(next: Set<string>): void;
  disabled?: boolean;
}

function firstAction(step: InstallStep): string {
  const [first, ...rest] = step.actions;
  if (!first) return step.detail;
  return rest.length > 0 ? `${first.summary} 외 ${rest.length}개` : first.summary;
}

/**
 * 설치와 위저드가 같이 쓰는 step 표. 명령과 파일 diff는 행마다 길이가 달라 펼침 행으로 내렸다.
 * 렌더러는 고른 step id만 부모에게 넘기고, 실행할 내용은 main이 manifest에서 정한다.
 */
export default function InstallStepTable({
  steps,
  selection,
  results = {},
  summary = "detail",
}: {
  steps: readonly InstallStep[];
  /** 없으면 선택 열을 그리지 않는다(위저드 미리보기). */
  selection?: InstallStepSelection;
  results?: Readonly<Record<string, InstallStepResult>>;
  /** 내용 열에 상태의 근거를 보일지, 실행할 일을 보일지 정한다. */
  summary?: "detail" | "action";
}) {
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const actionable = steps.filter((step) => step.actionable);
  const allChosen = actionable.length > 0 && actionable.every((step) => selection?.selected.has(step.id));
  const showResults = steps.some((step) => results[step.id]);
  const columnCount = 5 + (selection ? 1 : 0) + (showResults ? 1 : 0);

  const toggleRow = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };
  const flip = (id: string) =>
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <table className="data-table install-table">
      <thead>
        <tr>
          {selection && (
            <th scope="col" className="profiles-check-head">
              <input
                type="checkbox"
                aria-label="실행할 수 있는 step 전체"
                checked={allChosen}
                disabled={actionable.length === 0 || selection.disabled}
                onChange={() => selection.onChange(allChosen ? new Set() : new Set(actionable.map((step) => step.id)))}
              />
            </th>
          )}
          <th scope="col">구분</th>
          <th scope="col">항목</th>
          <th scope="col">상태</th>
          {showResults && <th scope="col">결과</th>}
          <th scope="col">내용</th>
          <th scope="col" aria-label="상세" />
        </tr>
      </thead>
      <tbody>
        {steps.map((step) => {
          const result = results[step.id];
          // 직접 해야 하는 step은 펼친 안내가 곧 할 일이므로 처음부터 보여 준다.
          const expanded = flipped.has(step.id) !== step.manual;
          return (
            <Fragment key={step.id}>
              <tr>
                {selection && (
                  <td className="profiles-check-cell">
                    <input
                      type="checkbox"
                      aria-label={`${step.title} 선택`}
                      checked={selection.selected.has(step.id)}
                      disabled={!step.actionable || selection.disabled}
                      onChange={() => toggleRow(step.id)}
                    />
                  </td>
                )}
                <td className="install-table-nowrap">{DOCTOR_SECTION_LABELS[step.section]}</td>
                <td>{step.title}</td>
                <td className="install-table-nowrap">
                  <StatusTag tone={STATE_TONE[step.state]}>{step.manual ? "직접 해야 함" : DOCTOR_CHECK_LABELS[step.state]}</StatusTag>
                </td>
                {showResults && (
                  <td className="install-table-nowrap">
                    {result && <StatusTag tone={OUTCOME_TONE[result.outcome]}>{INSTALL_OUTCOME_LABELS[result.outcome]}</StatusTag>}
                  </td>
                )}
                <td className={summary === "action" ? "mono muted" : "muted"}>
                  {result?.outcome === "failed" ? result.detail : summary === "action" ? firstAction(step) : step.detail}
                </td>
                <td className="profiles-check-cell">
                  <ExpandButton label={step.title} expanded={expanded} onToggle={() => flip(step.id)} />
                </td>
              </tr>
              {expanded && (
                <tr className="profiles-row-detail">
                  <td colSpan={columnCount}>
                    <span className="mono muted">{step.id}</span>
                    {step.actions.map((action, index) =>
                      action.diff ? (
                        <details className="capture-file" key={index}>
                          <summary>
                            <StatusTag tone="muted">파일</StatusTag>
                            <span className="mono">{action.summary}</span>
                          </summary>
                          <pre className="capture-diff">{action.diff}</pre>
                        </details>
                      ) : (
                        <div className="install-action mono" key={index}>
                          {action.kind === "command" ? "$ " : "· "}
                          {action.summary}
                        </div>
                      ),
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
