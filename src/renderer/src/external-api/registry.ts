export type RegistryKind = "source" | "skill" | "blueprint" | "technology";

export type RegistryView = {
  kind: RegistryKind;
  id: string;
};

export type RegistryRowData = {
  id: string;
  searchText: string;
  fields: Record<string, string | string[]>;
};

export type RegistrySort = {
  key: string;
  direction: "asc" | "desc";
};

export type RegistryQuery = {
  query?: string;
  filters?: Record<string, string | undefined>;
  sort?: RegistrySort;
  page?: number;
  pageSize?: number;
};

export type RegistryPage<T> = {
  items: T[];
  page: number;
  pageSize: 25 | 50;
  totalItems: number;
  totalPages: number;
};

const kinds = new Set<RegistryKind>(["source", "skill", "blueprint", "technology"]);
const safeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

export function serializeRegistryView(view: RegistryView): string {
  return `${view.kind}:${view.id}`;
}

export function parseRegistryView(
  search: string,
  available: Partial<Record<RegistryKind, ReadonlySet<string>>>,
): RegistryView | null {
  const value = new URLSearchParams(search).get("view");
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  const kind = value.slice(0, separator) as RegistryKind;
  const id = value.slice(separator + 1);
  if (!kinds.has(kind) || !safeId.test(id) || !available[kind]?.has(id)) return null;
  return { kind, id };
}

function comparableValue(row: RegistryRowData, key: string): string {
  if (key === "id") return row.id;
  if (key === "searchText") return row.searchText;
  const value = row.fields[key];
  return Array.isArray(value) ? value.join(" ") : value ?? "";
}

export function deriveRegistryPage<T extends RegistryRowData>(rows: T[], query: RegistryQuery): RegistryPage<T> {
  const needle = query.query?.trim().toLocaleLowerCase("ko");
  const filters = Object.entries(query.filters ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1]));
  const filtered = rows.filter((row) => {
    if (needle && !`${row.id} ${row.searchText}`.toLocaleLowerCase("ko").includes(needle)) return false;
    return filters.every(([key, expected]) => {
      const actual = row.fields[key];
      return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
    });
  });

  const sort = query.sort;
  const sorted = sort
    ? filtered.map((row, index) => ({ row, index })).sort((left, right) => {
      const result = collator.compare(comparableValue(left.row, sort.key), comparableValue(right.row, sort.key));
      return (sort.direction === "asc" ? result : -result) || left.index - right.index;
    }).map(({ row }) => row)
    : filtered;

  const pageSize: 25 | 50 = query.pageSize === 50 ? 50 : 25;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(query.page ?? 1)), totalPages);
  const start = (page - 1) * pageSize;
  return { items: sorted.slice(start, start + pageSize), page, pageSize, totalItems: sorted.length, totalPages };
}
