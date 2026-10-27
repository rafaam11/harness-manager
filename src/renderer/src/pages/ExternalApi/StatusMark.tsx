type Props = { kind: "auth" | "preview" | "freshness"; value: string };

const icons = { auth: "◇", preview: "↗", freshness: "◷" };
const labels = { auth: "인증", preview: "미리보기", freshness: "갱신" };

/** 기호는 보조이고 글자 라벨이 함께 나온다(UI 규약). */
export function StatusMark({ kind, value }: Props) {
  return (
    <span className={`ext-status ext-status-${kind}`}>
      <span aria-hidden="true">{icons[kind]}</span> {labels[kind]}: {value}
    </span>
  );
}
