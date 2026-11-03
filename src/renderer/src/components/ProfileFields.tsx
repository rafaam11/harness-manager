import {
  PACKAGE_SOURCES,
  TOOL_INSTALL_KINDS,
} from "@shared/manifest-types";
import {
  EntityTable,
  KeyValueTable,
  LABELS,
  ListTable,
  LOCKED_KEYS,
  PluginTable,
  ScalarInput,
  SelectionChecks,
  isPlain,
  isPluginRoot,
  isStringArray,
  mergeRest,
  pluginPaths,
  rebuild,
  restOf,
  setPath,
  type Column,
  type Dict,
  type EntityDef,
  type FieldProps,
  type Value,
} from "./ProfileTables";

const EXAMPLES: Record<string, Value> = {
  packages: {
    id: "new-package",
    source: "winget",
    name: "Publisher.Package",
    profiles: ["core", "dev", "full"],
    bin: "command",
  },
  tools: {
    id: "new-tool",
    name: "새 도구",
    profiles: ["core", "dev", "full"],
    install: { kind: "manual", ref: "" },
    verify: { command: "command", args: ["--version"] },
  },
  marketplaces: {
    name: "marketplace",
    source: { kind: "github", repo: "owner/repo" },
    providers: ["claude", "codex"],
  },
  servers: {
    name: "new-server",
    command: "npx",
    args: ["-y", "package"],
    env: {},
    targets: ["claude", "codex"],
    profiles: ["core", "dev", "full"],
  },
  external: {
    id: "skill",
    source: "owner/repo",
    profiles: ["core", "dev", "full"],
  },
};

const SELECTIONS: Record<string, readonly string[]> = {
  profiles: ["core", "dev", "full"],
  targets: ["claude", "codex"],
  providers: ["claude", "codex"],
};

/** 소스 종류마다 필요한 키가 다르다. 다른 종류의 키를 남기면 manifest 검증에서 걸린다. */
function setSourceKind(entry: Dict, kind: string): Dict {
  const source = isPlain(entry.source) ? entry.source : {};
  const { repo, url, ...others } = source;
  const next: Dict = { ...others, kind };
  if (kind === "github") next.repo = repo ?? "";
  if (kind === "git") next.url = url ?? "";
  return { ...entry, source: next };
}

const PROFILE_COLUMN: Column = {
  label: "설치 범위",
  kind: "checks",
  path: ["profiles"],
  options: SELECTIONS.profiles,
};

const ENTITY_TABLES: Record<string, EntityDef> = {
  packages: {
    columns: [
      { label: "식별자", kind: "text", path: ["id"], col: "profiles-col-short" },
      {
        label: "소스",
        kind: "select",
        path: ["source"],
        options: PACKAGE_SOURCES,
        col: "profiles-col-select",
      },
      { label: "패키지 이름", kind: "text", path: ["name"] },
      {
        label: "실행 파일",
        kind: "text",
        path: ["bin"],
        optional: true,
        col: "profiles-col-short",
      },
      PROFILE_COLUMN,
    ],
    optional: ["description"],
  },
  tools: {
    columns: [
      { label: "식별자", kind: "text", path: ["id"], col: "profiles-col-short" },
      { label: "이름", kind: "text", path: ["name"], col: "profiles-col-short" },
      {
        label: "설치 방식",
        kind: "select",
        path: ["install", "kind"],
        options: TOOL_INSTALL_KINDS,
        col: "profiles-col-select-wide",
      },
      { label: "설치 주소", kind: "text", path: ["install", "ref"] },
      PROFILE_COLUMN,
    ],
    optional: ["version", "notes"],
  },
  marketplaces: {
    columns: [
      { label: "이름", kind: "text", path: ["name"] },
      {
        label: "소스 종류",
        kind: "select",
        path: ["source", "kind"],
        options: ["github", "git", "self"],
        apply: setSourceKind,
        col: "profiles-col-select",
      },
      { label: "저장소 또는 주소", kind: "location", path: ["source"] },
      {
        label: "대상",
        kind: "checks",
        path: ["providers"],
        options: SELECTIONS.providers,
      },
    ],
  },
  servers: {
    columns: [
      { label: "이름", kind: "text", path: ["name"], col: "profiles-col-short" },
      { label: "명령", kind: "text", path: ["command"] },
      {
        label: "대상",
        kind: "checks",
        path: ["targets"],
        options: SELECTIONS.targets,
      },
      PROFILE_COLUMN,
    ],
  },
  external: {
    columns: [
      { label: "식별자", kind: "text", path: ["id"] },
      { label: "소스", kind: "text", path: ["source"] },
      PROFILE_COLUMN,
    ],
  },
};

