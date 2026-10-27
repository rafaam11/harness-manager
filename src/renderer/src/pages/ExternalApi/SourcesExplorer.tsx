import { useMemo, useState } from "react";
import type { Catalog, Source } from "@shared/external-api/schema";
import { Tabs, ToolbarSpacer } from "../../components/ui";
import { addToComparison, filterSources, removeFromComparison, type SourceFilters } from "../../external-api/discovery";
import { formatDomain, formatDomains } from "../../external-api/labels";
import type { RegistryView } from "../../external-api/registry";
import RegistryTable from "./RegistryTable";
import { StatusMark } from "./StatusMark";

/**
 * 관계도의 분야선 색. 분류색(데이터 계열)이라 상태색과 섞지 않는다. 노선 이름은 오른쪽 기록 카드와 목록에 글자로도
 * 나오므로 색만으로 구분하지 않는다. (jk-external-api HomeExplorer에서 옮김)
 */
const lineColors: Record<string, string> = {
  public: "#2357A5", facility: "#687C46", statistics: "#725792", seoul: "#BA3A36", local: "#9C5C27", business: "#9C5C27",
  weather: "#2357A5", environment: "#687C46", mobility: "#BA3A36", geospatial: "#725792", place: "#9C5C27", search: "#687C46",
  health: "#BA3A36", culture: "#725792",
};

type Props = {
  catalog: Catalog;
  onOpen(view: RegistryView): void;
  onCompare(ids: string[]): void;
};

