import { useEffect, useMemo, useState } from "react";
import type { Catalog, Source } from "@shared/external-api/schema";
import { ToolbarSpacer } from "../../components/ui";
import { addToComparison, removeFromComparison } from "../../external-api/discovery";
import type { RegistryView } from "../../external-api/registry";

type Props = {
  catalog: Catalog;
  initialIds: string[];
  onOpen(view: RegistryView): void;
  onClose(): void;
};

const ROWS: [string, (source: Source, names: Record<string, string>) => string][] = [
  ["인증", (source) => source.auth],
  ["비용", (source) => source.cost],
  ["형식", (source) => source.formats.join(" · ")],
  ["갱신", (source) => source.updateFrequency],
  ["지역", (source) => source.geography.join(" · ")],
  ["CORS", (source) => source.cors],
  ["기술", (source, names) => source.technologyIds.map((id) => names[id] ?? id).join(" · ")],
];

/** 정보원 최대 4개를 같은 표에서 비교한다(jk-external-api compare 페이지를 대화상자로 옮김). */
export default function CompareDialog({ catalog, initialIds, onOpen, onClose }: Props) {
  const { sources, technologies } = catalog;
  const [ids, setIds] = useState(initialIds.slice(0, 4));
  const chosen = useMemo(() => ids.map((id) => sources.find((source) => source.id === id)).filter((source): source is Source => Boolean(source)), [ids, sources]);
  const names = Object.fromEntries(technologies.map(({ id, name }) => [id, name]));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="ext-dialog ext-compare" role="dialog" aria-modal="true" aria-labelledby="ext-compare-title">
        <div className="ext-dialog-head">
          <h2 id="ext-compare-title">정보원 비교</h2>
          <ToolbarSpacer />
          <select
            value=""
            aria-label="정보원 추가"
            disabled={ids.length >= 4}
            onChange={(event) => setIds((current) => addToComparison(current, event.target.value))}
          >
            <option value="">정보원 추가 ({ids.length}/4)</option>
            {sources
              .filter(({ id }) => !ids.includes(id))
              .map((source) => (
                <option value={source.id} key={source.id}>
                  {source.name}
                </option>
              ))}
          </select>
          <button type="button" className="btn ghost" onClick={onClose}>
            닫기
          </button>
        </div>
        {chosen.length === 0 ? (
          <p className="empty">비교할 정보원을 최대 4개 고르세요.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">항목</th>
                {chosen.map((source) => (
                  <th scope="col" key={source.id}>
                    <button type="button" className="ext-link" onClick={() => onOpen({ kind: "source", id: source.id })}>
                      {source.name}
                    </button>
                    <button type="button" className="btn ghost ext-remove" onClick={() => setIds((current) => removeFromComparison(current, source.id))}>
                      빼기
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, getter]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {chosen.map((source) => (
                    <td key={source.id}>{getter(source, names)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
