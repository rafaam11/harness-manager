import Ajv from "ajv";
import claude from "@shared/cli-settings/catalog/claude.json";
import codex from "@shared/cli-settings/catalog/codex.json";
import index from "@shared/cli-settings/catalog/claude-index.json";
import type { ProviderId } from "@shared/provider-types";
import type { SettingDescriptor, JsonValue } from "@shared/cli-settings-types";
type Schema = Record<string, any>;
const roots: Record<ProviderId, Schema> = { claude, codex };
const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true, logger: false });
const catalogs = new Map<ProviderId, SettingDescriptor[]>();
const validators = new WeakMap<object, ReturnType<typeof ajv.compile>>();
const labels: Record<string, string> = { model: "기본 모델", language: "응답 언어", effortLevel: "추론 수준", model_reasoning_effort: "추론 수준", approval_policy: "명령 승인 정책", sandbox_mode: "실행 격리", permissions: "권한 규칙", theme: "화면 테마", personality: "응답 성향", service_tier: "서비스 등급", features: "기능 설정", tui: "터미널 화면", hooks: "자동 실행 hook", model_providers: "모델 제공자" };
export const settingId = (provider: ProviderId, path: string[]) => provider + "/" + path.map(encodeURIComponent).join("/");
export function resolveSchema(provider: ProviderId, value: Schema): Schema {
  if (value.$ref?.startsWith("#/")) {
    let target: any = roots[provider];
    for (const segment of value.$ref.slice(2).split("/")) target = target?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
    return { ...target, ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref")) };
  }
  return value;
}
export function schemaType(provider: ProviderId, input: Schema): string {
  const schema = resolveSchema(provider, input);
  if (typeof schema.type === "string") return schema.type;
  if (schema.enum) return typeof schema.enum.find((v: unknown) => v !== null);
  for (const alt of schema.anyOf ?? schema.oneOf ?? schema.allOf ?? []) { const type = schemaType(provider, alt); if (type !== "null" && type !== "unknown") return type; }
  return "unknown";
}
function uiSchema(provider: ProviderId, input: Schema, depth = 0): Schema {
  if (depth > 6 || !input || typeof input !== "object") return input;
  const schema = resolveSchema(provider, input), result = { ...schema };
  for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(schema[key])) result[key] = schema[key].map((s: Schema) => uiSchema(provider, s, depth + 1));
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, s]) => [key, uiSchema(provider, s as Schema, depth + 1)]));
  if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) result.items = uiSchema(provider, schema.items, depth + 1);
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") result.additionalProperties = uiSchema(provider, schema.additionalProperties, depth + 1);
  return result;
}
export function readonlyReason(provider: ProviderId, path: string[]) {
  if (path.some(key => /^(?:__proto__|constructor|prototype)$/.test(key))) return "허용하지 않는 키";
  if (path.some(key => /^(?:env|api_key|apiKey|access_token|refresh_token|token|password|secret|headers)$/i.test(key))) return "인증·민감 정보는 CLI에서 관리";
  if ((provider === "codex" ? ["profiles", "profile", "projects"] : ["projects"]).includes(path[0]!)) return "프로젝트·CLI 프로필 설정은 읽기 전용";
  if (["plugins", "enabledPlugins", "extraKnownMarketplaces", "marketplaces", "pluginConfigs", "mcp_servers", "mcpServers"].includes(path[0]!)) return "확장·MCP 전용 화면에서 관리";
  return undefined;
}
export function settingCatalog(provider: ProviderId): SettingDescriptor[] {
  const cached = catalogs.get(provider); if (cached) return cached;
  const result = new Map<string, SettingDescriptor>();
  const add = (path: string[], schema: Schema, meta?: typeof index[number]) => {
    const id = settingId(provider, path), resolved = resolveSchema(provider, schema);
    const category = /model|effort|personality|service_tier/i.test(path[0]!) ? "모델·응답" : /permission|approval|sandbox|trust/i.test(path[0]!) ? "권한·격리" : /plugin|mcp|hook|skill|agent/i.test(path[0]!) ? "확장·자동화" : /tui|theme|notif|terminal|language/i.test(path[0]!) ? "화면·알림" : "기타 설정";
    result.set(id, { id, provider, path, title: labels[path.join(".")] ?? labels[path[0]!] ?? path.join("."), category,
      description: meta?.description ?? resolved.description ?? "", type: schemaType(provider, resolved), schema: uiSchema(provider, resolved),
      defaultDescription: meta?.defaultDescription ?? (resolved.default === undefined ? "미지정 · CLI 기본값" : JSON.stringify(resolved.default)),
      source: provider === "claude" ? "https://code.claude.com/docs/en/settings-reference" : "https://developers.openai.com/codex/config-schema.json",
      minimumVersion: meta?.minimumVersion ?? undefined, storage: meta?.scope === "Global config" ? "global" : meta?.scope === "Managed" ? "managed" : "user", managed: false,
      readonly: readonlyReason(provider, path) ?? (meta?.scope === "Managed" ? "조직 정책에서만 지정 가능" : meta?.scope === "Global config" ? "Claude 전역 상태 파일은 읽기 전용" : undefined),
    });
  };
  const walk = (properties: Schema, prefix: string[] = [], depth = 0) => {
    for (const [key, value] of Object.entries(properties)) {
      const schema = value as Schema, path = [...prefix, key]; add(path, schema);
      const resolved = resolveSchema(provider, schema);
      if (depth < 3 && resolved.properties) walk(resolved.properties, path, depth + 1);
    }
  };
  walk(roots[provider].properties ?? {});
  if (provider === "claude") for (const meta of index) {
    const path = meta.key.split("."), known = result.get(settingId(provider, path));
    const typeText = meta.type.toLowerCase();
    const type = /array|list of/.test(typeText) ? "array" : /object|mapping/.test(typeText) ? "object" : /bool/.test(typeText) ? "boolean" : /integer/.test(typeText) ? "integer" : /number|seconds|milliseconds/.test(typeText) ? "number" : /string/.test(typeText) ? "string" : "unknown";
    add(path, known?.schema ?? (type === "unknown" ? {} : { type }), meta);
  }
  const catalog = [...result.values()]; catalogs.set(provider, catalog); return catalog;
}
export function validateValue(descriptor: SettingDescriptor, value: JsonValue) {
  const root = roots[descriptor.provider];
  const schema = { ...descriptor.schema, definitions: root.definitions, $defs: root.$defs };
  let validate = validators.get(descriptor.schema);
  if (!validate) { validate = ajv.compile(schema); validators.set(descriptor.schema, validate); }
  if (!validate(value)) throw new Error("설정 형식을 확인하세요: " + ajv.errorsText(validate.errors));
}