/** 표가 정의되지 않은 객체 배열은 모든 행에 공통인 값을 열로 삼는다. */
function dynamicTable(rows: Dict[]): { def: EntityDef; blank: Dict } {
  const first = rows[0];
  const isSimple = (entry: Value | undefined) =>
    typeof entry === "string" ||
    typeof entry === "number" ||
    typeof entry === "boolean";
  const scalars = Object.keys(first)
    .filter(
      (key) =>
        key !== "schemaVersion" &&
        !SELECTIONS[key] &&
        rows.every((row) => isSimple(row[key])),
    )
    .slice(0, 5);
  const checks = Object.keys(SELECTIONS).filter((key) =>
    rows.every((row) => isStringArray(row[key])),
  );
  const blank: Dict = {};
  for (const key of scalars)
    blank[key] =
      typeof first[key] === "boolean"
        ? false
        : typeof first[key] === "number"
          ? 0
          : "";
  for (const key of checks) blank[key] = [];
  return {
    def: {
      columns: [
        ...scalars.map(
          (key): Column => ({
            label: LABELS[key] ?? key,
            kind: "text",
            path: [key],
          }),
        ),
        ...checks.map(
          (key): Column => ({
            label: LABELS[key] ?? key,
            kind: "checks",
            path: [key],
            options: SELECTIONS[key],
          }),
        ),
      ],
    },
    blank,
  };
}

function isStructured(key: string, value: Value): boolean {
  if (Array.isArray(value))
    return Boolean(ENTITY_TABLES[key]) || value.some(isPlain);
  if (!isPlain(value)) return false;
  return (
    isPluginRoot(value) ||
    Object.entries(value).some(([name, entry]) => isStructured(name, entry))
  );
}

function ArrayView({
  value,
  onChange,
  label,
  field,
  disabled,
  compact,
  ariaPrefix,
}: {
  value: Value[];
  onChange(value: Value): void;
  label: string;
  field: string;
  disabled: boolean;
  compact: boolean;
  ariaPrefix: string;
}) {
  if (SELECTIONS[field])
    return (
      <SelectionChecks
        value={value}
        onChange={onChange}
        label={label}
        options={SELECTIONS[field]}
        disabled={disabled}
        ariaPrefix={ariaPrefix}
      />
    );
  const known = ENTITY_TABLES[field];
  if (known)
    return (
      <EntityTable
        value={value}
        onChange={onChange}
        def={known}
        label={label}
        blank={EXAMPLES[field] ?? ""}
        disabled={disabled}
        Nested={ProfileFields}
      />
    );
  if (value.length > 0 && value.every(isPlain)) {
    const { def, blank } = dynamicTable(value as Dict[]);
    if (def.columns.length > 0)
      return (
        <EntityTable
          value={value}
          onChange={onChange}
          def={def}
          label={label}
          blank={blank}
          disabled={disabled}
          Nested={ProfileFields}
        />
      );
  }
  return (
    <ListTable
      value={value}
      onChange={onChange}
      label={label}
      field={field}
      blank={EXAMPLES[field] ?? ""}
      disabled={disabled}
      compact={compact}
      ariaPrefix={ariaPrefix}
      Nested={ProfileFields}
    />
  );
}

/** 구조가 있는 값은 제목을 붙여 따로 그리고, 나머지 값은 키-값 표 하나로 묶는다. */
function Sections({
  value,
  onChange,
  label,
  disabled,
  editable,
  flatKeys,
  titled = false,
}: {
  value: Dict;
  onChange(value: Dict): void;
  label: string;
  disabled: boolean;
  editable: boolean;
  flatKeys: boolean;
  titled?: boolean;
}) {
  const entries = Object.entries(value).filter(
    ([key]) => key !== "schemaVersion",
  );
  const structured = entries.filter(([key, entry]) => isStructured(key, entry));
  const simple = entries.filter(([key, entry]) => !isStructured(key, entry));
  const simpleKeys = simple.map(([key]) => key);
  const solo =
    !titled && !editable && structured.length === 1 && simple.length === 0;
  return (
    <div className="profiles-sections">
      {(simple.length > 0 || editable) && (
        <KeyValueTable
          value={Object.fromEntries(simple)}
          onChange={(next) => onChange(rebuild(value, simpleKeys, next))}
          label={label}
          editable={editable}
          flatKeys={flatKeys}
          reservedKeys={structured.map(([key]) => key)}
          disabled={disabled}
          Nested={ProfileFields}
        />
      )}
      {structured.map(([key, entry]) => (
        <section key={key} className="profiles-section">
          {!solo && (
            <div className="profiles-section-head">
              <h3 className="section-label">{LABELS[key] ?? key}</h3>
              {editable && (
                <button
                  type="button"
                  className="btn ghost"
                  title={`${key} 관리 해제`}
                  disabled={disabled}
                  onClick={() =>
                    onChange(
                      Object.fromEntries(
                        Object.entries(value).filter(([name]) => name !== key),
                      ),
                    )
                  }
                >
                  키 빼기
                </button>
              )}
            </div>
          )}
          <ProfileFields
            value={entry}
            field={key}
            label={LABELS[key] ?? key}
            disabled={disabled}
            onChange={(next) => onChange({ ...value, [key]: next })}
          />
        </section>
      ))}
    </div>
  );
}

