import { Fragment, useEffect, useState } from "react";
import type { CaptureItem, CapturePlan, CaptureTargetId, ManifestFileReport } from "@shared/manifest-types";
import { Banner, ExpandButton, StatusTag, Toolbar, ToolbarSpacer } from "../components/ui";
import { ApiError, call } from "../api/client";
import SetupProfilePicker from "../components/SetupProfilePicker";
import PrivateTerms from "../components/PrivateTerms";
import { useConfirmDialog } from "../components/confirm-dialog";
import { showToast } from "../components/toast";

/** 상태는 색과 글자 라벨을 함께 쓴다(UI 규약: 색만으로 의미를 전하지 않는다). */
function itemState(item: CaptureItem): { tone: "ok" | "warn" | "err" | "muted"; label: string } {
  if (item.error) return { tone: "err", label: "오류" };
  if (item.changes.some((change) => change.exposure.length > 0)) return { tone: "warn", label: "노출 경고" };
  if (item.changes.some((change) => change.changed)) return { tone: "ok", label: "변경 있음" };
  return { tone: "muted", label: "변경 없음" };
}

const EXPOSURE_LABELS = {
  credential: "인증 정보",
  "home-path": "홈 경로",
  "absolute-path": "절대경로",
  email: "이메일",
  "private-term": "비공개 낱말",
} as const;

