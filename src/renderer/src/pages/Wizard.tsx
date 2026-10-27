import { useEffect, useRef, useState } from "react";
import { INSTALL_EVENT_CHANNEL } from "@shared/api-types";
import { DOCTOR_CARD_LABELS, DOCTOR_SECTION_LABELS, type DoctorReport, type DoctorSection } from "@shared/doctor-types";
import { INSTALL_OUTCOME_LABELS, type InstallPlan, type InstallRunResult, type InstallStepResult } from "@shared/install-types";
import type { AppSettings, Profile } from "@shared/manifest-types";
import { Banner, StateDot, StatusTag, ToolbarSpacer } from "../components/ui";
import { call } from "../api/client";
import { LogTerminal, type LogLine } from "../components/LogTerminal";
import { showToast } from "../components/toast";

const STEPS = ["환영", "진단", "프로필", "항목", "미리보기", "실행", "인증", "완료"] as const;

const PROFILE_TEXT: Record<Profile, string> = {
  core: "Claude Code·Codex와 git·gh·node·ripgrep만. 다른 사람 PC나 가벼운 작업용",
  dev: "core + uv·python·scoop 도구·cua-driver. 평소 개발 PC",
  full: "dev + rustup·task 등 전부. 주 개발 PC",
};

/** 로그인은 대화형이라 위저드가 대신하지 않는다. 사용자가 직접 실행할 명령만 안내한다(비밀값은 레포에 두지 않는다). */
const AUTH_STEPS = [
  { title: "GitHub CLI", command: "gh auth login", why: "마켓플레이스·릴리스를 GitHub에서 받을 때 필요" },
  { title: "Claude Code", command: "claude", why: "처음 실행하면 브라우저 로그인 창이 뜬다" },
  { title: "Codex CLI", command: "codex login", why: "ChatGPT 계정 또는 API 키로 로그인" },
  { title: "claude.ai 커넥터", command: "claude.ai → 설정 → 커넥터", why: "Gmail·Notion 같은 원격 MCP는 웹에서 연결한다" },
];

function Cards({ report }: { report: DoctorReport }) {
  return (
    <div className="doctor-grid">
      {report.cards.map((card) => (
        <section className={`doctor-card ${card.state}`} key={card.section}>
          <header className="doctor-card-head">
            <StateDot state={card.state} />
            <span className="doctor-card-title">{card.label}</span>
            <StatusTag tone={card.state === "fail" ? "err" : card.state === "info" ? "muted" : card.state}>
              {DOCTOR_CARD_LABELS[card.state]}
            </StatusTag>
          </header>
          <p className="doctor-card-summary">{card.summary}</p>
        </section>
      ))}
    </div>
  );
}

