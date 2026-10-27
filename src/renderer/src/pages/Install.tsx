import { useEffect, useRef, useState } from "react";
import { INSTALL_EVENT_CHANNEL } from "@shared/api-types";
import { DOCTOR_CHECK_LABELS, DOCTOR_SECTION_LABELS, type DoctorCardState } from "@shared/doctor-types";
import { INSTALL_OUTCOME_LABELS, type InstallPlan, type InstallRunResult, type InstallStepResult } from "@shared/install-types";
import { Banner, StateDot, StatusTag, ToolbarSpacer } from "../components/ui";
import { ApiError, call } from "../api/client";
import RepoConnect from "../components/RepoConnect";
import { useConfirmDialog } from "../components/confirm-dialog";
import { LogTerminal, type LogLine } from "../components/LogTerminal";
import { showToast } from "../components/toast";
import RepairPanel from "../components/RepairPanel";

const MAX_LOG_LINES = 2_000;

const OUTCOME_TONE = { done: "ok", skipped: "muted", failed: "err", manual: "warn" } as const;
const STATE_TONE = { ok: "ok", drift: "warn", missing: "err", error: "err", info: "muted", skipped: "muted" } as const;

export default function Install() {
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [current, setCurrent] = useState<{ index: number; total: number; title: string } | null>(null);
  const [results, setResults] = useState<Record<string, InstallStepResult>>({});
  const [summary, setSummary] = useState<InstallRunResult | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const total = useRef(0);
  const nextLineId = useRef(0);
  const { confirm, dialog } = useConfirmDialog();

  const load = async () => {
    setError(null);
    try {
      const next = await call("install:plan");
      setPlan(next);
      setSelected((prev) => new Set(next.steps.filter((step) => step.actionable && prev.has(step.id)).map((step) => step.id)));
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  useEffect(() => {
    void load();
    return window.hm.on(INSTALL_EVENT_CHANNEL, (event) => {
      if (event.type === "run-start") total.current = event.total;
      if (event.type === "step-start") setCurrent({ index: event.index, total: total.current, title: event.title });
      if (event.type === "step-done") setResults((prev) => ({ ...prev, [event.result.id]: event.result }));
      if (event.type === "log") {
        const line = { id: nextLineId.current++, stream: event.stream, text: event.line };
        setLines((prev) => (prev.length >= MAX_LOG_LINES ? [...prev.slice(-MAX_LOG_LINES + 1), line] : [...prev, line]));
      }
    });
  }, []);

  const actionable = plan?.steps.filter((step) => step.actionable) ?? [];
  const chosen = actionable.filter((step) => selected.has(step.id));
  // 직접 해야 하는 step도 이미 맞으면(예: 손으로 설치해 둔 cua-driver) 할 일이 아니다.
  const pending = plan?.steps.filter((step) => step.actionable || (step.manual && ["missing", "drift", "error"].includes(step.state))) ?? [];
  const healthy = (plan?.steps.length ?? 0) - pending.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    if (chosen.length === 0) return;
    const ok = await confirm({
      title: `${chosen.length}개 step을 실행할까요?`,
      message: `이 PC에 설치하고 설정 파일을 고칩니다. 고치는 파일은 먼저 백업합니다.\n${chosen.map((step) => `· ${step.title}`).join("\n")}`,
      confirmLabel: "실행",
    });
    if (!ok) return;
    setRunning(true);
    setResults({});
    setSummary(null);
    try {
      const result = await call(
        "install:run",
        chosen.map((step) => step.id),
      );
      setSummary(result);
      const failed = result.results.filter((entry) => entry.outcome === "failed").length;
      showToast({
        tone: result.cancelled ? "warning" : failed > 0 ? "error" : "success",
        title: result.cancelled ? "설치를 취소했습니다" : failed > 0 ? `${failed}개 step이 실패했습니다` : "설치를 마쳤습니다",
        detail: "로그와 step별 결과를 확인하세요.",
      });
      setSelected(new Set());
    } catch (caught) {
      showToast({
        tone: caught instanceof ApiError && caught.status === 409 ? "warning" : "error",
        title: "설치를 시작하지 못했습니다",
        detail: (caught as Error).message,
      });
    } finally {
      setRunning(false);
      setCurrent(null);
      await load();
    }
  };

  return (
    <div className="install-page">
      {dialog}
      <div className="page-head">
        <h2>설치</h2>
        {plan && <StatusTag tone="muted">프로필 {plan.profile}</StatusTag>}
        <span className="page-head-meta">
          {plan ? `정상 ${healthy} · 할 일 ${pending.length}` : "불러오는 중…"}
        </span>
        <ToolbarSpacer />
        {running ? (
          <button className="btn danger" onClick={() => void call("install:cancel")}>
            취소
          </button>
        ) : (
          <>
            <button className="btn ghost" onClick={() => void load()} disabled={repairing}>
              다시 검사
            </button>
            <button className="btn" onClick={() => void run()} disabled={chosen.length === 0 || repairing}>
              실행 ({chosen.length})
            </button>
          </>
        )}
      </div>
      {error && <Banner tone="err">{error}</Banner>}
      {plan?.repoError && <RepoConnect onConnected={() => void load()} />}
      {current && (
        <div className="install-progress" role="status">
          <StatusTag tone="ok">진행 중</StatusTag>
          {current.index + 1}/{current.total} · {current.title}
        </div>
      )}
      {summary && (
        <div className="install-summary">
          {summary.verify.map((card) => (
            <span key={card.section} className="install-summary-card">
              <StateDot state={card.state as DoctorCardState} />
              {DOCTOR_SECTION_LABELS[card.section]}: {card.summary}
            </span>
          ))}
        </div>
      )}
      {summary?.notices?.map((notice) => <Banner tone="warn" key={notice}>{notice}</Banner>)}
      {summary?.logFile && <p className="muted">설치 기록: {summary.logFile}</p>}

      {plan && pending.length === 0 && <div className="empty">할 일이 없습니다. 모든 항목이 manifest와 같습니다.</div>}
      {pending.length > 0 && (
        <div className="toolbar">
          <label className="check">
            <input
              type="checkbox"
              checked={actionable.length > 0 && chosen.length === actionable.length}
              disabled={actionable.length === 0 || running}
              onChange={() => setSelected(chosen.length === actionable.length ? new Set() : new Set(actionable.map((step) => step.id)))}
            />
            실행할 수 있는 step 전체
          </label>
          <span className="muted">
            선택 {chosen.length} / {actionable.length}
          </span>
        </div>
      )}
      {pending.map((step) => {
        const result = results[step.id];
        return (
          <section className="panel" key={step.id}>
            <header className="panel-head">
              <input
                type="checkbox"
                aria-label={`${step.title} 선택`}
                checked={selected.has(step.id)}
                disabled={!step.actionable || running}
                onChange={() => toggle(step.id)}
              />
              <span className="panel-title">{step.title}</span>
              <StatusTag tone={STATE_TONE[step.state]}>{step.manual ? "직접 해야 함" : DOCTOR_CHECK_LABELS[step.state]}</StatusTag>
              {result && <StatusTag tone={OUTCOME_TONE[result.outcome]}>{INSTALL_OUTCOME_LABELS[result.outcome]}</StatusTag>}
              <span className="mono muted panel-aside">{step.id}</span>
            </header>
            <p className="doctor-card-summary install-detail">{result?.outcome === "failed" ? result.detail : step.detail}</p>
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
          </section>
        );
      })}

      <LogTerminal lines={lines} onClear={running ? undefined : () => setLines([])} />
      <RepairPanel
        targets={pending.filter((step) => results[step.id]?.outcome === "failed" || step.state === "error").map((step) => ({ id: step.id, title: step.title }))}
        disabled={running}
        onBusyChange={setRepairing}
        onResult={(result) => { setResults((prev) => ({ ...prev, [result.id]: result })); void load(); }}
      />
    </div>
  );
}
