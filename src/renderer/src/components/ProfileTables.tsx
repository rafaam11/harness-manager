import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

export type Value =
  | null
  | string
  | number
  | boolean
  | Value[]
  | { [key: string]: Value };
export type Dict = { [key: string]: Value };

/** 행 상세가 다시 값을 그릴 때 쓰는 입력. ProfileFields를 넘겨 순환 import를 피한다. */
export type FieldProps = {
  value: Value;
  onChange(value: Value): void;
  label?: string;
  field?: string;
  disabled?: boolean;
  flatKeys?: boolean;
  compact?: boolean;
  ariaPrefix?: string;
};
type Nested = ComponentType<FieldProps>;

export const LABELS: Record<string, string> = {
  packages: "패키지",
  tools: "도구",
  marketplaces: "마켓플레이스",
  servers: "MCP 서버",
  external: "외부 스킬",
  enabled: "활성 플러그인",
  profiles: "설치 범위",
  source: "소스",
  name: "이름",
  id: "식별자",
  bin: "실행 파일",
  command: "명령",
  args: "인자",
  env: "환경변수 (값은 ${이름} 사용)",
  targets: "대상",
  providers: "대상",
  install: "설치 방식",
  verify: "설치 확인",
  kind: "종류",
  ref: "패키지 또는 설치 주소",
  repo: "저장소",
  url: "주소",
  description: "설명",
  version: "버전",
  notes: "메모",
  model: "모델",
  language: "언어",
  effortLevel: "추론 수준",
  claudeSettings: "Claude 관리 키",
  codexConfig: "Codex 관리 키",
  gitconfig: "Git 관리 키",
  plugins: "플러그인",
  mcp: "MCP",
  skills: "스킬",
};

export const FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"];
/** 형태가 고정된 객체다. 키를 더하거나 빼면 manifest 검증을 통과하지 못한다. */
export const LOCKED_KEYS = ["install", "verify", "source", "claude", "codex"];

const OPTION_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
};