function ObjectView({
  value,
  onChange,
  label,
  field,
  disabled,
  flatKeys,
  ariaPrefix,
}: {
  value: Dict;
  onChange(value: Value): void;
  label: string;
  field: string;
  disabled: boolean;
  flatKeys: boolean;
  ariaPrefix: string;
}) {
  const editable =
    !Object.hasOwn(value, "schemaVersion") &&
    !ENTITY_TABLES[field] &&
    !LOCKED_KEYS.includes(field);
  // manifest.local.json은 같은 구조가 plugins 아래에 있으므로 파일 이름이 아니라 구조로 판별한다.
  if (isPluginRoot(value)) {
    const paths = pluginPaths(value);
    return (
      <div className="profiles-sections">
        <Sections
          value={restOf(value, paths)}
          onChange={(next) => onChange(mergeRest(value, paths, next))}
          label={label}
          disabled={disabled}
          editable={false}
          flatKeys={flatKeys}
          titled
        />
        <section className="profiles-section">
          <h3 className="section-label">활성 플러그인</h3>
          <PluginTable value={value} onChange={onChange} disabled={disabled} />
        </section>
      </div>
    );
  }
  const visible = Object.entries(value).filter(
    ([key]) => key !== "schemaVersion",
  );
  if (
    !editable &&
    visible.length >= 2 &&
    visible.every(([key, entry]) => isStringArray(entry) && !SELECTIONS[key])
  )
    return (
      <div className="profiles-columns">
        {visible.map(([key, entry]) => (
          <ListTable
            key={key}
            value={entry as Value[]}
            onChange={(next) => onChange(setPath(value, [key], next))}
            label={LABELS[key] ?? key}
            field={key}
            blank=""
            disabled={disabled}
            Nested={ProfileFields}
          />
        ))}
      </div>
    );
  if (visible.some(([key, entry]) => isStructured(key, entry)))
    return (
      <Sections
        value={value}
        onChange={onChange}
        label={label}
        disabled={disabled}
        editable={editable}
        flatKeys={flatKeys}
      />
    );
  return (
    <KeyValueTable
      value={value}
      onChange={onChange}
      label={label}
      editable={editable}
      flatKeys={flatKeys}
      ariaPrefix={ariaPrefix}
      disabled={disabled}
      Nested={ProfileFields}
    />
  );
}

/** 구조화된 입력만 프로필에 저장한다. 실행은 별도 설치 미리보기와 main 검증을 거친다. */
export default function ProfileFields({
  value,
  onChange,
  label = "설정",
  field = "",
  disabled = false,
  flatKeys = false,
  compact = false,
  ariaPrefix = "",
}: FieldProps) {
  if (Array.isArray(value))
    return (
      <ArrayView
        value={value}
        onChange={onChange}
        label={label}
        field={field}
        disabled={disabled}
        compact={compact}
        ariaPrefix={ariaPrefix}
      />
    );
  if (isPlain(value))
    return (
      <ObjectView
        value={value}
        onChange={onChange}
        label={label}
        field={field}
        disabled={disabled}
        flatKeys={flatKeys}
        ariaPrefix={ariaPrefix}
      />
    );
  const named = ariaPrefix ? `${ariaPrefix} ${label}` : label;
  return (
    <div className="profiles-input">
      <span>{label}</span>
      <ScalarInput
        value={value}
        onChange={onChange}
        label={named}
        field={field}
        disabled={disabled}
      />
    </div>
  );
}
