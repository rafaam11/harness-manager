import type { ComponentDefinition } from "@shared/workbench-types";
import { Check } from "./ui";

export function ComponentEditor({ value, existing, busy, onChange, onReview, onCancel }: {
  value: ComponentDefinition; existing: boolean; busy: boolean;
  onChange(value: ComponentDefinition): void; onReview(): void; onCancel(): void;
}) {
  const file = value.kind === "skill" ? "SKILL.md" : "instructions.md";
  return <form className="pc-editor" onSubmit={event => { event.preventDefault(); onReview(); }}>
    <div className="pc-fields">
      <label>이름<input required maxLength={120} value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} /></label>
      <label>{value.kind === "skill" ? "폴더 이름" : "구분 이름"}<input required maxLength={80} pattern="[a-z0-9][a-z0-9-]*" readOnly={existing} value={value.id} onChange={e => onChange({ ...value, id: e.target.value })} placeholder="code-review · 영문 소문자" /></label>
    </div>
    <label>설명<input maxLength={2000} value={value.description} onChange={e => onChange({ ...value, description: e.target.value })} /></label>
    <div className="pc-inline"><span className="muted">적용 대상</span>{(["claude", "codex"] as const).map(provider => <Check key={provider} checked={value.targets.includes(provider)} onChange={() => onChange({ ...value, targets: value.targets.includes(provider) ? value.targets.filter(t => t !== provider) : [...value.targets, provider] })}>{provider === "claude" ? "Claude Code" : "Codex"}</Check>)}</div>
    <label className="pc-body-field">본문<textarea required spellCheck={false} value={value.files[file]} onChange={e => onChange({ ...value, files: { ...value.files, [file]: e.target.value } })} /></label>
    <footer className="pc-footer"><button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>취소</button><button type="submit" className="btn" disabled={busy || !value.targets.length}>변경 검토</button></footer>
  </form>;
}
