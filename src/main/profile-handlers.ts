import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { ApiHandlers, ApiDependencies } from "./api-handlers.js";
import type { ProfileBundle } from "@shared/setup-profile-types";
import { SetupProfileStore } from "./services/setup-profiles.js";
import { ProfileSync } from "./services/profile-sync.js";
import {
  bundleProfile,
  parseBundle,
  stringify,
  readProfileFile,
  writeProfileFile,
} from "./services/profile-document.js";
import { writeFileChecked } from "./services/capture/capture.js";
import { withLock } from "./lib/lock.js";
import {
  RequestError,
  nonEmptyString,
  booleanValue,
  exactObject,
} from "./ipc-validation.js";
import { redactInstallText } from "./services/install/journal.js";
import { refreshWindowsEnvironment } from "./platform-env.js";

type Channels =
  | "profiles:editor"
  | "profiles:preview"
  | "profiles:apply"
  | "profiles:update"
  | "profiles:export-plan"
  | "profiles:export"
  | "profiles:import-plan"
  | "profiles:import"
  | "profiles:terms"
  | "profiles:set-terms"
  | "profiles:github-status"
  | "profiles:github-tools"
  | "profiles:github-login"
  | "profiles:github-connect"
  | "profiles:sync-plan"
  | "profiles:sync"
  | "profiles:cancel";
