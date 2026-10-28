import { CheckCircle2, AlertTriangle, CircleAlert, Info } from "lucide-react";
import { DoctorIcon } from "../components/DoctorIcon";
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
import { Banner, Check, StateDot, StatusTag, Tabs, ToolbarSpacer } from "../components/ui";
import { call } from "../api/client";
import RepoConnect from "../components/RepoConnect";

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
      <div className="page-head">
        <h2>상태판</h2>
        {report && !report.repoError && <StatusTag tone="muted">{report.setupProfile?.name ?? "프로필"} · {report.profile}</StatusTag>}
        <span className="page-head-meta">{report && !report.repoError ? `마지막 검사 ${new Date(report.generatedAt).toLocaleString("ko-KR")}` : busy ? "검사 중…" : ""}</span>
        <ToolbarSpacer />
        <button className="btn" onClick={() => void run()} disabled={busy}>
          {busy ? "검사 중…" : "다시 검사"}
        </button>
      </div>
      {error && <Banner tone="err">{error}</Banner>}
      {report?.repoError && <RepoConnect onConnected={() => void run()} />}

      {report && report.cards.length > 0 && (
        <Tabs<Tab>
          label="상태판 섹션"
          value={tab}
          onChange={setTab}
          items={[
            { id: "overview", label: "전체" },
            ...DOCTOR_SECTIONS.map((section) => ({
              id: section,
              label: (
                <>
                  <StateDot state={report.cards.find((entry) => entry.section === section)?.state ?? "info"} />
                  {DOCTOR_SECTION_LABELS[section]}
                </>
              ),
            })),
          ]}
        />
      )}

      {report && tab === "overview" && (
        <>
        <div className="doctor-overview" aria-label="환경 상태 요약">
          {([ ["ok", "정상", CheckCircle2], ["warn", "주의", AlertTriangle], ["fail", "누락", CircleAlert], ["info", "정보", Info] ] as const).map(([state, label, Icon]) => (
            <div className="doctor-metric" key={state}><Icon size={24} aria-hidden="true" /><span><strong>{report.cards.filter((item) => item.state === state).length}</strong><span>{label}</span></span></div>
          ))}
        </div>
        <div className="doctor-grid">
          {report.cards.map((entry) => (
            <section className={`doctor-card ${entry.state}`} key={entry.section}>
              <header className="doctor-card-head">
                <DoctorIcon section={entry.section} />
                <StateDot state={entry.state} />
                <span className="doctor-card-title">{entry.label}</span>
                <StatusTag tone={entry.state === "fail" ? "err" : entry.state === "info" ? "muted" : entry.state}>
                  {DOCTOR_CARD_LABELS[entry.state]}
                </StatusTag>
              </header>
              <p className="doctor-card-summary">{entry.summary}</p>
              <button className="btn ghost" onClick={() => setTab(entry.section)}>
                자세히
              </button>
            </section>
          ))}
        </div>
        </>
      )}

      {card && (
        <div className="doctor-section">
          <div className="doctor-section-head">
            <StateDot state={card.state} />
            <span className="doctor-card-title">{card.label}</span>
            <span className="muted">{card.summary}</span>
            <ToolbarSpacer />
            <label className="check">
              <input type="checkbox" checked={showOk} onChange={() => setShowOk(!showOk)} />
              정상 항목도 보기
            </label>
          </div>
          {rows.length === 0 ? (
            <div className="empty">{showOk ? "검사할 항목이 없습니다" : "정상이 아닌 항목이 없습니다"}</div>
          ) : (
            <table className="data-table">
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
                      <StatusTag tone={CHECK_TONE[check.state]}>{DOCTOR_CHECK_LABELS[check.state]}</StatusTag>
                    </td>
                    <td>
                      {check.title}
                      {check.local && <StatusTag tone="muted">로컬</StatusTag>}
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
