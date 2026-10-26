import fs from "node:fs/promises";
import path from "node:path";
import {
  MANIFEST_FILES,
  PACKAGE_SOURCES,
  PROFILES,
  PROVIDER_TARGETS,
  TOOL_INSTALL_KINDS,
  type ManifestFileName,
  type ManifestFileReport,
} from "@shared/manifest-types";

/**
 * 오류와 경고를 모으는 검사기. 오류는 install이 그 파일을 쓰면 안 되는 문제, 경고는 모르는 키처럼
 * 무시하고 진행해도 되는 것이다(새 레포 + 옛 앱 조합을 깨지 않으려고 모르는 키는 거부하지 않는다).
 */
class Checker {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];

  error(where: string, message: string): void {
    this.errors.push(`${where}: ${message}`);
  }

  record(where: string, value: unknown): Record<string, unknown> | null {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
    this.error(where, "객체여야 합니다");
    return null;
  }

  keys(where: string, value: Record<string, unknown>, required: string[], optional: string[] = []): void {
    for (const key of required) if (!(key in value)) this.error(where, `${key}가 없습니다`);
    for (const key of Object.keys(value)) {
      if (!required.includes(key) && !optional.includes(key)) this.warnings.push(`${where}: 모르는 키 ${key}(무시)`);
    }
  }

  string(where: string, value: unknown, { allowEmpty = false } = {}): value is string {
    if (typeof value === "string" && (allowEmpty || value.length > 0)) return true;
    this.error(where, allowEmpty ? "문자열이어야 합니다" : "비어 있지 않은 문자열이어야 합니다");
    return false;
  }

  optionalString(where: string, value: unknown): void {
    if (value !== undefined) this.string(where, value);
  }

  oneOf<T extends string>(where: string, value: unknown, allowed: readonly T[]): value is T {
    if (allowed.includes(value as T)) return true;
    this.error(where, `${allowed.join(" | ")} 중 하나여야 합니다`);
    return false;
  }

  stringArray(where: string, value: unknown): value is string[] {
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return true;
    this.error(where, "문자열 배열이어야 합니다");
    return false;
  }

  subset<T extends string>(where: string, value: unknown, allowed: readonly T[], { nonEmpty = true } = {}): void {
    if (!this.stringArray(where, value)) return;
    if (nonEmpty && value.length === 0) this.error(where, "하나 이상 필요합니다");
    for (const entry of value) if (!allowed.includes(entry as T)) this.error(where, `${entry}은(는) ${allowed.join(" | ")}가 아닙니다`);
    if (new Set(value).size !== value.length) this.error(where, "중복이 있습니다");
  }

  list(where: string, value: unknown, each: (entry: Record<string, unknown>, at: string) => void): void {
    if (!Array.isArray(value)) {
      this.error(where, "배열이어야 합니다");
      return;
    }
    value.forEach((entry, index) => {
      const at = `${where}[${index}]`;
      const record = this.record(at, entry);
      if (record) each(record, at);
    });
  }

  unique(where: string, values: unknown[]): void {
    const seen = new Set<unknown>();
    for (const value of values) {
      if (seen.has(value)) this.error(where, `중복: ${String(value)}`);
      seen.add(value);
    }
  }
}

/** 공개 레포 파일이므로 개인 경로가 들어가면 오류다. `~`와 `${ENV}`만 허용한다. */
function noAbsolutePath(check: Checker, where: string, value: string): void {
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith("/") || value.startsWith("\\\\")) {
    check.error(where, "절대경로는 쓸 수 없습니다(`~`로 시작하게 쓰세요)");
  }
}

function header(check: Checker, root: Record<string, unknown>, listKey: string, extra: string[] = []): void {
  check.keys("$", root, ["schemaVersion", listKey, ...extra]);
  if (root.schemaVersion !== 1) check.error("$.schemaVersion", "1이어야 합니다");
}

