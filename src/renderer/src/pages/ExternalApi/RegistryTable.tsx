import { useMemo, useState } from "react";
import type { Blueprint, Catalog, Skill, Source, Technology } from "@shared/external-api/schema";
import { formatDomain, formatDomains, formatSkillCategory, formatTechnologyCategory } from "../../external-api/labels";
import { deriveRegistryPage, type RegistryKind, type RegistryRowData, type RegistrySort, type RegistryView } from "../../external-api/registry";

type RecordByKind = { source: Source; skill: Skill; blueprint: Blueprint; technology: Technology };
type RegistryRecord = RecordByKind[RegistryKind];
type Row = RegistryRowData & { record: RegistryRecord; name: string };
type Column = { key: string; label: string; value: (row: Row) => string };

type Props = {
  kind: RegistryKind;
  catalog: Catalog;
  /** 미리 거른 목록(정보원 탭의 검색 결과). 없으면 그 종류 전체. */
  records?: RegistryRecord[];
  toolbar?: boolean;
  onOpen(view: RegistryView): void;
};

const kindLabels: Record<RegistryKind, string> = { source: "정보원", skill: "k-skill", blueprint: "청사진", technology: "기술" };
const pad = (count: number) => String(count).padStart(4, "0");

function toRows(kind: RegistryKind, records: RegistryRecord[], catalog: Catalog): Row[] {
  return records.map((record): Row => {
    if (kind === "source") {
      const source = record as Source;
      return {
        record,
        id: source.id,
        name: source.name,
        searchText: [source.name, source.operator, source.summary, ...source.keywords, ...source.formats].join(" "),
        fields: { category: source.domains, auth: source.auth, name: source.name, update: source.updateFrequency, formats: source.formats },
      };
    }
    if (kind === "skill") {
      const skill = record as Skill;
      return {
        record,
        id: skill.id,
        name: skill.name,
        searchText: [skill.name, skill.description, skill.category, ...skill.runtimes, ...skill.auth].join(" "),
        fields: { category: skill.category, auth: skill.auth, name: skill.name, runtime: skill.runtimes, sources: pad(skill.sourceIds.length) },
      };
    }
    if (kind === "blueprint") {
      const blueprint = record as Blueprint;
      return {
        record,
        id: blueprint.id,
        name: blueprint.name,
        searchText: [blueprint.name, blueprint.problem, ...blueprint.outputs, ...blueprint.stack].join(" "),
        fields: {
          category: blueprint.sourceIds.map((id) => catalog.sources.find((item) => item.id === id)?.domains[0] ?? ""),
          name: blueprint.name,
          problem: blueprint.problem,
          sources: pad(blueprint.sourceIds.length),
          output: blueprint.outputs[0] ?? "",
        },
      };
    }
    const technology = record as Technology;
    return {
      record,
      id: technology.id,
      name: technology.name,
      searchText: [technology.name, technology.category, technology.summary].join(" "),
      fields: {
        category: technology.category,
        name: technology.name,
        sources: pad(catalog.sources.filter((source) => source.technologyIds.includes(technology.id)).length),
        skills: pad(catalog.skills.filter((skill) => skill.technologyIds.includes(technology.id)).length),
      },
    };
  });
}

function columnsFor(kind: RegistryKind, catalog: Catalog): Column[] {
  if (kind === "source") {
    return [
      { key: "name", label: "이름", value: ({ record }) => (record as Source).name },
      { key: "category", label: "분야", value: ({ record }) => formatDomains((record as Source).domains) },
      { key: "auth", label: "인증", value: ({ record }) => (record as Source).auth },
      { key: "update", label: "갱신", value: ({ record }) => (record as Source).updateFrequency },
      { key: "formats", label: "형식", value: ({ record }) => (record as Source).formats.join(" · ") },
    ];
  }
  if (kind === "skill") {
    return [
      { key: "name", label: "이름", value: ({ record }) => (record as Skill).name },
      { key: "category", label: "분류", value: ({ record }) => formatSkillCategory((record as Skill).category) },
      { key: "runtime", label: "실행 환경", value: ({ record }) => (record as Skill).runtimes.join(" · ") || "문서 확인" },
      { key: "auth", label: "인증 단서", value: ({ record }) => (record as Skill).auth.join(" · ") || "없음" },
      { key: "sources", label: "연결 정보원", value: ({ record }) => `${(record as Skill).sourceIds.length}개` },
    ];
  }
  if (kind === "blueprint") {
    return [
      { key: "name", label: "이름", value: ({ record }) => (record as Blueprint).name },
      { key: "problem", label: "해결 문제", value: ({ record }) => (record as Blueprint).problem },
      { key: "sources", label: "정보원", value: ({ record }) => `${(record as Blueprint).sourceIds.length}개` },
      { key: "output", label: "주요 출력", value: ({ record }) => (record as Blueprint).outputs[0] ?? "-" },
    ];
  }
  return [
    { key: "name", label: "이름", value: ({ record }) => (record as Technology).name },
    { key: "category", label: "분류", value: ({ record }) => formatTechnologyCategory((record as Technology).category) },
    { key: "sources", label: "정보원", value: ({ record }) => `${catalog.sources.filter((source) => source.technologyIds.includes(record.id)).length}개` },
    { key: "skills", label: "k-skill", value: ({ record }) => `${catalog.skills.filter((skill) => skill.technologyIds.includes(record.id)).length}개` },
  ];
}

