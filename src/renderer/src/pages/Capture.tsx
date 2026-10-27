import { useEffect, useState } from "react";
import type { CaptureItem, CapturePlan, CaptureTargetId, ManifestFileReport } from "@shared/manifest-types";
import { Banner, StatusTag, ToolbarSpacer } from "../components/ui";
import { ApiError, call } from "../api/client";
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
  const [plan, setPlan] = useState<CapturePlan | null>(null);
  const [reports, setReports] = useState<ManifestFileReport[] | null>(null);
  const [selected, setSelected] = useState<Set<CaptureTargetId>>(new Set());
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

  const chooseRepo = async () => {
    try {
      const chosen = await call("capture:choose-repo");
      if (chosen) {
        showToast({ tone: "success", title: "레포 위치를 기억했습니다", detail: chosen });
        await load();
      }
    } catch (caught) {
      showToast({ tone: "error", title: "레포 폴더가 아닙니다", detail: (caught as Error).message });
    }
  };

  const applicable = plan?.items.filter((item) => item.applicable) ?? [];
  const chosen = applicable.filter((item) => selected.has(item.id));

  const toggle = (id: CaptureTargetId) =>
    setSelected((prev) => {
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
      <p className="muted capture-intro">
        이 PC의 설정을 레포 템플릿과 manifest로 끌어옵니다. 개인 부분은 로컬 프로필로 나뉘고, 공개 파일에 개인 정보가 남으면 적용할 수
        없습니다.
      </p>
      {error && <Banner tone="err">{error}</Banner>}

      {plan && (
        <div className="capture-repo">
          <span className="muted">레포</span>
          <span className="mono">{plan.repoRoot ?? "(모름)"}</span>
          <button className="btn ghost" onClick={chooseRepo} disabled={busy}>
            레포 폴더 선택
          </button>
        </div>
      )}
      {plan?.repoError && <Banner tone="warn">{plan.repoError}</Banner>}
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

      {plan?.repoRoot && (
        <div className="toolbar">
          <label className="check">
            <input
              type="checkbox"
              checked={applicable.length > 0 && chosen.length === applicable.length}
              disabled={applicable.length === 0}
              onChange={() =>
                setSelected(chosen.length === applicable.length ? new Set() : new Set(applicable.map((item) => item.id)))
              }
            />
            적용 가능한 항목 전체
          </label>
          <span className="muted">
            선택 {chosen.length} / {applicable.length}
          </span>
          <ToolbarSpacer />
          <button className="btn ghost" onClick={() => void load()} disabled={busy}>
            다시 불러오기
          </button>
          <button className="btn" onClick={() => void apply()} disabled={busy || chosen.length === 0}>
            적용 ({chosen.length})
          </button>
        </div>
      )}

      {plan?.items.map((item) => {
        const state = itemState(item);
        return (
          <section className="panel" key={item.id}>
            <header className="panel-head">
              <input
                type="checkbox"
                aria-label={`${item.label} 선택`}
                checked={selected.has(item.id)}
                disabled={!item.applicable || busy}
                onChange={() => toggle(item.id)}
              />
              <span className="panel-title">{item.label}</span>
              <StatusTag tone={state.tone}>{state.label}</StatusTag>
              <span className="mono muted panel-aside">{item.sources.join(" · ")}</span>
            </header>
            {item.error && <Banner tone="err">{item.error}</Banner>}
            {item.notes.length > 0 && (
              <ul className="capture-notes">
                {item.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
            {item.changes
              .filter((change) => change.changed || change.exposure.length > 0)
              .map((change) => (
                <details className="capture-file" key={change.displayPath} open>
                  <summary>
                    <StatusTag tone={change.scope === "repo" ? "ok" : "muted"}>
                      {change.scope === "repo" ? "레포" : "로컬 전용"}
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
          </section>
        );
      })}
    </div>
  );
}