export default function SourcesExplorer({ catalog, onOpen, onCompare }: Props) {
  const { sources, technologies } = catalog;
  const [filters, setFilters] = useState<SourceFilters>({});
  const [selectedId, setSelectedId] = useState(sources[0]?.id ?? "");
  const [comparison, setComparison] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const technologyNames = useMemo(() => Object.fromEntries(technologies.map(({ id, name }) => [id, name])), [technologies]);
  const matches = useMemo(() => filterSources(sources, { ...filters, technologyNames }), [sources, filters, technologyNames]);
  const selected: Source | undefined = sources.find(({ id }) => id === selectedId) ?? matches[0] ?? sources[0];
  const domains = [...new Set(sources.flatMap(({ domains: values }) => values))].sort();
  const lineGroups = [...new Set(sources.flatMap(({ home }) => home.lines))].map((line) => ({
    line,
    points: sources
      .filter(({ home }) => home.lines.includes(line))
      .map(({ home }) => `${home.x},${home.y}`)
      .join(" "),
  }));

  const update = (key: keyof SourceFilters, value: string) => setFilters((current) => ({ ...current, [key]: value || undefined }));
  const toggleComparison = (id: string) =>
    setComparison((current) => (current.includes(id) ? removeFromComparison(current, id) : addToComparison(current, id)));

  return (
    <section className="ext-explorer" aria-label="정보원 탐색">
      <div className="toolbar ext-filters">
        <input
          type="search"
          className="search"
          value={filters.query ?? ""}
          onChange={(event) => update("query", event.target.value)}
          placeholder="예: 미세먼지, 공연장, REST API"
          aria-label="통합 검색"
        />
        <select aria-label="분야" value={filters.domain ?? ""} onChange={(event) => update("domain", event.target.value)}>
          <option value="">분야 전체</option>
          {domains.map((domain) => (
            <option value={domain} key={domain}>
              {formatDomain(domain)}
            </option>
          ))}
        </select>
        <select aria-label="제공 방식" value={filters.delivery ?? ""} onChange={(event) => update("delivery", event.target.value)}>
          <option value="">제공 방식 전체</option>
          <option value="open-api">Open API</option>
          <option value="file">파일</option>
          <option value="sdk">SDK</option>
        </select>
        <select aria-label="인증" value={filters.auth ?? ""} onChange={(event) => update("auth", event.target.value)}>
          <option value="">인증 전체</option>
          <option value="none">없음</option>
          <option value="api-key">API 키</option>
          <option value="mixed">혼합</option>
        </select>
        <select aria-label="실시간성" value={filters.realtime ?? ""} onChange={(event) => update("realtime", event.target.value)}>
          <option value="">실시간성 전체</option>
          <option value="realtime">실시간</option>
          <option value="minutes">분 단위</option>
          <option value="hourly">시간 단위</option>
          <option value="daily">일 단위</option>
          <option value="periodic">주기 갱신</option>
        </select>
        <select aria-label="지역" value={filters.geography ?? ""} onChange={(event) => update("geography", event.target.value)}>
          <option value="">지역 전체</option>
          <option value="nationwide">전국</option>
          <option value="seoul">서울</option>
          <option value="regional">지역별</option>
          <option value="global">전 세계</option>
        </select>
      </div>

      <div className="toolbar">
        <Tabs<"list" | "map">
          label="보기 방식"
          value={viewMode}
          onChange={setViewMode}
          items={[
            { id: "list", label: "목록" },
            { id: "map", label: "관계도" },
          ]}
        />
        <span className="muted">
          {matches.length} / {sources.length}개 정보원
        </span>
        <ToolbarSpacer />
        <span className="muted">비교함 {comparison.length}/4</span>
        <button type="button" className="btn" disabled={comparison.length === 0} onClick={() => onCompare(comparison)}>
          비교표 열기
        </button>
      </div>

      {viewMode === "list" ? (
        <RegistryTable kind="source" catalog={catalog} records={matches} toolbar={false} onOpen={onOpen} />
      ) : (
        <div className="ext-map-grid">
          <ol className="ext-rail" aria-label={`검색 결과 ${matches.length}개`}>
            {matches.map((source) => (
              <li key={source.id}>
                <button type="button" className={selected?.id === source.id ? "selected" : undefined} onClick={() => setSelectedId(source.id)}>
                  <span className="muted">{formatDomain(source.domains[0] ?? "")}</span>
                  <strong>{source.name}</strong>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="muted">조건과 맞는 정보원이 없습니다.</li>}
          </ol>

          <svg className="ext-map" viewBox="0 0 125 100" role="img" aria-label="정보원 관계 노선도. 같은 분야선으로 이어진 정보원은 주제가 연결된다.">
            <g>
              {lineGroups.map(({ line, points }) =>
                points.includes(" ") ? (
                  <polyline key={line} points={points} fill="none" stroke={lineColors[line] ?? "#687C46"} strokeWidth={1.25} strokeLinecap="square" strokeLinejoin="bevel" />
                ) : null,
              )}
            </g>
            {sources.map((source) => {
              const active = matches.some(({ id }) => id === source.id);
              const isSelected = selected?.id === source.id;
              return (
                <g
                  key={source.id}
                  transform={`translate(${source.home.x} ${source.home.y})`}
                  className={`ext-node${active ? "" : " muted"}${isSelected ? " selected" : ""}`}
                  role="button"
                  tabIndex={active ? 0 : -1}
                  aria-label={`${source.name} 선택`}
                  onClick={() => active && setSelectedId(source.id)}
                  onKeyDown={(event) => {
                    if (active && (event.key === "Enter" || event.key === " ")) setSelectedId(source.id);
                  }}
                >
                  <circle r={isSelected ? 3.2 : 2.4} stroke={lineColors[source.home.lines[0] ?? ""] ?? "#2357A5"} strokeWidth={isSelected ? 1.4 : 0.9} />
                  <text x="3.4" y="0.9" fontSize="2.1">
                    {source.name}
                  </text>
                </g>
              );
            })}
          </svg>

          {selected && (
            <aside className="ext-dossier" aria-live="polite">
              <span className="muted">{formatDomains(selected.domains, " / ")}</span>
              <h3>{selected.name}</h3>
              <p className="muted">{selected.summary}</p>
              <div className="ext-status-row">
                <StatusMark kind="auth" value={selected.auth} />
                <StatusMark kind="freshness" value={selected.updateFrequency} />
              </div>
              <dl className="ext-facts">
                <div><dt>운영기관</dt><dd>{selected.operator}</dd></div>
                <div><dt>형식</dt><dd>{selected.formats.join(" · ")}</dd></div>
                <div><dt>확인일</dt><dd>{selected.lastVerifiedAt}</dd></div>
              </dl>
              <div className="ext-dialog-links">
                <button type="button" className="btn" onClick={() => onOpen({ kind: "source", id: selected.id })}>
                  상세 기록
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => toggleComparison(selected.id)}
                  disabled={!comparison.includes(selected.id) && comparison.length >= 4}
                >
                  {comparison.includes(selected.id) ? "비교에서 빼기" : "비교에 담기"}
                </button>
              </div>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}
