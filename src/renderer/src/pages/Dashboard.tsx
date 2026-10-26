import { useEffect, useState } from "react";
import {
  DOCTOR_CARD_LABELS,
  DOCTOR_CHECK_LABELS,
  DOCTOR_SECTIONS,
  DOCTOR_SECTION_LABELS,
  type DoctorCard,
  type DoctorCheckState,
  type DoctorReport,
  type DoctorSection,
} from "@shared/doctor-types";
import { call } from "../api/client";

type Tab = "overview" | DoctorSection;

/** 검사 상태 → 기존 tag 색. 상태색만 쓰고 분류색과 섞지 않는다(UI 규약). */
const CHECK_TONE: Record<DoctorCheckState, "ok" | "warn" | "err" | "muted"> = {
  ok: "ok",
  drift: "warn",
  missing: "err",
  error: "err",
  info: "muted",
  skipped: "muted",
};

function StateDot({ state }: { state: DoctorCard["state"] }) {
  // 점은 보조 표시다. 같은 줄에 글자 라벨이 반드시 함께 나온다.
  return <span className={`doctor-dot ${state}`} aria-hidden="true" />;
}

export default function Dashboard() {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [showOk, setShowOk] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await call("doctor:run"));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void run();
  }, []);

  const card = tab === "overview" ? null : report?.cards.find((entry) => entry.section === tab) ?? null;
  const rows = card ? card.checks.filter((check) => showOk || (check.state !== "ok" && check.state !== "skipped")) : [];

  return (
    <div className="dashboard-page">
      <div className="dashboard-head">
        <h2>상태판</h2>
        {report && <span className="tag muted">프로필 {report.profile}</span>}
        <span className="muted dashboard-time">{report ? `마지막 검사 ${new Date(report.generatedAt).toLocaleString("ko-KR")}` : busy ? "검사 중…" : ""}</span>
        <span className="cleanup-toolbar-spacer" />
        <button className="btn" onClick={() => void run()} disabled={busy}>
          {busy ? "검사 중…" : "다시 검사"}
        </button>
      </div>
      {error && <div className="banner err">{error}</div>}
      {report?.repoError && <div className="banner warn">{report.repoError}</div>}

      {report && report.cards.length > 0 && (
        <div className="ws-detail-mode dashboard-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "overview"} className={`ws-mode-tab${tab === "overview" ? " active" : ""}`} onClick={() => setTab("overview")}>
            전체
          </button>
          {DOCTOR_SECTIONS.map((section) => {
            const state = report.cards.find((entry) => entry.section === section)?.state ?? "info";
            return (
              <button
                key={section}
                role="tab"
                aria-selected={tab === section}
                className={`ws-mode-tab${tab === section ? " active" : ""}`}
                onClick={() => setTab(section)}
              >
                <StateDot state={state} />
                {DOCTOR_SECTION_LABELS[section]}
              </button>
            );
          })}
        </div>
      )}

      {report && tab === "overview" && (
        <div className="doctor-grid">
          {report.cards.map((entry) => (
            <section className={`doctor-card ${entry.state}`} key={entry.section}>
              <header className="doctor-card-head">
                <StateDot state={entry.state} />
                <span className="doctor-card-title">{entry.label}</span>
                <span className={`tag ${entry.state === "fail" ? "err" : entry.state === "info" ? "muted" : entry.state}`}>
                  {DOCTOR_CARD_LABELS[entry.state]}
                </span>
              </header>
              <p className="doctor-card-summary">{entry.summary}</p>
              <button className="btn ghost" onClick={() => setTab(entry.section)}>
                자세히
              </button>
            </section>
          ))}
        </div>
      )}

      {card && (
        <div className="doctor-section">
          <div className="doctor-section-head">
            <StateDot state={card.state} />
            <span className="doctor-card-title">{card.label}</span>
            <span className="muted">{card.summary}</span>
            <span className="cleanup-toolbar-spacer" />
            <label className="cleanup-selall">
              <input type="checkbox" checked={showOk} onChange={() => setShowOk(!showOk)} />
              정상 항목도 보기
            </label>
          </div>
          {rows.length === 0 ? (
            <div className="muted doctor-empty">{showOk ? "검사할 항목이 없습니다" : "정상이 아닌 항목이 없습니다"}</div>
          ) : (
            <table className="doctor-table">
              <thead>
                <tr>
                  <th>상태</th>
                  <th>이름</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((check) => (
                  <tr key={check.id}>
                    <td>
                      <span className={`tag ${CHECK_TONE[check.state]}`}>{DOCTOR_CHECK_LABELS[check.state]}</span>
                    </td>
                    <td>
                      {check.title}
                      {check.local && <span className="tag muted doctor-local">로컬</span>}
                    </td>
                    <td className="mono doctor-detail">{check.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
