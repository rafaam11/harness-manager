import type { ComponentDefinition, WorkbenchDefinition } from "@shared/workbench-types";
import { exactObject, nonEmptyString, RequestError } from "../../ipc-validation.js";
export const DEFINITION_FILE = "home/components.v2.json";
export function safeRelative(value: string): boolean {
  return value.length < 240 && value.split("/").every(p => /^[\w. -]+$/.test(p) && p !== "." && p !== ".." && !["__proto__", "constructor", "prototype"].includes(p) && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p));
}
export function validateComponent(value: unknown): ComponentDefinition {
  const v = exactObject(value, ["id", "name", "description", "kind", "source", "targets", "files"], "component");
  if (typeof v.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(v.id) || !safeRelative(v.id)) throw new RequestError(422, "항목 ID는 영문 소문자·숫자·하이픈으로 입력하세요 (예약 이름 제외)");
  if (v.kind !== "skill" && v.kind !== "instruction") throw new RequestError(422, "일반 스킬·지침만 공통 정의로 관리합니다");
  nonEmptyString(v.name, "name");
  if ((v.name as string).length > 120 || typeof v.description !== "string" || v.description.length > 2000) throw new RequestError(422, "이름·설명 길이를 확인하세요");
  if (!Array.isArray(v.targets) || !v.targets.length || new Set(v.targets).size !== v.targets.length || v.targets.some(p => p !== "claude" && p !== "codex")) throw new RequestError(422, "적용 대상을 선택하세요");
  const source = exactObject(v.source, ["kind", "repository", "directory", "revision"], "source");
  if (source.kind !== "profile" && source.kind !== "github") throw new RequestError(422, "지원하지 않는 출처입니다");
  if (source.kind === "github" && (typeof source.repository !== "string" || !/^[\w-]+\/[\w.-]+$/.test(source.repository) || typeof source.revision !== "string" || !/^[a-f0-9]{40}$/.test(source.revision))) throw new RequestError(422, "GitHub 저장소와 정확한 커밋이 필요합니다");
  if (source.directory !== undefined && (typeof source.directory !== "string" || (source.directory !== "" && !safeRelative(source.directory)))) throw new RequestError(422, "잘못된 소스 폴더입니다");
  if (!v.files || typeof v.files !== "object" || Array.isArray(v.files)) throw new RequestError(422, "항목 파일이 필요합니다");
  const entries = Object.entries(v.files);
  if (!entries.length || entries.length > 100 || JSON.stringify(v.files).length > 2 * 1024 * 1024 || entries.some(([p, t]) => !safeRelative(p) || typeof t !== "string" || t.includes("\0"))) throw new RequestError(422, "파일 경로·크기·내용을 확인하세요");
  if (new Set(entries.map(([p]) => p.toLowerCase())).size !== entries.length) throw new RequestError(422, "대소문자만 다른 파일은 지원하지 않습니다");
  if (v.kind === "skill" && !("SKILL.md" in v.files)) throw new RequestError(422, "SKILL.md가 필요합니다");
  if (v.kind === "instruction" && (entries.length !== 1 || !("instructions.md" in v.files))) throw new RequestError(422, "지침은 instructions.md 한 파일로 관리합니다");
  return v as unknown as ComponentDefinition;
}
export function parseDefinition(text: string | null): WorkbenchDefinition {
  if (text === null) return { schemaVersion: 2, automatic: false, components: [] };
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new RequestError(422, "구성요소 정의는 2 MiB 이하여야 합니다");
  const v = exactObject(JSON.parse(text), ["schemaVersion", "automatic", "components"], "workbench");
  if (v.schemaVersion !== 2 || typeof v.automatic !== "boolean" || !Array.isArray(v.components) || v.components.length > 500) throw new RequestError(422, "지원하지 않는 구성요소 정의입니다");
  const components = v.components.map(validateComponent);
  if (new Set(components.map(c => c.id)).size !== components.length) throw new RequestError(422, "구성요소 ID가 중복됩니다");
  return { schemaVersion: 2, automatic: v.automatic, components };
}
export function ordinaryFiles(component: ComponentDefinition): boolean {
  return Object.keys(component.files).every(p => /\.(md|txt)$/i.test(p));
}
