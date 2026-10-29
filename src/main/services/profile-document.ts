import { parseCliSettings, CLI_SETTINGS_FILE } from "./cli-settings/definition.js";
import { parseDefinition } from "./workbench/definition.js";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  PROFILE_FILES,
  PERSONAL_FILES,
  type ProfileBundle,
  type ProfileDocument,
  type SetupProfile,
} from "@shared/setup-profile-types";
import { MANIFEST_FILES } from "@shared/manifest-types";
import { validateManifestValue } from "./manifest/validate.js";
import { writeFileChecked } from "./capture/capture.js";
import { RequestError } from "../ipc-validation.js";
import { sha256 } from "../lib/safe-write.js";

export const stringify = (value: unknown) =>
  JSON.stringify(value, null, 2) + "\n";
export const documentFingerprint = (doc: ProfileDocument) =>
  sha256(stringify(doc));
function fail(message: string): never {
  throw new RequestError(422, message);
}

// 프로필 폴더를 연결해도 파일과 상위 폴더의 링크를 따라 밖으로 쓰지 않는다.
export async function profileFile(
  root: string,
  relative: string,
): Promise<string> {
  let current = path.resolve(root);
  const rootStat = await fs
    .lstat(current)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (rootStat?.isSymbolicLink()) fail("프로필 루트 링크는 지원하지 않습니다");
  for (const part of relative.split("/")) {
    if (
      !part ||
      part === "." ||
      part === ".." ||
      part.includes("\\") ||
      part.includes(":")
    )
      fail("잘못된 프로필 경로입니다");
    current = path.join(current, part);
    const stat = await fs
      .lstat(current)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (stat?.isSymbolicLink())
      fail(`프로필 링크는 지원하지 않습니다: ${relative}`);
  }
  return current;
}
export async function readProfileFile(
  root: string,
  relative: string,
  limit = 2 * 1024 * 1024,
): Promise<string | null> {
  const file = await profileFile(root, relative);
  const stat = await fs.stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > limit)
    fail(`파일 크기 또는 형식을 확인하세요: ${relative}`);
  return fs.readFile(file, "utf8");
}
export async function writeProfileFile(
  root: string,
  relative: string,
  text: string,
): Promise<void> {
  const file = await profileFile(root, relative);
  const before = await readProfileFile(root, relative);
  if (before !== text) await writeFileChecked(file, before, text);
}

export async function ensurePrivateTerms(localDir: string): Promise<void> {
  if ((await readProfileFile(localDir, "private-terms.json")) === null)
    await writeProfileFile(
      localDir,
      "private-terms.json",
      stringify({ terms: [] }),
    );
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((s) => typeof s === "string" && s.length <= 200)
  );
}
function files(
  value: unknown,
  allowed: readonly string[],
): asserts value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("프로필 파일 목록이 필요합니다");
  for (const [key, text] of Object.entries(value)) {
    if (
      !allowed.includes(key) ||
      typeof text !== "string" ||
      Buffer.byteLength(text) > 2 * 1024 * 1024
    )
      fail(`허용하지 않는 프로필 파일: ${key}`);
    if (key.endsWith(".json")) {
      try {
        const parsed = JSON.parse(text, (name, value) => {
          if (["__proto__", "constructor", "prototype"].includes(name))
            fail("허용하지 않는 설정 키입니다");
          return value;
        });
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          fail("설정은 객체여야 합니다");
      } catch {
        fail(`JSON 형식을 확인하세요: ${key}`);
      }
    }
    if (key.endsWith(".toml")) {
      try {
        parseToml(text);
      } catch {
        fail(`TOML 형식을 확인하세요: ${key}`);
      }
    }
  }
}
export function validateDocument(
  value: unknown,
): asserts value is ProfileDocument {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("프로필 형식을 확인하세요");
  const doc = value as ProfileDocument;
  if (
    Object.keys(doc).some(
      (key) => !["files", "personal", "portable", "privateTerms"].includes(key),
    )
  )
    fail("알 수 없는 프로필 속성입니다");
  files(doc.files, PROFILE_FILES);
  files(doc.personal, PERSONAL_FILES);
  if (
    !strings(doc.privateTerms) ||
    doc.privateTerms.length > 500 ||
    !strings(doc.portable) ||
    doc.portable.some(
      (key) => !PERSONAL_FILES.includes(key as (typeof PERSONAL_FILES)[number]),
    )
  )
    fail("개인 설정 선택 또는 비공개 낱말 형식을 확인하세요");
  for (const name of MANIFEST_FILES) {
    const report = validateManifestValue(
      name,
      JSON.parse(doc.files[`manifest/${name}.json`] ?? "null"),
    );
    if (!report.ok) fail(report.errors.join(" · "));
  }
  if (doc.files["home/components.v2.json"]) parseDefinition(doc.files["home/components.v2.json"]);
  if (doc.files[CLI_SETTINGS_FILE]) parseCliSettings(doc.files[CLI_SETTINGS_FILE]);
  if (doc.personal["cli-settings.local.json"]) {
    if (!doc.files[CLI_SETTINGS_FILE]) fail("PC 전용 CLI 설정에는 v3 공통 정의가 필요합니다");
    parseCliSettings(doc.personal["cli-settings.local.json"]);
  }
  const managed = JSON.parse(doc.files["home/managed-keys.json"] ?? "{}");
  if (
    !strings(managed.claudeSettings) ||
    !strings(managed.codexConfig) ||
    !strings(managed.gitconfig ?? [])
  )
    fail("관리 키 목록을 확인하세요");
  for (const key of [
    ...managed.claudeSettings,
    ...managed.codexConfig,
    ...(managed.gitconfig ?? []),
  ]) {
    if (
      key
        .split(".")
        .some((part: string) =>
          ["__proto__", "constructor", "prototype"].includes(part),
        )
    )
      fail("허용하지 않는 관리 키입니다");
  }
}
export async function readDocument(
  profile: SetupProfile,
): Promise<ProfileDocument> {
  const doc: ProfileDocument = {
    files: {},
    personal: {},
    portable: [],
    privateTerms: [],
  };
  for (const file of PROFILE_FILES) {
    const text = await readProfileFile(profile.root, file);
    if (text !== null) doc.files[file] = text;
  }
  for (const file of PERSONAL_FILES) {
    const text = await readProfileFile(profile.localDir, file);
    if (text !== null)
      doc.personal[file] =
        file.endsWith(".json") && !text.trim() ? "{}\n" : text;
  }
  const terms = JSON.parse(
    (await readProfileFile(profile.localDir, "private-terms.json")) ??
      '{"terms":[]}',
  );
  if (!strings(terms.terms))
    fail(
      "비공개 낱말 목록 형식을 확인하세요. 프로필 화면에서 다시 저장하세요.",
    );
  doc.privateTerms = terms.terms;
  const options = JSON.parse(
    (await readProfileFile(profile.localDir, "portability.json")) ??
      '{"portable":[]}',
  );
  doc.portable = options.portable;
  validateDocument(doc);
  return doc;
}
export async function writeDocument(
  profile: SetupProfile,
  doc: ProfileDocument,
): Promise<void> {
  validateDocument(doc);
  for (const file of PROFILE_FILES) {
    if (["home/components.v2.json", CLI_SETTINGS_FILE].includes(file) && !(file in doc.files) && await readProfileFile(profile.root, file) !== null) fail("v4 구성요소 정의를 제거할 수 없습니다. 백업 복원으로 이전하세요.");

    if (
      !(file in doc.files) &&
      (await readProfileFile(profile.root, file)) !== null
    )
      await writeProfileFile(
        profile.root,
        file,
        file.endsWith(".json") ? "{}\n" : "",
      );
  }
  for (const [file, text] of Object.entries(doc.files))
    await writeProfileFile(profile.root, file, text);
  for (const [file, text] of Object.entries(doc.personal))
    await writeProfileFile(profile.localDir, file, text);
  await writeProfileFile(
    profile.localDir,
    "private-terms.json",
    stringify({ terms: doc.privateTerms }),
  );
  await writeProfileFile(
    profile.localDir,
    "portability.json",
    stringify({ portable: doc.portable }),
  );
}