export default function RegistryTable({ kind, catalog, records, toolbar = true, onOpen }: Props) {
  const all = records ?? (kind === "source" ? catalog.sources : kind === "skill" ? catalog.skills : kind === "blueprint" ? catalog.blueprints : catalog.technologies);
  const rows = useMemo(() => toRows(kind, all as RegistryRecord[], catalog), [kind, all, catalog]);
  const columns = columnsFor(kind, catalog);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<RegistrySort>({ key: "name", direction: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50>(25);
  const categories = [
    ...new Set(
      rows.flatMap((row) => {
        const value = row.fields.category;
        return Array.isArray(value) ? value : value ? [value] : [];
      }),
    ),
  ]
    .filter(Boolean)
    .sort();
  const result = deriveRegistryPage(rows, { query, filters: { category }, sort, page, pageSize });
  const categoryLabel = (value: string) =>
    kind === "source" || kind === "blueprint" ? formatDomain(value) : kind === "skill" ? formatSkillCategory(value) : formatTechnologyCategory(value);

  const changeSort = (key: string) => {
    setSort((current) => (current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }));
    setPage(1);
  };

  return (
    <section className="ext-registry" aria-label={`${kindLabels[kind]} 목록`}>
      {toolbar && (
        <div className="toolbar">
          <input
            type="search"
            className="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={`${kindLabels[kind]} 이름·설명 검색`}
            aria-label="목록 검색"
          />
          <select
            value={category}
            aria-label={kind === "source" ? "분야" : "분류"}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{kind === "source" ? "분야 전체" : "분류 전체"}</option>
            {categories.map((item) => (
              <option value={item} key={item}>
                {categoryLabel(item)}
              </option>
            ))}
          </select>
          <span className="muted">
            {result.totalItems} / {rows.length}개
          </span>
        </div>
      )}
      <table className="data-table ext-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                <button type="button" className="ext-sort" onClick={() => changeSort(column.key)}>
                  {column.label}
                  <span aria-hidden="true">{sort.key === column.key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.items.map((row) => (
            <tr key={row.id}>
              {columns.map((column, index) => (
                <td key={column.key} title={column.value(row)}>
                  {index === 0 ? (
                    <button type="button" className="ext-link" onClick={() => onOpen({ kind, id: row.id })}>
                      {column.value(row)}
                    </button>
                  ) : (
                    column.value(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.totalItems === 0 && <p className="empty">조건과 맞는 기록이 없습니다. 검색어나 필터를 조정하세요.</p>}
      {rows.length > 25 && (
        <nav className="ext-pagination" aria-label="목록 페이지">
          <button type="button" className="btn ghost" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={result.page === 1}>
            이전
          </button>
          <span>
            {result.page} / {result.totalPages}
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setPage((current) => Math.min(result.totalPages, current + 1))}
            disabled={result.page === result.totalPages}
          >
            다음
          </button>
          <select
            value={pageSize}
            aria-label="페이지당 항목"
            onChange={(event) => {
              setPageSize(Number(event.target.value) === 50 ? 50 : 25);
              setPage(1);
            }}
          >
            <option value="25">25개씩</option>
            <option value="50">50개씩</option>
          </select>
        </nav>
      )}
    </section>
  );
}
