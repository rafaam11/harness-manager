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

/** 작업별 상태는 main에 남아 화면을 다시 열어도 진행 상황을 복원한다. */
export default function RepairPanel({ targets, disabled, onBusyChange, onResult }: {
  targets: RepairTarget[];
  disabled: boolean;
  onBusyChange(running: boolean): void;
  onResult(result: InstallStepResult): void;
}) {
  const [providers, setProviders] = useState<RepairProvider[]>([]);
  const [jobs, setJobs] = useState<RepairSnapshot[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const delivered = useRef(new Set<string>());
  const callbacks = useRef({ onBusyChange, onResult }); callbacks.current = { onBusyChange, onResult };
  const { confirm, dialog } = useConfirmDialog();
  useEffect(() => { callbacks.current.onBusyChange(starting || jobs.some((job) => job.running)); }, [jobs, starting]);
  const apply = (next: RepairSnapshot) => setJobs((previous) => [...previous.filter((job) => job.jobId !== next.jobId), next]);
  useEffect(() => {
    for (const job of jobs) {
      if (!job.running && job.result && ["done", "skipped"].includes(job.result.outcome) && !delivered.current.has(job.jobId)) {
        delivered.current.add(job.jobId); callbacks.current.onResult(job.result);
      }
    }
  }, [jobs]);
  useEffect(() => {
    let alive = true;
    let received = false;
    let reset = false;
    const unsubscribe = window.hm.on(REPAIR_EVENT_CHANNEL, (event) => {
      if (!alive) return;
      received = true;
      if (event.type === "reset") { reset = true; setJobs([]); delivered.current.clear(); }
      else if (event.type === "state") apply(event.state);
      else setJobs((previous) => previous.map((job) => job.jobId === event.jobId ? { ...job, lines: [...job.lines.slice(-1_999), event.line] } : job));
    });
    void call("repair:status").then((next) => {
      if (!alive || reset) return;
      setJobs((current) => received ? [...next.jobs.filter((job) => !current.some((entry) => entry.jobId === job.jobId)), ...current] : next.jobs);
    }).catch((caught: Error) => alive && setError(caught.message));
    void call("repair:providers").then((next) => alive && setProviders(next)).catch((caught: Error) => alive && setError(caught.message));
    return () => { alive = false; unsubscribe(); };
  }, []);

  const start = async (selected: RepairTarget[], provider: ProviderId) => {
    if (!await confirm({ title: `${LABELS[provider]}에게 해결 요청`, message: `${selected.map((target) => target.title).join("\n")}\n\n기존 로그인 계정으로 오류·설치 계획·최근 로그를 AI에 전달합니다. YOLO 모드로 명령과 파일 변경을 자동 실행합니다. 최대 3개를 병렬 처리하며 같은 설정을 수정하는 작업은 기다립니다. 항목별 최대 3회 복구·재검사를 수행합니다.\n\n공통 앱 버그는 별도 사본에서 수정하고 테스트 후 HM 원격 저장소의 dev에 커밋·푸시합니다. 푸시 권한이 없거나 충돌하면 사본과 로그를 남깁니다. 개인 프로필은 공개 HM 소스 반영 대상에서 제외합니다.`, confirmLabel: "YOLO로 해결 요청" })) return;
    setStarting(true); setError(null);
    try {
      for (const target of selected) {
        // 초기 응답보다 이벤트가 먼저 도착해도 더 진행된 상태를 덮어쓰지 않는다.
        const next = await call("repair:run", target.id, provider);
        setJobs((previous) => previous.some((job) => job.jobId === next.jobId) ? previous : [...previous, next]);
      }
    } catch (caught) { setError((caught as Error).message); }
    finally { setStarting(false); }
  };
  const busyIds = new Set(jobs.filter((job) => job.running).map((job) => job.stepId));
  const availableTargets = targets.filter((target) => !busyIds.has(target.id));
  const running = jobs.filter((job) => job.running).length;
  if (targets.length === 0 && jobs.length === 0 && !error) return null;
  return (
    <Panel head={<><span className="panel-title">AI에게 설치 문제 해결 요청</span><StatusTag tone={running ? "warn" : "muted"}>YOLO · {running}개 진행 중</StatusTag></>}>
      {dialog}
      {error && <Banner tone="err">{error}</Banner>}
      {availableTargets.length > 1 && <Toolbar>
        {(["codex", "claude"] as const).map((provider) => <button key={provider} className="btn ghost" disabled={disabled || starting || !providers.find((entry) => entry.id === provider)?.available} onClick={() => void start(availableTargets, provider)}>모두 {LABELS[provider]}에게 요청</button>)}
      </Toolbar>}
      {targets.map((target) => <Toolbar key={target.id}>
        <span>{target.title}</span>
        {(["codex", "claude"] as const).map((provider) => {
          const available = providers.find((entry) => entry.id === provider);
          return <button key={provider} className="btn ghost" title={available?.detail ?? "실행 가능 여부 확인 중"} disabled={disabled || starting || busyIds.has(target.id) || !available?.available} onClick={() => void start([target], provider)}>{LABELS[provider]}에게 해결 요청</button>;
        })}
      </Toolbar>)}
      {providers.filter((provider) => !provider.available).map((provider) => <p className="muted" key={provider.id}>{provider.detail}</p>)}
      {jobs.map((job) => <Panel key={job.jobId} head={<span className="panel-title">{targets.find((target) => target.id === job.stepId)?.title ?? job.stepId} · {LABELS[job.provider!]}</span>}>
        <Toolbar><span role="status">{job.round}/3회 · {job.detail}</span>{job.running && <button className="btn danger" onClick={() => void call("repair:cancel", job.jobId).catch((caught: Error) => setError(caught.message))}>이 복구 중단</button>}</Toolbar>
        {job.source && <Banner tone={job.source.state === "failed" ? "warn" : "ok"}>소스 반영: {job.source.detail}{job.source.commit && ` · ${job.source.commit.slice(0, 8)}`}<br />작업 사본: {job.source.workspace}</Banner>}
        <LogTerminal lines={job.lines} />
        {job.logFile && <p className="muted">복구 기록: {job.logFile}</p>}
      </Panel>)}
    </Panel>
  );
}