// smol-toml의 날짜처럼 프로토타입이 다른 객체를 펼치면 값이 망가지므로 일반 객체만 다룬다.
export function isPlain(value: unknown): value is Dict {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isScalar(value: unknown) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export type FlatRow = { path: string[]; value: Value };

/** 내부 경로를 배열로 다뤄 점이 든 기존 키도 망가지지 않게 한다. */
export function flatten(value: Dict, prefix: string[] = []): FlatRow[] {
  return Object.entries(value).flatMap(([key, entry]): FlatRow[] => {
    if (key === "schemaVersion") return [];
    const path = [...prefix, key];
    return isPlain(entry) && Object.keys(entry).length
      ? flatten(entry, path)
      : [{ path, value: entry }];
  });
}

function getPath(root: Dict, path: string[]): Value | undefined {
  let cursor: Value | undefined = root;
  for (const segment of path) {
    if (!isPlain(cursor) || !Object.hasOwn(cursor, segment)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

export function setPath(root: Dict, path: string[], next: Value): Dict {
  const [head, ...rest] = path;
  if (!rest.length) return { ...root, [head]: next };
  const child = root[head];
  return { ...root, [head]: setPath(isPlain(child) ? child : {}, rest, next) };
}

/** 중첩의 마지막 키를 빼면 비게 된 부모도 함께 지운다. */
export function removePath(root: Dict, path: string[]): Dict {
  const [head, ...rest] = path;
  const without = () =>
    Object.fromEntries(Object.entries(root).filter(([key]) => key !== head));
  if (!rest.length) return without();
  const child = root[head];
  if (!isPlain(child)) return root;
  const next = removePath(child, rest);
  return Object.keys(next).length ? { ...root, [head]: next } : without();
}

export function canAddPath(value: Dict, segments: string[]) {
  if (
    !segments.length ||
    segments.some((segment) => !segment || FORBIDDEN_KEYS.includes(segment))
  )
    return false;
  let cursor: Value = value;
  for (const [index, segment] of segments.entries()) {
    if (!isPlain(cursor)) return false;
    if (!Object.hasOwn(cursor, segment)) return true;
    if (index === segments.length - 1) return false;
    cursor = cursor[segment];
  }
  return false;
}

/** replaced에 든 키만 next로 바꾸고 나머지 키와 순서는 그대로 둔다. */
export function rebuild(original: Dict, replaced: string[], next: Dict): Dict {
  const pairs: [string, Value][] = [];
  for (const [key, entry] of Object.entries(original)) {
    if (!replaced.includes(key)) pairs.push([key, entry]);
    else if (Object.hasOwn(next, key)) pairs.push([key, next[key]]);
  }
  for (const [key, entry] of Object.entries(next))
    if (!Object.hasOwn(original, key)) pairs.push([key, entry]);
  return Object.fromEntries(pairs);
}

export function restOf(entry: Dict, paths: string[][]): Dict {
  return paths.reduce((rest, path) => removePath(rest, path), entry);
}

/** restOf의 반대다. 열이 덮는 값은 entry에서, 나머지는 nextRest에서 가져온다. */
export function mergeRest(entry: Dict, paths: string[][], nextRest: Dict): Dict {
  const keys = [
    ...Object.keys(entry),
    ...Object.keys(nextRest).filter((key) => !Object.hasOwn(entry, key)),
  ];
  const pairs: [string, Value][] = [];
  for (const key of keys) {
    const covered = paths.filter((path) => path[0] === key);
    const hasRest = Object.hasOwn(nextRest, key);
    if (!covered.length) {
      if (hasRest) pairs.push([key, nextRest[key]]);
    } else if (covered.some((path) => path.length === 1)) {
      pairs.push([key, entry[key]]);
    } else {
      const child = entry[key];
      const rest = hasRest ? nextRest[key] : {};
      pairs.push([
        key,
        mergeRest(
          isPlain(child) ? child : {},
          covered.map((path) => path.slice(1)),
          isPlain(rest) ? rest : {},
        ),
      ]);
    }
  }
  return Object.fromEntries(pairs);
}

export function isPluginRoot(value: Dict) {
  return ["claude", "codex"].some((provider) => {
    const entry = value[provider];
    return isPlain(entry) && Array.isArray(entry.enabled);
  });
}

export function pluginPaths(value: Dict) {
  return ["claude", "codex"]
    .filter((provider) => {
      const entry = value[provider];
      return isPlain(entry) && Array.isArray(entry.enabled);
    })
    .map((provider) => [provider, "enabled"]);
}

function enabledOf(value: Dict, provider: string): Value[] {
  const enabled = getPath(value, [provider, "enabled"]);
  return Array.isArray(enabled) ? enabled : [];
}

/** 파일 목록에 보여 줄 항목 수. 플러그인은 마켓플레이스와 활성 플러그인 합집합을 센다. */
export function countProfileItems(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!isPlain(value)) return 1;
  if (isPluginRoot(value)) {
    const plugins = new Set(
      ["claude", "codex"].flatMap((provider) => enabledOf(value, provider)),
    );
    const marketplaces = value.marketplaces;
    return (
      plugins.size + (Array.isArray(marketplaces) ? marketplaces.length : 0)
    );
  }
  return Object.entries(value)
    .filter(([key]) => key !== "schemaVersion")
    .reduce((sum, [, entry]) => sum + countProfileItems(entry), 0);
}

function maskedType(field: string, value: Value) {
  return /token|password|secret|api.?key/i.test(field) &&
    !String(value).startsWith("${")
    ? "password"
    : "text";
}

export function ScalarInput({
  value,
  onChange,
  label,
  field,
  disabled = false,
}: {
  value: Value;
  onChange(value: Value): void;
  label: string;
  field: string;
  disabled?: boolean;
}) {
  if (typeof value === "boolean")
    return (
      <input
        type="checkbox"
        aria-label={label}
        disabled={disabled}
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  if ((value as unknown) instanceof Date)
    return (
      <span className="mono">{(value as unknown as Date).toISOString()}</span>
    );
  if (value !== null && typeof value === "object")
    return <span className="mono">{String(value)}</span>;
  const type =
    typeof value === "number" ? "number" : maskedType(field, value);
  // input은 줄바꿈을 지우므로 여러 줄 값은 편집 때 잃지 않도록 textarea로 받는다.
  if (typeof value === "string" && value.includes("\n") && type !== "password")
    return (
      <textarea
        className="mono"
        aria-label={label}
        rows={Math.min(value.split("\n").length, 8)}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  return (
    <input
      aria-label={label}
      disabled={disabled}
      type={type}
      // 좁은 칸에서 잘린 값을 확인하게 한다. 가린 비밀값은 툴팁으로도 내보내지 않는다.
      title={type === "password" ? undefined : String(value ?? "")}
      value={value ?? ""}
      onChange={(event) =>
        onChange(
          typeof value === "number"
            ? Number(event.target.value)
            : event.target.value,
        )
      }
    />
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  expanded,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  expanded?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="profiles-icon-button"
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function toggleOption(
  list: string[],
  options: readonly string[],
  option: string,
  checked: boolean,
) {
  if (!checked) return list.filter((entry) => entry !== option);
  // 껐다 켜도 원래 순서로 돌아오고, 목록에 없는 값은 지우지 않는다.
  return [
    ...options.filter((entry) => entry === option || list.includes(entry)),
    ...list.filter((entry) => !options.includes(entry)),
  ];
}

export function SelectionChecks({
  value,
  onChange,
  label,
  options,
  disabled = false,
  ariaPrefix = "",
}: {
  value: Value[];
  onChange(value: Value[]): void;
  label: string;
  options: readonly string[];
  disabled?: boolean;
  ariaPrefix?: string;
}) {
  const list = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  const name = ariaPrefix ? `${ariaPrefix} ${label}` : label;
  return (
    <div className="pc-inline" role="group" aria-label={name}>
      {options.map((option) => (
        <label className="check" key={option}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={list.includes(option)}
            onChange={(event) =>
              onChange(toggleOption(list, options, option, event.target.checked))
            }
          />
          {OPTION_LABELS[option] ?? option}
        </label>
      ))}
    </div>
  );
}

const NEW_VALUES: Record<string, () => Value> = {
  string: () => "",
  boolean: () => false,
  number: () => 0,
  array: () => [],
  object: () => ({}),
};

function KeyAdder({
  value,
  onChange,
  label,
  flatKeys,
  reservedKeys,
  disabled,
}: {
  value: Dict;
  onChange(value: Dict): void;
  label: string;
  flatKeys: boolean;
  reservedKeys: string[];
  disabled: boolean;
}) {
  const [key, setKey] = useState("");
  const [kind, setKind] = useState("string");
  const trimmed = key.trim();
  const segments = trimmed ? (flatKeys ? [trimmed] : trimmed.split(".")) : [];
  const allowed =
    canAddPath(value, segments) &&
    !reservedKeys.includes(segments[0]) &&
    !segments.slice(0, -1).some((segment) => LOCKED_KEYS.includes(segment));
  return (
    <div className="profiles-table-actions">
      <input
        aria-label={`${label} 새 키`}
        placeholder={
          flatKeys ? "추가할 설정 키" : "추가할 설정 키 (중첩은 점으로)"
        }
        disabled={disabled}
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <select
        aria-label="값 종류"
        disabled={disabled}
        value={kind}
        onChange={(event) => setKind(event.target.value)}
      >
        <option value="string">문자</option>
        <option value="boolean">참/거짓</option>
        <option value="number">숫자</option>
        <option value="array">목록</option>
        <option value="object">객체</option>
      </select>
      <button
        type="button"
        className="btn ghost"
        disabled={disabled || !allowed}
        onClick={() => {
          onChange(setPath(value, segments, NEW_VALUES[kind]()));
          setKey("");
        }}
      >
        키 추가
      </button>
    </div>
  );
}

export function KeyValueTable({
  value,
  onChange,
  label,
  Nested,
  editable = false,
  flatKeys = false,
  labelled = false,
  ariaPrefix = "",
  disabled = false,
  reservedKeys = [],
}: {
  value: Dict;
  onChange(value: Dict): void;
  label: string;
  Nested: Nested;
  editable?: boolean;
  flatKeys?: boolean;
  labelled?: boolean;
  ariaPrefix?: string;
  disabled?: boolean;
  reservedKeys?: string[];
}) {
  const rows = flatten(value);
  const named = (path: string[]) => {
    const name = labelled
      ? path.map((segment) => LABELS[segment] ?? segment).join(" ")
      : path.length === 1
        ? (LABELS[path[0]] ?? path[0])
        : path.join(".");
    return ariaPrefix ? `${ariaPrefix} ${name}` : name;
  };
  return (
    <div className="profiles-fields">
      {rows.length > 0 && (
        <table className="data-table profiles-table">
          <colgroup>
            <col className="profiles-col-key" />
            <col />
            {editable && <col className="profiles-col-action" />}
          </colgroup>
          <thead>
            <tr>
              <th>키</th>
              <th>값</th>
              {editable && <th>빼기</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ path, value: entry }) => {
              const dotted = path.join(".");
              const last = path[path.length - 1];
              return (
                <tr key={JSON.stringify(path)}>
                  <td className={labelled ? undefined : "mono"}>
                    {labelled
                      ? path
                          .map((segment) => LABELS[segment] ?? segment)
                          .join(" · ")
                      : dotted}
                  </td>
                  <td>
                    {Array.isArray(entry) ? (
                      <Nested
                        value={entry}
                        field={last}
                        label={named(path)}
                        compact
                        disabled={disabled}
                        onChange={(next) =>
                          onChange(setPath(value, path, next))
                        }
                      />
                    ) : isPlain(entry) ? (
                      <span className="muted">빈 객체</span>
                    ) : (
                      <ScalarInput
                        value={entry}
                        field={dotted}
                        label={named(path)}
                        disabled={disabled}
                        onChange={(next) =>
                          onChange(setPath(value, path, next))
                        }
                      />
                    )}
                  </td>
                  {editable && (
                    <td>
                      {!path
                        .slice(0, -1)
                        .some((segment) => LOCKED_KEYS.includes(segment)) && (
                        <IconButton
                          label={`${dotted} 관리 해제`}
                          disabled={disabled}
                          onClick={() => onChange(removePath(value, path))}
                        >
                          <X size={14} aria-hidden />
                        </IconButton>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {editable && (
        <KeyAdder
          value={value}
          onChange={onChange}
          label={label}
          flatKeys={flatKeys}
          reservedKeys={reservedKeys}
          disabled={disabled}
        />
      )}
    </div>
  );
}

export function ListTable({
  value,
  onChange,
  label,
  field,
  blank,
  Nested,
  disabled = false,
  compact = false,
  ariaPrefix = "",
}: {
  value: Value[];
  onChange(value: Value[]): void;
  label: string;
  field: string;
  blank: Value;
  Nested: Nested;
  disabled?: boolean;
  compact?: boolean;
  ariaPrefix?: string;
}) {
  const name = ariaPrefix ? `${ariaPrefix} ${label}` : label;
  return (
    <div className="profiles-fields">
      {(!compact || value.length > 0) && (
        <table className="data-table profiles-table">
          <colgroup>
            <col />
            <col className="profiles-col-action" />
          </colgroup>
          {!compact && (
            <thead>
              <tr>
                <th>
                  {label} <span className="count">{value.length}</span>
                </th>
                <th>빼기</th>
              </tr>
            </thead>
          )}
          <tbody>
            {value.map((entry, index) => {
              const itemLabel = `${name} ${index + 1}`;
              const change = (next: Value) =>
                onChange(value.map((v, i) => (i === index ? next : v)));
              return (
                <tr key={index}>
                  <td>
                    {isScalar(entry) ? (
                      <ScalarInput
                        value={entry}
                        field={field}
                        label={itemLabel}
                        disabled={disabled}
                        onChange={change}
                      />
                    ) : (
                      <Nested
                        value={entry}
                        field={field}
                        label={itemLabel}
                        disabled={disabled}
                        onChange={change}
                      />
                    )}
                  </td>
                  <td>
                    <IconButton
                      label={`${itemLabel} 빼기`}
                      disabled={disabled}
                      onClick={() =>
                        onChange(value.filter((_, i) => i !== index))
                      }
                    >
                      <X size={14} aria-hidden />
                    </IconButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="profiles-table-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={disabled}
          onClick={() => onChange([...value, structuredClone(blank)])}
        >
          항목 추가
        </button>
      </div>
    </div>
  );
}

export type Column = {
  label: string;
  kind: "text" | "select" | "checks" | "location";
  path: string[];
  options?: readonly string[];
  /** 비우면 키를 지운다. 빈 문자열을 저장하면 검증이나 설치가 다르게 동작한다. */
  optional?: boolean;
  /** 값 하나만 바꾸면 안 되는 선택 칸이 함께 고칠 키를 정한다. */
  apply?(entry: Dict, next: string): Dict;
  /** 값이 짧은 열을 좁혀 패키지 이름·주소처럼 긴 값이 잘리지 않게 한다. 없으면 남는 폭을 나눠 갖는다. */
  col?:
    | "profiles-col-short"
    | "profiles-col-select"
    | "profiles-col-select-wide";
};
export type EntityDef = {
  columns: Column[];
  /** 없을 때도 상세에 빈칸으로 보여 줄 선택 키. 빈 값은 저장하지 않는다. */
  optional?: string[];
};

function cellFits(entry: Dict, column: Column) {
  const parents = column.path.slice(0, -1);
  for (let depth = 1; depth <= parents.length; depth++) {
    const parent = getPath(entry, parents.slice(0, depth));
    if (parent !== undefined && !isPlain(parent)) return false;
  }
  const raw = getPath(entry, column.path);
  if (raw === undefined) return true;
  if (column.kind === "checks") return isStringArray(raw);
  if (column.kind === "select") return typeof raw === "string";
  return isScalar(raw);
}

function coveredPaths(entry: Dict, columns: Column[]) {
  return columns.flatMap((column): string[][] => {
    if (column.kind === "location") {
      const source = entry.source;
      if (!isPlain(source)) return [];
      return source.kind === "github"
        ? [["source", "repo"]]
        : source.kind === "git"
          ? [["source", "url"]]
          : [];
    }
    return cellFits(entry, column) ? [column.path] : [];
  });
}

function withOptional(rest: Dict, optional: string[] = []) {
  const shown = { ...rest };
  for (const key of optional)
    if (!Object.hasOwn(shown, key)) shown[key] = "";
  return shown;
}

function stripOptional(before: Dict, next: Dict, optional: string[] = []) {
  return Object.fromEntries(
    Object.entries(next).filter(
      ([key, entry]) =>
        !(optional.includes(key) && entry === "" && before[key] !== ""),
    ),
  );
}

function EntityCells({
  entry,
  rowName,
  column,
  disabled,
  onEntry,
}: {
  entry: Dict;
  rowName: string;
  column: Column;
  disabled: boolean;
  onEntry(next: Dict): void;
}) {
  const name = `${rowName} ${column.label}`;
  const options = column.options ?? [];
  if (column.kind === "location") {
    const source = entry.source;
    if (!isPlain(source))
      return <td className="muted">상세 참조</td>;
    const key =
      source.kind === "github" ? "repo" : source.kind === "git" ? "url" : null;
    const raw = key ? source[key] : undefined;
    if (key && raw !== undefined && !isScalar(raw))
      return <td className="muted">상세 참조</td>;
    return (
      <td>
        {key ? (
          <ScalarInput
            value={raw ?? ""}
            field={`source.${key}`}
            label={name}
            disabled={disabled}
            onChange={(next) => onEntry(setPath(entry, ["source", key], next))}
          />
        ) : (
          <input
            aria-label={name}
            disabled
            value=""
            placeholder={source.kind === "self" ? "HM 저장소" : "상세 참조"}
          />
        )}
      </td>
    );
  }
  if (!cellFits(entry, column))
    return (
      <td
        className="muted"
        colSpan={column.kind === "checks" ? options.length : undefined}
      >
        상세 참조
      </td>
    );
  const raw = getPath(entry, column.path);
  if (column.kind === "checks") {
    const list = (raw as string[] | undefined) ?? [];
    return (
      <>
        {options.map((option) => (
          <td key={option} className="profiles-check-cell">
            <input
              type="checkbox"
              aria-label={`${name} ${option}`}
              disabled={disabled}
              checked={list.includes(option)}
              onChange={(event) =>
                onEntry(
                  setPath(
                    entry,
                    column.path,
                    toggleOption(list, options, option, event.target.checked),
                  ),
                )
              }
            />
          </td>
        ))}
      </>
    );
  }
  if (column.kind === "select") {
    const current = typeof raw === "string" ? raw : "";
    return (
      <td>
        <select
          aria-label={name}
          disabled={disabled}
          value={current}
          onChange={(event) =>
            onEntry(
              column.apply
                ? column.apply(entry, event.target.value)
                : setPath(entry, column.path, event.target.value),
            )
          }
        >
          {!current && <option value="">선택</option>}
          {current && !options.includes(current) && (
            <option value={current}>{current}</option>
          )}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </td>
    );
  }
  return (
    <td>
      <ScalarInput
        value={raw ?? ""}
        field={column.path.join(".")}
        label={name}
        disabled={disabled}
        onChange={(next) =>
          onEntry(
            column.optional && next === ""
              ? removePath(entry, column.path)
              : setPath(entry, column.path, next),
          )
        }
      />
    </td>
  );
}

function EntityDetail({
  entry,
  def,
  rowName,
  disabled,
  onEntry,
  Nested,
}: {
  entry: Dict;
  def: EntityDef;
  rowName: string;
  disabled: boolean;
  onEntry(next: Dict): void;
  Nested: Nested;
}) {
  const paths = coveredPaths(entry, def.columns);
  const rest = restOf(entry, paths);
  const shown = withOptional(rest, def.optional);
  const change = (next: Dict) =>
    onEntry(mergeRest(entry, paths, stripOptional(rest, next, def.optional)));
  const visible = Object.entries(shown).filter(
    ([key]) => key !== "schemaVersion",
  );
  // env, files처럼 키를 자유롭게 더할 수 있는 객체만 별도 표로 둔다.
  const objects = visible.filter(
    ([key, entryValue]) => isPlain(entryValue) && !LOCKED_KEYS.includes(key),
  );
  const others = visible.filter(([key]) =>
    objects.every(([objectKey]) => objectKey !== key),
  );
  const otherKeys = others.map(([key]) => key);
  return (
    <div className="profiles-detail">
      {others.length > 0 && (
        <KeyValueTable
          value={Object.fromEntries(others)}
          onChange={(next) => change(rebuild(shown, otherKeys, next))}
          label={rowName}
          labelled
          ariaPrefix={rowName}
          disabled={disabled}
          Nested={Nested}
        />
      )}
      {objects.map(([key, object]) => (
        <section key={key} className="profiles-section">
          <h4 className="section-label">{LABELS[key] ?? key}</h4>
          <Nested
            value={object}
            field={key}
            label={`${rowName} ${LABELS[key] ?? key}`}
            flatKeys
            ariaPrefix={rowName}
            disabled={disabled}
            onChange={(next) => change({ ...shown, [key]: next })}
          />
        </section>
      ))}
    </div>
  );
}

export function EntityTable({
  value,
  onChange,
  def,
  label,
  blank,
  Nested,
  disabled = false,
}: {
  value: Value[];
  onChange(value: Value[]): void;
  def: EntityDef;
  label: string;
  blank: Value;
  Nested: Nested;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const focusNewRow = useRef(false);
  const body = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    if (!focusNewRow.current) return;
    focusNewRow.current = false;
    body.current?.lastElementChild
      ?.querySelector<HTMLElement>("input, select")
      ?.focus();
  }, [value.length]);
  const { columns } = def;
  const hasGroups = columns.some((column) => column.kind === "checks");
  const hasDetail = (entry: Value) => {
    if (!isPlain(entry)) return false;
    const rest = restOf(entry, coveredPaths(entry, columns));
    return Object.keys(withOptional(rest, def.optional)).some(
      (key) => key !== "schemaVersion",
    );
  };
  const anyDetail = value.some(hasDetail);
  const columnCount =
    columns.reduce(
      (sum, column) =>
        sum + (column.kind === "checks" ? (column.options?.length ?? 0) : 1),
      0,
    ) +
    (anyDetail ? 1 : 0) +
    1;
  const rowSpan = hasGroups ? 2 : undefined;
  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setOpen((current) =>
      current === null || current === index
        ? null
        : current > index
          ? current - 1
          : current,
    );
  };
  return (
    <div className="profiles-fields">
      <table className="data-table profiles-table">
        <colgroup>
          {columns.flatMap((column) =>
            column.kind === "checks"
              ? (column.options ?? []).map((option) => (
                  <col
                    key={`${column.label}-${option}`}
                    className="profiles-col-check"
                  />
                ))
              : [<col key={column.label} className={column.col} />],
          )}
          {anyDetail && <col className="profiles-col-action" />}
          <col className="profiles-col-action" />
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) =>
              column.kind === "checks" ? (
                <th
                  key={column.label}
                  className="profiles-check-head"
                  colSpan={column.options?.length}
                >
                  {column.label}
                </th>
              ) : (
                <th key={column.label} rowSpan={rowSpan}>
                  {column.label}
                </th>
              ),
            )}
            {anyDetail && <th rowSpan={rowSpan}>상세</th>}
            <th rowSpan={rowSpan}>빼기</th>
          </tr>
          {hasGroups && (
            <tr>
              {columns.flatMap((column) =>
                column.kind === "checks"
                  ? (column.options ?? []).map((option) => (
                      <th
                        key={`${column.label}-${option}`}
                        className="profiles-check-head"
                      >
                        {OPTION_LABELS[option] ?? option}
                      </th>
                    ))
                  : [],
              )}
            </tr>
          )}
        </thead>
        <tbody ref={body}>
          {value.length === 0 && (
            <tr>
              <td className="muted" colSpan={columnCount}>
                항목이 없습니다.
              </td>
            </tr>
          )}
          {/* JSON.parse가 렌더마다 새 객체를 만들므로, 입력 중 포커스를 지키려면 key는 위치여야 한다. */}
          {value.map((entry, index) => {
            const change = (next: Value) =>
              onChange(value.map((v, i) => (i === index ? next : v)));
            const fallbackName = `${label} ${index + 1}`;
            if (!isPlain(entry))
              return (
                <tr key={index}>
                  <td colSpan={columnCount - 1}>
                    <Nested
                      value={entry}
                      label={fallbackName}
                      disabled={disabled}
                      onChange={change}
                    />
                  </td>
                  <td>
                    <IconButton
                      label={`${fallbackName} 빼기`}
                      disabled={disabled}
                      onClick={() => remove(index)}
                    >
                      <X size={14} aria-hidden />
                    </IconButton>
                  </td>
                </tr>
              );
            const named = entry.id ?? entry.name;
            const rowName =
              typeof named === "string" && named ? named : fallbackName;
            const expanded = open === index;
            return (
              <Fragment key={index}>
                <tr>
                  {columns.map((column) => (
                    <EntityCells
                      key={column.label}
                      entry={entry}
                      rowName={rowName}
                      column={column}
                      disabled={disabled}
                      onEntry={change}
                    />
                  ))}
                  {anyDetail && (
                    <td>
                      {hasDetail(entry) && (
                        // 읽기 전용 프로필에서도 값을 볼 수 있어야 하므로 비활성화하지 않는다.
                        <IconButton
                          label={`${rowName} 상세 ${expanded ? "닫기" : "열기"}`}
                          expanded={expanded}
                          onClick={() => setOpen(expanded ? null : index)}
                        >
                          {expanded ? (
                            <ChevronDown size={14} aria-hidden />
                          ) : (
                            <ChevronRight size={14} aria-hidden />
                          )}
                        </IconButton>
                      )}
                    </td>
                  )}
                  <td>
                    <IconButton
                      label={`${rowName} 빼기`}
                      disabled={disabled}
                      onClick={() => remove(index)}
                    >
                      <X size={14} aria-hidden />
                    </IconButton>
                  </td>
                </tr>
                {expanded && hasDetail(entry) && (
                  <tr className="profiles-row-detail">
                    <td colSpan={columnCount}>
                      <EntityDetail
                        entry={entry}
                        def={def}
                        rowName={rowName}
                        disabled={disabled}
                        onEntry={change}
                        Nested={Nested}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="profiles-table-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={disabled}
          onClick={() => {
            focusNewRow.current = true;
            onChange([...value, structuredClone(blank)]);
          }}
        >
          항목 추가
        </button>
      </div>
    </div>
  );
}

export function PluginTable({
  value,
  onChange,
  disabled = false,
}: {
  value: Dict;
  onChange(value: Dict): void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  // 둘 다 해제해도 저장 전까지 행을 남겨 오조작을 되돌릴 수 있게 한다.
  const order = useRef<string[]>([]);
  const positions = useRef<Record<string, number>>({});
  const enabled = {
    claude: enabledOf(value, "claude"),
    codex: enabledOf(value, "codex"),
  };
  const live = [...enabled.claude, ...enabled.codex].filter(
    (entry): entry is string => typeof entry === "string",
  );
  for (const plugin of live)
    if (!order.current.includes(plugin)) order.current.push(plugin);
  const writable = (provider: "claude" | "codex") => {
    const entry = value[provider];
    return (
      entry === undefined ||
      (isPlain(entry) &&
        (entry.enabled === undefined || Array.isArray(entry.enabled)))
    );
  };
  const toggle = (
    provider: "claude" | "codex",
    plugin: string,
    checked: boolean,
  ) => {
    const list = enabled[provider];
    const slot = `${provider}:${plugin}`;
    if (!checked) positions.current[slot] = list.indexOf(plugin);
    const next = checked
      ? [
          ...list.slice(0, positions.current[slot] ?? list.length),
          plugin,
          ...list.slice(positions.current[slot] ?? list.length),
        ]
      : list.filter((entry) => entry !== plugin);
    onChange(setPath(value, [provider, "enabled"], next));
  };
  const name = draft.trim();
  return (
    <div className="profiles-fields">
      <table className="data-table profiles-table">
        <colgroup>
          <col />
          <col className="profiles-col-check" />
          <col className="profiles-col-check" />
        </colgroup>
        <thead>
          <tr>
            <th>
              플러그인 <span className="count">{order.current.length}</span>
            </th>
            <th className="profiles-check-head">Claude</th>
            <th className="profiles-check-head">Codex</th>
          </tr>
        </thead>
        <tbody>
          {order.current.map((plugin) => (
            <tr key={plugin}>
              <td className="mono">{plugin}</td>
              {(["claude", "codex"] as const).map((provider) => (
                <td key={provider} className="profiles-check-cell">
                  <input
                    type="checkbox"
                    aria-label={`${plugin} ${OPTION_LABELS[provider]}`}
                    disabled={disabled || !writable(provider)}
                    checked={enabled[provider].includes(plugin)}
                    onChange={(event) =>
                      toggle(provider, plugin, event.target.checked)
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="profiles-table-actions">
        <input
          aria-label="추가할 플러그인"
          placeholder="플러그인@마켓플레이스"
          disabled={disabled}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {(["claude", "codex"] as const).map((provider) => (
          <button
            key={provider}
            type="button"
            className="btn ghost"
            disabled={
              disabled ||
              !name ||
              !writable(provider) ||
              enabled[provider].includes(name)
            }
            onClick={() => {
              onChange(
                setPath(value, [provider, "enabled"], [
                  ...enabled[provider],
                  name,
                ]),
              );
              setDraft("");
            }}
          >
            {OPTION_LABELS[provider]}에 추가
          </button>
        ))}
      </div>
    </div>
  );
}
