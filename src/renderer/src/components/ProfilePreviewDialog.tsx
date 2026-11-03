import { useRef } from "react";
import type {
  ProfilePreview,
  ProfileSyncPreview,
} from "@shared/setup-profile-types";
import { Banner, PageHeader } from "./ui";
import { useModalFocus } from "./useModalFocus";

export type ProfileAction = "edit" | "export" | "import" | "sync";

const TITLES: Record<ProfileAction, string> = {
  edit: "저장 미리보기",
  export: "내보내기 미리보기",
  import: "가져오기 미리보기",
  sync: "동기화 미리보기",
};

const APPLY_LABELS: Record<ProfileAction, string> = {
  edit: "변경 적용",
  export: "파일로 저장",
  import: "새 프로필로 가져오기",
  sync: "변경 적용",
};

export default function ProfilePreviewDialog({
  preview,
  action,
  busy,
  error,
  choices,
  onChoose,
  onApply,
  onClose,
}: {
  preview: ProfilePreview;
  action: ProfileAction;
  busy: boolean;
  error: string;
  choices: Record<string, "local" | "remote">;
  onChoose(conflict: string, choice: "local" | "remote"): void;
  onApply(): void;
  onClose(): void;
}) {
  const root = useRef<HTMLElement>(null);
  useModalFocus(root);
  const conflicts =
    action === "sync" ? ((preview as ProfileSyncPreview).conflicts ?? []) : [];
  const title = TITLES[action];
  return (
    <section
      ref={root}
      className="pc-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="pc-dialog">
        <PageHeader title={title}>
          <button className="btn ghost" disabled={busy} onClick={onClose}>
            닫기
          </button>
        </PageHeader>
        {/* 적용에 실패해도 모달이 닫히지 않으므로 오류를 여기서도 보여 준다. */}
        {error && <Banner tone="err">{error}</Banner>}
        <div className="pc-scroll">
          {preview.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          {preview.changes.length === 0 && (
            <p className="muted">바뀌는 파일이 없습니다.</p>
          )}
          {preview.changes.map((change) => (
            <details key={change.file} open>
              <summary>{change.file}</summary>
              <pre className="capture-diff">{change.diff}</pre>
            </details>
          ))}
          {conflicts.map((conflict) => (
            <label key={conflict} className="pc-inline">
              {conflict} 충돌
              <select
                aria-label={`${conflict} 충돌 선택`}
                value={choices[conflict] ?? ""}
                onChange={(event) =>
                  onChoose(conflict, event.target.value as "local" | "remote")
                }
              >
                <option value="">선택하세요</option>
                <option value="local">이 PC 프로필 유지</option>
                <option value="remote">원격 프로필 사용</option>
              </select>
            </label>
          ))}
        </div>
        <footer className="pc-footer">
          <span className="muted">
            {action === "edit" ? "저장은 프로필만 변경합니다." : ""}
          </span>
          <button
            className="btn primary"
            disabled={busy || conflicts.some((key) => !choices[key])}
            onClick={onApply}
          >
            {busy ? "적용 중…" : APPLY_LABELS[action]}
          </button>
        </footer>
      </div>
    </section>
  );
}