export function transferProblem(text: string): string | null {
  if (
    /-----BEGIN .*PRIVATE KEY-----|\b(?:gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|sk-[\w-]{20,})|\bBearer\s+[\w.-]+/i.test(
      text,
    ) ||
    /["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*["']?(?!\$\{|["']?\s*[,}\n])[^\s"',}]+/i.test(
      text,
    )
  )
    return "인증 정보가 포함될 수 있습니다";
  if (
    /(?:^|[^\w/])[A-Za-z]:[\\/]|\\\\[^\\]+\\|(?:^|[\s"'=])\/(?:home|Users|mnt|media)\//m.test(
      text,
    )
  )
    return "PC 고유 절대경로가 포함되어 있습니다";
  return null;
}
export function bundleProfile(
  name: string,
  doc: ProfileDocument,
): { bundle: ProfileBundle; notes: string[] } {
  validateDocument(doc);
  const personal: Record<string, string> = {};
  const notes: string[] = [];
  for (const [file, text] of Object.entries(doc.files)) {
    const issue = transferProblem(text);
    if (issue)
      fail(
        `${file}: ${issue}. 프로필에서 자리표시 또는 로컬 설정으로 바꾸세요.`,
      );
  }
  for (const [file, text] of Object.entries(doc.personal)) {
    const issue = transferProblem(text);
    if (!doc.portable.includes(file) || issue)
      notes.push(`${file}: ${issue ?? "이동 대상으로 선택하지 않음"}`);
    else personal[file] = text;
  }
  const bundle: ProfileBundle = {
      format: "harness-manager-profile",
      version: doc.files[CLI_SETTINGS_FILE] ? 3 : doc.files["home/components.v2.json"] ? 2 : 1,
      name,
      files: doc.files,
      personal,
  };
  if (Buffer.byteLength(stringify(bundle)) > 16 * 1024 * 1024) fail("내보낼 프로필은 16 MiB 이하여야 합니다");
  return { bundle, notes };
}
export function parseBundle(text: string): ProfileBundle {
  if (Buffer.byteLength(text) > 16 * 1024 * 1024)
    fail("프로필 파일은 16 MiB 이하여야 합니다");
  const value = JSON.parse(text) as ProfileBundle;
  if (
    !value ||
    value.format !== "harness-manager-profile" ||
    ![1, 2, 3].includes(value.version) ||
    (value.version === 3) !== Boolean(value.files?.[CLI_SETTINGS_FILE]) ||
    (value.version !== 3 && (value.version === 2) !== Boolean(value.files?.["home/components.v2.json"])) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 80 ||
    Object.keys(value).some(
      (key) =>
        !["format", "version", "name", "files", "personal"].includes(key),
    )
  )
    fail("지원하지 않는 프로필 형식입니다");
  const doc = {
    files: value.files,
    personal: value.personal,
    portable: Object.keys(value.personal ?? {}),
    privateTerms: [],
  };
  validateDocument(doc);
  for (const [file, content] of Object.entries({
    ...value.files,
    ...value.personal,
  })) {
    const issue = transferProblem(content);
    if (issue) fail(`${file}: ${issue}`);
  }
  return value;
}
