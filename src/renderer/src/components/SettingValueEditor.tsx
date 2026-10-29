import { useState } from "react";
import type { JsonValue } from "@shared/cli-settings-types";
type Schema = Record<string, any>;
export const initialValue = (schema: Schema, type = schema.type): JsonValue => schema.default ?? schema.enum?.find((v: unknown) => v !== null) ?? ((schema.anyOf ?? schema.oneOf ?? schema.allOf)?.length ? initialValue((schema.anyOf ?? schema.oneOf ?? schema.allOf).find((s: Schema) => s.type !== "null") ?? {}, type) : type === "object" ? {} : type === "array" ? [] : type === "boolean" ? false : type === "integer" || type === "number" ? 0 : "");

export function SettingValueEditor({ value, schema, onChange, onInvalid, label = "설정값", depth = 0 }: {
  value: JsonValue; schema: Schema; onChange(value: JsonValue): void; onInvalid(message: string): void; label?: string; depth?: number;
}) {
  const [raw, setRaw] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [newKey, setNewKey] = useState("");
  const alternatives = schema.anyOf ?? schema.oneOf ?? schema.allOf;
  const effective: Schema = alternatives?.find((s: Schema) => s.enum?.includes(value) || s.type === (Array.isArray(value) ? "array" : typeof value)) ?? alternatives?.find((s: Schema) => s.type !== "null") ?? schema;
  const enumeration = effective.enum ?? schema.enum;
  if (raw || depth >= 5 || value === null) return <div className="cli-json-editor"><label>{label}<textarea aria-label={label} spellCheck={false} value={text} onChange={event => { const next = event.target.value; setText(next); try { onChange(JSON.parse(next)); onInvalid(""); } catch { onInvalid("JSON 형식을 확인하세요."); } }} /></label>{depth < 5 && <button type="button" className="btn ghost" onClick={() => { try { onChange(JSON.parse(text)); onInvalid(""); setRaw(false); } catch { onInvalid("JSON 형식을 확인하세요."); } }}>입력 폼 보기</button>}</div>;
  if (enumeration && enumeration.every((v: unknown) => typeof v !== "object")) return <select aria-label={label} value={JSON.stringify(value)} onChange={e => { onChange(JSON.parse(e.target.value)); onInvalid(""); }}>{enumeration.map((v: JsonValue) => <option key={JSON.stringify(v)} value={JSON.stringify(v)}>{String(v)}</option>)}</select>;
  if (typeof value === "boolean") return <select aria-label={label} value={String(value)} onChange={e => onChange(e.target.value === "true")}><option value="true">켜짐</option><option value="false">꺼짐</option></select>;
  if (typeof value === "number") return <input aria-label={label} type="number" min={effective.minimum} max={effective.maximum} step={effective.type === "integer" ? 1 : "any"} value={value} onChange={e => { const number = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(number)) { onChange(number); onInvalid(""); } else onInvalid("숫자를 입력하세요."); }} />;
  if (typeof value === "string") return <textarea className="cli-string" aria-label={label} value={value} rows={value.includes("\n") ? 4 : 2} onChange={e => onChange(e.target.value)} spellCheck={false} />;
  const array = Array.isArray(value);
  const entries = Object.entries(value);
  const update = (key: string, next: JsonValue) => onChange(array ? value.map((v, index) => String(index) === key ? next : v) : { ...value, [key]: next });
  const remove = (key: string) => { if (array) onChange(value.filter((_, index) => String(index) !== key)); else { const next = { ...value }; delete next[key]; onChange(next); } };
  const properties = effective.properties ?? {};
  return <div className="cli-object"><div className="pc-inline"><span className="muted">{array ? "목록" : "객체"} · {entries.length}개</span><button type="button" className="btn ghost" onClick={() => { setText(JSON.stringify(value, null, 2)); setRaw(true); }}>JSON으로 편집</button></div>
    {entries.map(([key, item]) => <div className="cli-value-row" key={key}><div className="pc-inline"><strong>{array ? `${Number(key) + 1}번째 항목` : key}</strong><button type="button" className="btn ghost" aria-label={`${label} ${key} 제거`} onClick={() => remove(key)}>제거</button></div><SettingValueEditor value={item} schema={array ? effective.items ?? {} : properties[key] ?? effective.additionalProperties ?? {}} label={`${label}.${key}`} depth={depth + 1} onChange={next => update(key, next)} onInvalid={onInvalid} /></div>)}
    <div className="pc-inline">{!array && <input aria-label={`${label} 새 키`} placeholder="추가할 키" list={`keys-${label}`} value={newKey} onChange={e => setNewKey(e.target.value)} />}{!array && <datalist id={`keys-${label}`}>{Object.keys(properties).filter(key => !Object.hasOwn(value, key)).map(key => <option key={key} value={key} />)}</datalist>}
      <button type="button" className="btn ghost" disabled={!array && (!newKey || Object.hasOwn(value, newKey) || ["__proto__", "constructor", "prototype"].includes(newKey) || effective.additionalProperties === false && !properties[newKey])} onClick={() => { if (array) onChange([...value, initialValue(effective.items ?? {})]); else { onChange({ ...value, [newKey]: initialValue(properties[newKey] ?? {}) }); setNewKey(""); } }}>항목 추가</button>
    </div>
  </div>;
}