const VALIDATORS: Record<ManifestFileName, (check: Checker, root: Record<string, unknown>) => void> = {
  packages(check, root) {
    header(check, root, "packages");
    check.list("$.packages", root.packages, (entry, at) => {
      check.keys(at, entry, ["id", "source", "name", "profiles"], ["bin", "description"]);
      check.string(`${at}.id`, entry.id);
      check.oneOf(`${at}.source`, entry.source, PACKAGE_SOURCES);
      check.string(`${at}.name`, entry.name);
      check.subset(`${at}.profiles`, entry.profiles, PROFILES);
      check.optionalString(`${at}.bin`, entry.bin);
      check.optionalString(`${at}.description`, entry.description);
    });
    if (Array.isArray(root.packages)) check.unique("$.packages", root.packages.map((entry) => (entry as { id?: unknown })?.id));
  },
  tools(check, root) {
    header(check, root, "tools");
    check.list("$.tools", root.tools, (entry, at) => {
      check.keys(at, entry, ["id", "name", "profiles", "install", "verify"], ["version", "notes"]);
      check.string(`${at}.id`, entry.id);
      check.string(`${at}.name`, entry.name);
      check.subset(`${at}.profiles`, entry.profiles, PROFILES);
      check.optionalString(`${at}.version`, entry.version);
      check.optionalString(`${at}.notes`, entry.notes);
      const install = check.record(`${at}.install`, entry.install);
      if (install) {
        check.keys(`${at}.install`, install, ["kind", "ref"]);
        check.oneOf(`${at}.install.kind`, install.kind, TOOL_INSTALL_KINDS);
        check.string(`${at}.install.ref`, install.ref);
      }
      const verify = check.record(`${at}.verify`, entry.verify);
      if (verify) {
        check.keys(`${at}.verify`, verify, ["command", "args"]);
        check.string(`${at}.verify.command`, verify.command);
        check.stringArray(`${at}.verify.args`, verify.args);
      }
    });
    if (Array.isArray(root.tools)) check.unique("$.tools", root.tools.map((entry) => (entry as { id?: unknown })?.id));
  },
  plugins(check, root) {
    header(check, root, "marketplaces", ["claude", "codex"]);
    const names: unknown[] = [];
    check.list("$.marketplaces", root.marketplaces, (entry, at) => {
      check.keys(at, entry, ["name", "source", "providers"]);
      check.string(`${at}.name`, entry.name);
      names.push(entry.name);
      check.subset(`${at}.providers`, entry.providers, PROVIDER_TARGETS);
      const source = check.record(`${at}.source`, entry.source);
      if (!source) return;
      if (!check.oneOf(`${at}.source.kind`, source.kind, ["self", "github", "git"] as const)) return;
      if (source.kind === "self") check.keys(`${at}.source`, source, ["kind"]);
      if (source.kind === "github") {
        check.keys(`${at}.source`, source, ["kind", "repo"]);
        if (check.string(`${at}.source.repo`, source.repo) && !/^[\w.-]+\/[\w.-]+$/.test(source.repo)) {
          check.error(`${at}.source.repo`, "owner/repo 형식이어야 합니다");
        }
      }
      if (source.kind === "git") {
        check.keys(`${at}.source`, source, ["kind", "url"]);
        if (check.string(`${at}.source.url`, source.url) && !/^https:\/\//.test(source.url)) {
          check.error(`${at}.source.url`, "https URL이어야 합니다");
        }
      }
    });
    check.unique("$.marketplaces", names);
    for (const provider of ["claude", "codex"] as const) {
      const section = check.record(`$.${provider}`, root[provider]);
      if (!section) continue;
      check.keys(`$.${provider}`, section, ["enabled"]);
      if (!check.stringArray(`$.${provider}.enabled`, section.enabled)) continue;
      for (const id of section.enabled) {
        if (!/^[^@\s]+@[^@\s]+$/.test(id)) check.error(`$.${provider}.enabled`, `${id}은(는) 플러그인@마켓플레이스 형식이 아닙니다`);
      }
      check.unique(`$.${provider}.enabled`, section.enabled);
    }
  },
  mcp(check, root) {
    header(check, root, "servers");
    check.list("$.servers", root.servers, (entry, at) => {
      check.keys(at, entry, ["name", "command", "args", "targets", "profiles"], ["env"]);
      check.string(`${at}.name`, entry.name);
      if (check.string(`${at}.command`, entry.command)) noAbsolutePath(check, `${at}.command`, entry.command);
      check.stringArray(`${at}.args`, entry.args);
      check.subset(`${at}.targets`, entry.targets, PROVIDER_TARGETS);
      check.subset(`${at}.profiles`, entry.profiles, PROFILES);
      if (entry.env !== undefined) {
        const env = check.record(`${at}.env`, entry.env);
        if (env) for (const [key, value] of Object.entries(env)) check.string(`${at}.env.${key}`, value, { allowEmpty: true });
      }
    });
    if (Array.isArray(root.servers)) check.unique("$.servers", root.servers.map((entry) => (entry as { name?: unknown })?.name));
  },
  skills(check, root) {
    header(check, root, "external");
    check.list("$.external", root.external, (entry, at) => {
      check.keys(at, entry, ["id", "source", "profiles"]);
      check.string(`${at}.id`, entry.id);
      if (check.string(`${at}.source`, entry.source) && !/^[\w.-]+\/[\w.-]+$/.test(entry.source)) {
        check.error(`${at}.source`, "GitHub owner/repo 형식이어야 합니다");
      }
      check.subset(`${at}.profiles`, entry.profiles, PROFILES);
    });
    if (Array.isArray(root.external)) check.unique("$.external", root.external.map((entry) => (entry as { id?: unknown })?.id));
  },
};

export function manifestRelativePath(name: ManifestFileName): string {
  return `manifest/${name}.json`;
}

export function validateManifestValue(name: ManifestFileName, value: unknown): Omit<ManifestFileReport, "path"> {
  const check = new Checker();
  const root = check.record("$", value);
  if (root) VALIDATORS[name](check, root);
  return { name, ok: check.errors.length === 0, errors: check.errors, warnings: check.warnings };
}

export async function validateManifestFile(repoRoot: string, name: ManifestFileName): Promise<ManifestFileReport> {
  const relative = manifestRelativePath(name);
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(path.join(repoRoot, relative), "utf8"));
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "파일이 없습니다" : `읽지 못함: ${(error as Error).message}`;
    return { name, path: relative, ok: false, errors: [reason], warnings: [] };
  }
  return { path: relative, ...validateManifestValue(name, value) };
}

export async function validateManifest(repoRoot: string): Promise<ManifestFileReport[]> {
  return Promise.all(MANIFEST_FILES.map((name) => validateManifestFile(repoRoot, name)));
}