export default function Wizard({ onFinish }: { onFinish(): void }) {
  const [step, setStep] = useState(0);
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, InstallStepResult>>({});
  const [runResult, setRunResult] = useState<InstallRunResult | null>(null);
  const [finalReport, setFinalReport] = useState<DoctorReport | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextLineId = useRef(0);

  useEffect(() => {
    void call("settings:get").then(setSettings).catch((caught: Error) => setError(caught.message));
    void call("doctor:run").then(setReport).catch((caught: Error) => setError(caught.message));
    return window.hm.on(INSTALL_EVENT_CHANNEL, (event) => {
      if (event.type === "step-done") setResults((prev) => ({ ...prev, [event.result.id]: event.result }));
      if (event.type === "log") {
        const line = { id: nextLineId.current++, stream: event.stream, text: event.line };
        setLines((prev) => [...prev.slice(-1_999), line]);
      }
    });
  }, []);

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseRepo = () =>
    guard(async () => {
      if (await call("capture:choose-repo")) setReport(await call("doctor:run"));
    });

  const saveSettings = (patch: Partial<AppSettings>) => guard(async () => setSettings(await call("settings:set", patch)));

  // 프로필 단계를 지나면 그 프로필로 다시 계획하고, 할 수 있는 step을 전부 골라 둔다.
  const loadPlan = () =>
    guard(async () => {
      const next = await call("install:plan");
      setPlan(next);
      setChosen(new Set(next.steps.filter((entry) => entry.actionable).map((entry) => entry.id)));
    });

  const run = () =>
    guard(async () => {
      setResults({});
      setRunResult(null);
      if (dryRun || chosen.size === 0) {
        setRunResult({ results: [], verify: [], cancelled: false });
        return;
      }
      setRunning(true);
      try {
        const result = await call("install:run", [...chosen]);
        setRunResult(result);
        const failed = result.results.filter((entry) => entry.outcome === "failed").length;
        if (failed > 0) showToast({ tone: "error", title: `${failed}개 step이 실패했습니다`, detail: "로그를 확인하고 다시 실행하세요." });
      } finally {
        setRunning(false);
      }
    });

  const go = async (target: number) => {
    if (target === 3 && step < 3) await loadPlan();
    if (target === 7) await guard(async () => setFinalReport(await call("doctor:run")));
    setStep(target);
  };

  const actionable = plan?.steps.filter((entry) => entry.actionable) ?? [];
  const manual = plan?.steps.filter((entry) => entry.manual && ["missing", "drift", "error"].includes(entry.state)) ?? [];
  const selectedSteps = actionable.filter((entry) => chosen.has(entry.id));
  const sections = [...new Set(actionable.map((entry) => entry.section))] as DoctorSection[];
  const canNext =
    !busy &&
    !running &&
    (step !== 0 || Boolean(report?.repoRoot)) &&
    (step !== 5 || runResult !== null);

  return (
    <div className="wizard-page">
      <h2>셋업 위저드</h2>
      <ol className="wizard-steps" aria-label="단계">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? "current" : index < step ? "done" : undefined} aria-current={index === step ? "step" : undefined}>
            <span className="wizard-step-index">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && <Banner tone="err">{error}</Banner>}

      <div className="wizard-body">
        {step === 0 && (
          <>
            <p>이 PC의 Claude Code·Codex 개발환경을 레포 manifest와 같게 맞춥니다. 각 단계에서 무엇을 할지 먼저 보여 주고, 실행 전에 한 번 더 확인합니다.</p>
            <ul className="capture-notes">
              <li>사용자 설정 파일은 통째로 바꾸지 않고 관리하는 키·블록만 고칩니다. 고치는 파일은 먼저 백업합니다.</li>
              <li>비밀값(토큰·로그인)은 다루지 않습니다. 로그인은 7단계에서 안내합니다.</li>
            </ul>
            {report?.repoRoot ? (
              <div className="capture-repo">
                <span className="muted">레포</span>
                <span className="mono">{report.repoRoot}</span>
              </div>
            ) : (
              <Banner tone="warn">
                {report?.repoError ?? "레포 위치를 확인하는 중…"}{" "}
                <button className="btn ghost" onClick={() => void chooseRepo()} disabled={busy}>
                  레포 폴더 선택
                </button>
              </Banner>
            )}
          </>
        )}

        {step === 1 && (report ? <Cards report={report} /> : <p className="muted">검사 중…</p>)}

        {step === 2 && settings && (
          <>
            <fieldset className="wizard-choice">
              <legend>프로필</legend>
              {(["core", "dev", "full"] as const).map((profile) => (
                <label key={profile}>
                  <input type="radio" name="profile" checked={settings.profile === profile} onChange={() => void saveSettings({ profile })} />
                  <span className="wizard-choice-title">{profile}</span>
                  <span className="muted">{PROFILE_TEXT[profile]}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="wizard-choice">
              <legend>jinmin 마켓플레이스 소스</legend>
              <label>
                <input
                  type="radio"
                  name="self-source"
                  checked={settings.selfMarketplaceSource === "directory"}
                  onChange={() => void saveSettings({ selfMarketplaceSource: "directory" })}
                />
                <span className="wizard-choice-title">레포 폴더</span>
                <span className="muted">mod를 고치고 /reload-plugins로 바로 반영하는 개발 PC</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="self-source"
                  checked={settings.selfMarketplaceSource === "github"}
                  onChange={() => void saveSettings({ selfMarketplaceSource: "github" })}
                />
                <span className="wizard-choice-title">GitHub</span>
                <span className="muted">레포를 고치지 않는 PC. 업데이트는 claude plugin update로 받는다</span>
              </label>
            </fieldset>
          </>
        )}

        {step === 3 && plan && (
          <>
            {actionable.length === 0 ? (
              <p>할 일이 없습니다. 이 프로필의 모든 항목이 이미 manifest와 같습니다.</p>
            ) : (
              sections.map((section) => (
                <fieldset className="wizard-choice" key={section}>
                  <legend>{DOCTOR_SECTION_LABELS[section]}</legend>
                  {actionable
                    .filter((entry) => entry.section === section)
                    .map((entry) => (
                      <label key={entry.id}>
                        <input
                          type="checkbox"
                          checked={chosen.has(entry.id)}
                          onChange={() =>
                            setChosen((prev) => {
                              const next = new Set(prev);
                              if (next.has(entry.id)) next.delete(entry.id);
                              else next.add(entry.id);
                              return next;
                            })
                          }
                        />
                        <span className="wizard-choice-title">{entry.title}</span>
                        <span className="muted">{entry.detail}</span>
                      </label>
                    ))}
                </fieldset>
              ))
            )}
            {manual.length > 0 && (
              <Banner tone="warn">
                직접 해야 하는 항목: {manual.map((entry) => `${entry.title} — ${entry.actions[0]?.summary ?? ""}`).join(" · ")}
              </Banner>
            )}
          </>
        )}

        {step === 4 && (
          <>
            {selectedSteps.length === 0 ? (
              <p>고른 항목이 없습니다.</p>
            ) : (
              selectedSteps.map((entry) => (
                <section className="panel" key={entry.id}>
                  <header className="panel-head">
                    <span className="panel-title">{entry.title}</span>
                    <span className="mono muted panel-aside">{entry.id}</span>
                  </header>
                  {entry.actions.map((action, index) =>
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
              ))
            )}
            <label className="check wizard-dry-run">
              <input type="checkbox" checked={dryRun} onChange={() => setDryRun(!dryRun)} />
              실제로 실행하지 않고 끝까지 보기(dry-run)
            </label>
          </>
        )}

        {step === 5 && (
          <>
            {runResult === null ? (
              <button className="btn" onClick={() => void run()} disabled={busy || running}>
                {dryRun || selectedSteps.length === 0 ? "dry-run으로 넘어가기" : `${selectedSteps.length}개 step 실행`}
              </button>
            ) : runResult.results.length === 0 ? (
              <p>{dryRun ? "dry-run: 아무것도 실행하지 않았습니다." : "실행할 step이 없었습니다."}</p>
            ) : (
              <ul className="wizard-results">
                {runResult.results.map((entry) => (
                  <li key={entry.id}>
                    <StatusTag tone={entry.outcome === "done" ? "ok" : entry.outcome === "failed" ? "err" : "muted"}>
                      {INSTALL_OUTCOME_LABELS[entry.outcome]}
                    </StatusTag>
                    <span className="mono">{entry.id}</span>
                    <span className="muted">{entry.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {running && (
              <div className="install-progress" role="status">
                <StatusTag tone="ok">진행 중</StatusTag>
                {Object.keys(results).length}/{selectedSteps.length}
                <button className="btn danger" onClick={() => void call("install:cancel")}>
                  취소
                </button>
              </div>
            )}
            <LogTerminal lines={lines} />
          </>
        )}

        {step === 6 && (
          <ul className="wizard-results">
            {AUTH_STEPS.map((entry) => (
              <li key={entry.title}>
                <span className="wizard-choice-title">{entry.title}</span>
                <span className="mono">{entry.command}</span>
                <span className="muted">{entry.why}</span>
              </li>
            ))}
          </ul>
        )}

        {step === 7 && (finalReport ? <Cards report={finalReport} /> : <p className="muted">다시 검사하는 중…</p>)}
      </div>

      <div className="wizard-nav">
        <button className="btn ghost" onClick={() => setStep(step - 1)} disabled={step === 0 || busy || running || step === 6}>
          이전
        </button>
        <ToolbarSpacer />
        {step < STEPS.length - 1 ? (
          <button className="btn" onClick={() => void go(step + 1)} disabled={!canNext}>
            다음
          </button>
        ) : (
          <button className="btn" onClick={onFinish}>
            상태판으로
          </button>
        )}
      </div>
    </div>
  );
}
