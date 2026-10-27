import { useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * 화면들이 같이 쓰는 작은 조각(M13). 새 디자인 시스템이 아니라 페이지마다 반복되던 마크업에 이름을 붙인 것이다.
 * 클래스 이름은 index.css의 "공통 컴포넌트" 구간과 짝이다.
 */

export type Tone = "ok" | "warn" | "err" | "muted";

/** 화면 머리: 제목, 한 줄 메타, 오른쪽 동작 버튼. */
export function PageHeader({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h2>{title}</h2>
      {meta !== undefined && <span className="page-head-meta">{meta}</span>}
      {children && <div className="page-head-actions">{children}</div>}
    </div>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
}

/**
 * 탭 줄. 화살표·Home·End로 옮겨 다닐 수 있다(WAI-ARIA tabs). 선택한 탭만 Tab 키로 들어간다.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange(id: T): void;
  label: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const target = items[next]!;
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => {
            if (element) refs.current.set(item.id, element);
            else refs.current.delete(item.id);
          }}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          className="tab"
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** 한 줄 도구 모음. `ToolbarSpacer` 뒤의 것은 오른쪽으로 민다. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function ToolbarSpacer() {
  return <span className="toolbar-spacer" />;
}

/** 테두리 있는 묶음. head가 있으면 위에 제목 줄을 그린다. */
export function Panel({ head, children, className }: { head?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={className ? `panel ${className}` : "panel"}>
      {head && <header className="panel-head">{head}</header>}
      {children}
    </section>
  );
}

/** 상태 글자 라벨. 색은 보조이고 글자가 의미를 전한다(UI 규약). */
export function StatusTag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="status-tag" data-tone={tone}>
      {children}
    </span>
  );
}

/** 상태 점. 장식이므로 같은 줄에 글자 라벨이 있어야 한다. */
export function StateDot({ state }: { state: "ok" | "warn" | "fail" | "info" }) {
  return <span className="state-dot" data-state={state} aria-hidden="true" />;
}

export function Banner({ tone, children }: { tone: Exclude<Tone, "muted">; children: ReactNode }) {
  return (
    <div className="banner" data-tone={tone} role={tone === "err" ? "alert" : undefined}>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** 체크박스와 라벨 한 묶음. */
export function Check({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange(): void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      {children}
    </label>
  );
}