export function profileHandlers(
  deps: ApiDependencies,
  store: () => Promise<SetupProfileStore>,
): Pick<ApiHandlers, Channels> {
  const transfers = new Map<
    string,
    { bundle: ProfileBundle; id?: string; fingerprint?: string }
  >();
  let sync: ProfileSync | undefined;
  const syncing = async () =>
    (sync ??= new ProfileSync(
      await store(),
      undefined,
      await refreshWindowsEnvironment(process.env),
    ));
  const exclusive = <T>(work: (signal: AbortSignal) => Promise<T>) =>
    deps.install.session.run(work);
  const log = (stream: "stdout" | "stderr" | "info", text: string) =>
    deps.profileLog?.({ stream, text: redactInstallText(text, process.env) });
  const remember = (value: {
    bundle: ProfileBundle;
    id?: string;
    fingerprint?: string;
  }) => {
    if (transfers.size >= 20) transfers.delete(transfers.keys().next().value!);
    const token = randomUUID();
    transfers.set(token, value);
    return token;
  };
  return {
    "profiles:editor": async (id) =>
      (await store()).editor(nonEmptyString(id, "id")),
    "profiles:preview": (id, fingerprint, document) =>
      exclusive(async () =>
        (await store()).preview(
          nonEmptyString(id, "id"),
          nonEmptyString(fingerprint, "fingerprint"),
          document,
        ),
      ),
    "profiles:apply": (id, token) =>
      exclusive(async () =>
        (await store()).apply(
          nonEmptyString(id, "id"),
          nonEmptyString(token, "token"),
        ),
      ),
    "profiles:update": (id, action, name) =>
      exclusive(async () => {
        if (action !== "rename" && action !== "archive" && action !== "restore")
          throw new RequestError(400, "잘못된 프로필 동작입니다");
        return (await store()).update(
          nonEmptyString(id, "id"),
          action,
          name === undefined ? undefined : nonEmptyString(name, "name"),
        );
      }),
    "profiles:terms": async () => {
      const profiles = await store();
      const selected = await profiles.get((await profiles.list()).activeId);
      const raw = await readProfileFile(
        selected.localDir,
        "private-terms.json",
      );
      let parsed;
      try {
        parsed = JSON.parse(raw ?? '{"terms":[]}');
      } catch {
        return {
          id: selected.id,
          terms: [],
          issue:
            "기존 목록이 손상되었습니다. 낱말을 입력하고 저장하면 원본을 백업한 뒤 복구합니다.",
        };
      }
      if (
        !Array.isArray(parsed.terms) ||
        !parsed.terms.every((term: unknown) => typeof term === "string")
      )
        return {
          id: selected.id,
          terms: [],
          issue:
            "기존 목록 형식이 잘못되었습니다. 낱말 목록을 다시 저장하세요.",
        };
      return { id: selected.id, terms: parsed.terms };
    },
    "profiles:set-terms": (id, terms) =>
      exclusive(async () => {
        if (
          !Array.isArray(terms) ||
          terms.length > 500 ||
          !terms.every((v) => typeof v === "string" && v.length <= 200)
        )
          throw new RequestError(400, "비공개 낱말 목록을 확인하세요");
        const selected = await (await store()).get(nonEmptyString(id, "id"));
        await withLock(() =>
          writeProfileFile(
            selected.localDir,
            "private-terms.json",
            stringify({
              terms: [
                ...new Set(terms.map((v: string) => v.trim()).filter(Boolean)),
              ],
            }),
          ),
        );
      }),
    "profiles:export-plan": async (id) => {
      const value = await (await store()).editor(nonEmptyString(id, "id"));
      const { bundle, notes } = bundleProfile(
        value.profile.name,
        value.document,
      );
      return {
        token: remember({
          bundle,
          id: value.profile.id,
          fingerprint: value.fingerprint,
        }),
        changes: [
          ...Object.keys(bundle.files),
          ...Object.keys(bundle.personal),
        ].map((file) => ({ file, diff: "포함" })),
        notes,
      };
    },
    "profiles:export": (id, token) =>
      exclusive(async () => {
        const plan = transfers.get(nonEmptyString(token, "token"));
        const editor = await (await store()).editor(nonEmptyString(id, "id"));
        if (!plan || plan.id !== id || plan.fingerprint !== editor.fingerprint)
          throw new RequestError(409, "내보내기 미리보기를 다시 만드세요");
        const target = await deps.chooseProfileFile?.("save");
        if (!target) return null;
        await withLock(async () => {
          const before = await fs
            .readFile(target, "utf8")
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            });
          await writeFileChecked(target, before, stringify(plan.bundle));
        });
        transfers.delete(token as string);
        return target;
      }),
    "profiles:import-plan": async () => {
      const file = await deps.chooseProfileFile?.("open");
      if (!file) return null;
      if ((await fs.stat(file)).size > 16 * 1024 * 1024)
        throw new RequestError(422, "프로필 파일은 16 MiB 이하여야 합니다");
      const bundle = parseBundle(await fs.readFile(file, "utf8"));
      return {
        token: remember({ bundle }),
        changes: [
          ...Object.keys(bundle.files),
          ...Object.keys(bundle.personal),
        ].map((file) => ({ file, diff: "새 프로필에 포함" })),
        notes: [
          `새 프로필: ${bundle.name}`,
          "기존 프로필을 덮어쓰지 않고 설치 명령도 실행하지 않습니다.",
        ],
      };
    },
    "profiles:import": (token) =>
      exclusive(async () => {
        const plan = transfers.get(nonEmptyString(token, "token"));
        if (!plan || plan.id)
          throw new RequestError(409, "가져오기 미리보기를 다시 만드세요");
        const result = await (await store()).importBundle(plan.bundle);
        transfers.delete(token as string);
        return result;
      }),
    "profiles:github-status": async (id) =>
      (await syncing()).status(
        nonEmptyString(id, "id"),
        new AbortController().signal,
      ),
    "profiles:github-tools": () =>
      exclusive(async (signal) => {
        await (await syncing()).tools(signal, log);
        sync = undefined;
      }),
    "profiles:github-login": () =>
      exclusive(async (signal) => {
        await (await syncing()).login(signal, log);
        sync = undefined;
      }),
    "profiles:github-connect": (id, repository, create) =>
      exclusive(async (signal) =>
        (await syncing()).connect(
          nonEmptyString(id, "id"),
          nonEmptyString(repository, "repository"),
          booleanValue(create, "create"),
          signal,
        ),
      ),
    "profiles:sync-plan": (id, direction) =>
      exclusive(async (signal) => {
        if (direction !== "send" && direction !== "receive")
          throw new RequestError(400, "잘못된 동기화 방향입니다");
        return (await syncing()).preview(
          nonEmptyString(id, "id"),
          direction,
          signal,
        );
      }),
    "profiles:sync": (id, token, choices) =>
      exclusive(async (signal) => {
        const value = exactObject(
          choices,
          Object.keys(choices && typeof choices === "object" ? choices : {}),
          "choices",
        );
        if (Object.values(value).some((v) => v !== "local" && v !== "remote"))
          throw new RequestError(400, "충돌 해결을 선택하세요");
        return (await syncing()).apply(
          nonEmptyString(id, "id"),
          nonEmptyString(token, "token"),
          value as Record<string, "local" | "remote">,
          signal,
        );
      }),
    "profiles:cancel": () => deps.install.session.cancel(),
  };
}