function DiffView({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <pre className="capture-diff">
      {lines.map((line, index) => {
        const kind = line.startsWith("@@")
          ? "hunk"
          : line.startsWith("+++") || line.startsWith("---")
            ? "meta"
            : line.startsWith("+")
              ? "add"
              : line.startsWith("-")
                ? "del"
                : "ctx";
        return (
          <span key={index} className={`capture-diff-line ${kind}`}>
            {line || " "}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}

export default function Capture() {
  const [profileVersion, setProfileVersion] = useState(0);
  const [plan, setPlan] = useState<CapturePlan | null>(null);
  const [reports, setReports] = useState<ManifestFileReport[] | null>(null);
  const [selected, setSelected] = useState<Set<CaptureTargetId>>(new Set());
  const [flipped, setFlipped] = useState<ReadonlySet<CaptureTargetId>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await call("capture:plan");
      setPlan(next);
      // 새 계획에서 여전히 적용할 수 있는 항목만 선택을 유지한다.
      setSelected((prev) => new Set(next.items.filter((item) => item.applicable && prev.has(item.id)).map((item) => item.id)));
      // 펼침 상태는 "기본값과 다른 행"이라, 새 계획에서 경고가 생긴 행이 접히지 않도록 함께 비운다.
      setFlipped(new Set());
      setReports(next.repoRoot ? await call("manifest:validate") : null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const applicable = plan?.items.filter((item) => item.applicable) ?? [];
  const chosen = applicable.filter((item) => selected.has(item.id));

  const toggle = (id: CaptureTargetId) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const flip = (id: CaptureTargetId) =>
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (chosen.length === 0) return;
    const files = chosen.flatMap((item) => item.changes.filter((change) => change.changed).map((change) => change.displayPath));
    const ok = await confirm({
      title: `${chosen.length}개 항목을 적용할까요?`,
      message: `다음 파일을 씁니다. 원래 파일은 백업됩니다.\n${files.join("\n")}`,
      confirmLabel: "적용",
    });
    if (!ok) return;
    setBusy(true);
    try {
      // 내용은 보내지 않는다. main이 다시 계획해 미리보기 지문과 같을 때만 쓴다.
      const result = await call(
        "capture:apply",
        chosen.map((item) => item.id),
        Object.fromEntries(chosen.map((item) => [item.id, item.fingerprint])),
      );
      showToast({ tone: "success", title: `${result.written.length}개 파일을 썼습니다`, detail: result.written.join(", ") });
      setSelected(new Set());
    } catch (caught) {
      const stale = caught instanceof ApiError && caught.status === 409;
      showToast({
        tone: stale ? "warning" : "error",
        title: stale ? "미리보기 뒤에 바뀐 것이 있어 쓰지 않았습니다" : "적용하지 못했습니다",
        detail: (caught as Error).message,
      });
    } finally {
      setBusy(false);
      await load();
    }
  };

  const failedReports = reports?.filter((report) => !report.ok) ?? [];

  return (
    <div className="capture-page">
      {dialog}
      <h2>가져오기</h2>
      <p className="muted capture-intro">이 PC의 설정을 선택한 개인 프로필로 가져옵니다. 실제 PC에 적용하는 작업은 설치 화면에서 실행합니다.</p>
      {/* 공통 기본 프로필이면 계획이 409로 실패하므로, 선택만은 계획 결과와 상관없이 항상 보여 준다. */}
      <Toolbar>
        <SetupProfilePicker parts="select" disabled={busy} onChanged={() => { setProfileVersion((v) => v + 1); void load(); }} />
        <ToolbarSpacer />
        {plan?.repoRoot && (
          <>
            <span className="muted">
              선택 {chosen.length} / {applicable.length}
            </span>
            <button className="btn ghost" onClick={() => void load()} disabled={busy}>
              다시 불러오기
            </button>
            <button className="btn" onClick={() => void apply()} disabled={busy || chosen.length === 0}>
              적용 ({chosen.length})
            </button>
          </>
        )}
      </Toolbar>
      <details className="capture-terms">
        <summary>비공개 낱말 관리</summary>
        <PrivateTerms refreshKey={profileVersion} onSaved={() => void load()} />
      </details>
      {error && <Banner tone="err">{error}</Banner>}
      {plan && <p className="capture-repo">저장할 프로필: {plan.repoRoot}</p>}
      {plan?.warnings.map((warning) => (
        <Banner tone="warn" key={warning}>
          {warning}
        </Banner>
      ))}

      {reports && (
        <div className="capture-validate">
          <StatusTag tone={failedReports.length === 0 ? "ok" : "warn"}>
            {failedReports.length === 0 ? "정상" : "오류 있음"}
          </StatusTag>
          <span>
            manifest 검사 {reports.length - failedReports.length}/{reports.length} 통과
          </span>
          {failedReports.map((report) => (
            <div className="capture-validate-errors" key={report.name}>
              <span className="mono">{report.path}</span>
              {report.errors.map((message) => (
                <div className="muted" key={message}>
                  {message}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {plan && plan.items.length > 0 && (
        <table className="data-table capture-table">
          <thead>
            <tr>
              <th scope="col" className="profiles-check-head">
                <input
                  type="checkbox"
                  aria-label="적용 가능한 항목 전체"
                  checked={applicable.length > 0 && chosen.length === applicable.length}
                  disabled={applicable.length === 0 || busy}
                  onChange={() =>
                    setSelected(chosen.length === applicable.length ? new Set() : new Set(applicable.map((item) => item.id)))
                  }
                />
              </th>
              <th scope="col">항목</th>
              <th scope="col">상태</th>
              <th scope="col">소스</th>
              <th scope="col">파일</th>
              <th scope="col" aria-label="상세" />
            </tr>
          </thead>
          <tbody>
            {plan.items.map((item) => {
              const state = itemState(item);
              const files = item.changes.filter((change) => change.changed || change.exposure.length > 0);
              const hasDetail = Boolean(item.error) || item.notes.length > 0 || files.length > 0;
              // 오류와 노출 경고는 적용을 막는 이유라서 눌러 보지 않아도 보이게 한다.
              const warned = Boolean(item.error) || item.changes.some((change) => change.exposure.length > 0);
              const expanded = hasDetail && flipped.has(item.id) !== warned;
              return (
                <Fragment key={item.id}>
                  <tr>
                    <td className="profiles-check-cell">
                      <input
                        type="checkbox"
                        aria-label={`${item.label} 선택`}
                        checked={selected.has(item.id)}
                        disabled={!item.applicable || busy}
                        onChange={() => toggle(item.id)}
                      />
                    </td>
                    <td>{item.label}</td>
                    <td className="install-table-nowrap">
                      <StatusTag tone={state.tone}>{state.label}</StatusTag>
                    </td>
                    <td className="mono muted">{item.sources.join(" · ")}</td>
                    <td className="install-table-nowrap">{files.length > 0 ? `${files.length}개` : "없음"}</td>
                    <td className="profiles-check-cell">
                      {hasDetail && <ExpandButton label={item.label} expanded={expanded} onToggle={() => flip(item.id)} />}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="profiles-row-detail">
                      <td colSpan={6}>
                        {item.error && <Banner tone="err">{item.error}</Banner>}
                        {item.notes.length > 0 && (
                          <ul className="capture-notes">
                            {item.notes.map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        )}
                        {files.map((change) => (
                          <details className="capture-file" key={change.displayPath} open>
                            <summary>
                              <StatusTag tone={change.scope === "repo" ? "ok" : "muted"}>
                                {change.scope === "repo" ? "프로필" : "개인 설정"}
                              </StatusTag>
                              <span className="mono">{change.displayPath}</span>
                              {!change.existed && <StatusTag tone="muted">새 파일</StatusTag>}
                            </summary>
                            {change.exposure.map((flag) => (
                              <div className="capture-exposure" key={`${flag.line}-${flag.kind}`}>
                                <StatusTag tone="warn">{EXPOSURE_LABELS[flag.kind]}</StatusTag>
                                <span className="mono">
                                  {flag.line}행: {flag.text}
                                </span>
                              </div>
                            ))}
                            {change.diff && <DiffView diff={change.diff} />}
                          </details>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
