import { useState } from "react";
import { Toolbar } from "./ui";

type Value =
  | null
  | string
  | number
  | boolean
  | Value[]
  | { [key: string]: Value };
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
const LABELS: Record<string, string> = {
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
  model: "모델",
  language: "언어",
  effortLevel: "추론 수준",
  claudeSettings: "Claude 관리 키",
  codexConfig: "Codex 관리 키",
  gitconfig: "Git 관리 키",
};

/** 구조화된 입력만 프로필에 저장한다. 실행은 별도 설치 미리보기와 main 검증을 거친다. */
export default function ProfileFields({
  value,
  onChange,
  label = "설정",
  field = "",
  disabled = false,
}: {
  value: Value;
  onChange(value: Value): void;
  label?: string;
  field?: string;
  disabled?: boolean;
}) {
  const [key, setKey] = useState("");
  const [kind, setKind] = useState("string");
  const selections =
    field === "profiles"
      ? ["core", "dev", "full"]
      : ["targets", "providers"].includes(field)
        ? ["claude", "codex"]
        : null;
  if (Array.isArray(value) && selections)
    return (
      <fieldset className="profiles-fields" disabled={disabled}>
        <legend>{label}</legend>
        <Toolbar>
          {selections.map((option) => (
            <label className="check" key={option}>
              <input
                type="checkbox"
                checked={value.includes(option)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, option]
                      : value.filter((v) => v !== option),
                  )
                }
              />
              {option}
            </label>
          ))}
        </Toolbar>
      </fieldset>
    );
  const editableKeys =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !Object.hasOwn(value, "schemaVersion") &&
    !EXAMPLES[field] &&
    !["install", "verify", "source", "claude", "codex"].includes(field);
  if (Array.isArray(value))
    return (
      <fieldset className="profiles-fields" disabled={disabled}>
        <legend>{label}</legend>
        {value.map((entry, index) => (
          <details
            key={index}
            className="profiles-entry"
            open={!EXAMPLES[field]}
          >
            <summary>
              {entry && typeof entry === "object" && !Array.isArray(entry)
                ? String(entry.name ?? entry.id ?? `${label} ${index + 1}`)
                : `${label} ${index + 1}`}
            </summary>
            <ProfileFields
              value={entry}
              onChange={(next) =>
                onChange(value.map((v, i) => (i === index ? next : v)))
              }
              label={`${label} ${index + 1}`}
              field={field}
            />
            <button
              className="btn ghost"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              항목 빼기
            </button>
          </details>
        ))}
        <button
          className="btn ghost"
          onClick={() =>
            onChange([...value, structuredClone(EXAMPLES[field] ?? "")])
          }
        >
          항목 추가
        </button>
      </fieldset>
    );
  if (value !== null && typeof value === "object")
    return (
      <fieldset className="profiles-fields" disabled={disabled}>
        <legend>{label}</legend>
        {Object.entries(value)
          .filter(([name]) => name !== "schemaVersion")
          .map(([name, entry]) => (
            <div key={name} className="profiles-field-row">
              <ProfileFields
                field={name}
                label={LABELS[name] ?? name}
                value={entry}
                onChange={(next) => onChange({ ...value, [name]: next })}
              />
              {editableKeys && (
                <button
                  className="btn ghost"
                  title={`${name} 관리 해제`}
                  onClick={() =>
                    onChange(
                      Object.fromEntries(
                        Object.entries(value).filter(([k]) => k !== name),
                      ),
                    )
                  }
                >
                  키 빼기
                </button>
              )}
            </div>
          ))}
        {editableKeys && (
          <Toolbar>
            <input
              aria-label={`${label} 새 키`}
              placeholder="추가할 설정 키"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <select
              aria-label="값 종류"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="string">문자</option>
              <option value="boolean">참/거짓</option>
              <option value="number">숫자</option>
              <option value="array">목록</option>
              <option value="object">객체</option>
            </select>
            <button
              className="btn ghost"
              disabled={
                !key.trim() ||
                Object.hasOwn(value, key.trim()) ||
                ["__proto__", "constructor", "prototype"].includes(key.trim())
              }
              onClick={() => {
                onChange({
                  ...value,
                  [key.trim()]:
                    kind === "boolean"
                      ? false
                      : kind === "number"
                        ? 0
                        : kind === "array"
                          ? []
                          : kind === "object"
                            ? {}
                            : "",
                });
                setKey("");
              }}
            >
              키 추가
            </button>
          </Toolbar>
        )}
      </fieldset>
    );
  if (typeof value === "boolean")
    return (
      <label className="check">
        <input
          type="checkbox"
          disabled={disabled}
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  return (
    <label className="profiles-input">
      {label}
      <input
        disabled={disabled}
        type={
          typeof value === "number"
            ? "number"
            : /token|password|secret|api.?key/i.test(field) &&
                !String(value).startsWith("${")
              ? "password"
              : "text"
        }
        value={value ?? ""}
        onChange={(e) =>
          onChange(
            typeof value === "number" ? Number(e.target.value) : e.target.value,
          )
        }
      />
    </label>
  );
}
