import { useEffect, useRef, useState } from "react";
import { REPAIR_EVENT_CHANNEL } from "@shared/api-types";
import type { ProviderId } from "@shared/provider-types";
import type { RepairProvider, RepairSnapshot } from "@shared/repair-types";
import type { InstallStepResult } from "@shared/install-types";
import { call } from "../api/client";
import { Banner, Panel, StatusTag, Toolbar } from "./ui";
import { LogTerminal } from "./LogTerminal";
import { useConfirmDialog } from "./confirm-dialog";

export interface RepairTarget { id: string; title: string }
const LABELS = { codex: "Codex", claude: "Claude Code" };

/** 상태는 main에 남아 화면을 떠났다 돌아와도 승인 요청과 진행 로그를 복원한다. */
export default function RepairPanel({ targets, disabled, onBusyChange, onResult }: {
  targets: RepairTarget[];
  disabled: boolean;
  onBusyChange(running: boolean): void;
  onResult(result: InstallStepResult): void;
}) {
  const [providers, setProviders] = useState<RepairProvider[]>([]);
  const [state, setState] = useState<RepairSnapshot | null>(null);
  const [starting, setStarting] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const callbacks = useRef({ onBusyChange, onResult }); callbacks.current = { onBusyChange, onResult };
  const { confirm, dialog } = useConfirmDialog();
  useEffect(() => {
    let alive = true;
    let received = false;
    const apply = (next: RepairSnapshot) => {
      if (!alive) return;
      setState(next); callbacks.current.onBusyChange(next.running);
      if (!next.running && next.result && ["done", "skipped"].includes(next.result.outcome)) callbacks.current.onResult(next.result);
    };
    const unsubscribe = window.hm.on(REPAIR_EVENT_CHANNEL, (event) => {
      received = true;
      if (event.type === "state") apply(event.state);
      else setState((prev) => prev ? { ...prev, lines: [...prev.lines.slice(-1_999), event.line] } : prev);
    });
    void call("repair:status").then((next) => { if (!received) apply(next); }).catch((caught: Error) => alive && setError(caught.message));
    void call("repair:providers").then((next) => alive && setProviders(next)).catch((caught: Error) => alive && setError(caught.message));
    return () => { alive = false; unsubscribe(); };
  }, []);

  const start = async (target: RepairTarget, provider: ProviderId) => {
    if (!await confirm({ title: `${LABELS[provider]}에게 해결 요청`, message: `${target.title}\n\n이 PC에 설치된 AI와 기존 로그인 계정을 사용합니다. 해당 항목의 오류·설치 계획·최근 로그를 전달합니다. 명령이나 파일 변경은 여기서 검토하고 승인합니다. 해결 후 재검사하며 최대 3회 시도합니다.`, confirmLabel: "해결 요청" })) return;
    setStarting(true); setError(null); onBusyChange(true);
    try { setState(await call("repair:run", target.id, provider)); }
    catch (caught) { setError((caught as Error).message); }
    finally { setStarting(false); onBusyChange(false); }
  };
  const answer = async (id: string, allow: boolean) => {
    setAnswering(id); setError(null);
    try { await call("repair:respond", id, allow); }
    catch (caught) { setError((caught as Error).message); }
    finally { setAnswering(null); }
  };
  const running = starting || Boolean(state?.running);
  if (targets.length === 0 && !state?.stepId && !error) return null;
  return (
    <Panel head={<><span className="panel-title">AI에게 설치 문제 해결 요청</span>{running && <StatusTag tone="warn">{state?.phase === "approval" ? "승인 대기" : "진행 중"}</StatusTag>}</>}>
      {dialog}
      {error && <Banner tone="err">{error}</Banner>}
      {targets.map((target) => <Toolbar key={target.id}>
        <span>{target.title}</span>
        {(["codex", "claude"] as const).map((provider) => {
          const available = providers.find((entry) => entry.id === provider);
          return <button key={provider} className="btn ghost" title={available?.detail ?? "실행 가능 여부 확인 중"} disabled={disabled || running || !available?.available} onClick={() => void start(target, provider)}>{LABELS[provider]}에게 해결 요청</button>;
        })}
      </Toolbar>)}
      {providers.filter((provider) => !provider.available).map((provider) => <p className="muted" key={provider.id}>{provider.detail}</p>)}
      {state?.stepId && <Toolbar><span role="status">{LABELS[state.provider!]} · {state.round}/3회 · {state.detail}</span>{running && <button className="btn danger" onClick={() => void call("repair:cancel").catch((caught: Error) => setError(caught.message))}>복구 중단</button>}</Toolbar>}
      {state?.approvals.map((approval) => <Panel key={approval.id} head={<span className="panel-title">{approval.title}</span>}>
        <pre className="capture-diff">{approval.detail}</pre>
        <Toolbar><button className="btn ghost" disabled={answering !== null} onClick={() => void answer(approval.id, false)}>거절</button><button className="btn" disabled={answering !== null} onClick={() => void answer(approval.id, true)}>이번 요청 승인</button></Toolbar>
      </Panel>)}
      {state?.stepId && <LogTerminal lines={state.lines} />}
      {state?.logFile && <p className="muted">복구 기록: {state.logFile}</p>}
    </Panel>
  );
}
