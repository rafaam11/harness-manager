import { useEffect, useMemo, useState } from "react";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type {
  ProfileDocument,
  ProfileEditor,
  ProfilePreview,
  ProfileSyncStatus,
  SetupProfiles,
} from "@shared/setup-profile-types";
import { PROFILE_FILES, PERSONAL_FILES } from "@shared/setup-profile-types";
import { call } from "../api/client";
import { Banner, PageHeader, Panel, StatusTag, Tabs } from "../components/ui";
import SetupProfilePicker from "../components/SetupProfilePicker";
import ProfileFields from "../components/ProfileFields";
import ProfilePreviewDialog, {
  type ProfileAction,
} from "../components/ProfilePreviewDialog";
import { countProfileItems } from "../components/ProfileTables";
import { useConfirmDialog } from "../components/confirm-dialog";
import RepoConnect from "../components/RepoConnect";
import type { PageContext } from "./registry";

const PRIVATE_TERMS = "private-terms";
const PORTABLE = "portable";

const FILE_LABELS: Record<string, string> = {
  "home/components.v2.json": "구성요소와 자동 적용 정책",
  "home/cli-settings.v1.json": "CLI 설정 정의",
  "manifest/packages.json": "툴체인 패키지",
  "manifest/tools.json": "독립 설치 도구",
  "manifest/plugins.json": "마켓플레이스와 플러그인",
  "manifest/mcp.json": "MCP 서버",
  "manifest/skills.json": "외부 스킬",
  "home/managed-keys.json": "관리할 설정 키",
  "home/agents/AGENTS.md": "Codex 공통 지침",
  "home/claude/CLAUDE.md": "Claude 공통 지침",
  "home/claude/settings.managed.json": "Claude 관리 설정",
  "home/codex/config.managed.toml": "Codex 관리 설정",
  "home/powershell/profile.ps1": "PowerShell 관리 블록",
  "home/git/gitconfig.json": "Git 관리 설정",
  "AGENTS.local.md": "개인 지침",
  "claude-settings.local.json": "Claude 개인 설정",
  "codex-config.local.json": "Codex 개인 설정",
  "cli-settings.local.json": "CLI 개인 설정",
  "manifest.local.json": "개인 플러그인·MCP·스킬",
  "powershell.local.ps1": "PowerShell 개인 블록",
  "gitconfig.local.json": "Git 이름·이메일 등 개인 설정",
  [PRIVATE_TERMS]: "비공개 낱말",
};

// Git 설정은 "user.name"처럼 점이 든 평평한 키이므로 점으로 나누면 파일 형식이 깨진다.
const FLAT_KEY_FILES = ["home/git/gitconfig.json", "gitconfig.local.json"];

type Tab = "items" | "managed" | "personal" | "transfer" | "manage";
type EditTab = Extract<Tab, "items" | "managed" | "personal">;

const TAB_LABELS: Record<Tab, string> = {
  items: "설치 항목",
  managed: "관리 설정",
  personal: "개인 설정",
  transfer: "동기화·이동",
  manage: "프로필 관리",
};
const TAB_KEY = "harness-manager.profiles-tab.v1";

const FILE_GROUPS: Record<EditTab, readonly string[]> = {
  items: PROFILE_FILES.filter((file) => file.startsWith("manifest/")),
  managed: PROFILE_FILES.filter((file) => !file.startsWith("manifest/")),
  personal: [...PERSONAL_FILES, PRIVATE_TERMS],
};

function storedTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_KEY);
    return stored && stored in TAB_LABELS ? (stored as Tab) : "items";
  } catch {
    return "items";
  }
}

function canonical(file: string, text: string) {
  try {
    if (file.endsWith(".json")) return JSON.stringify(JSON.parse(text));
    if (file.endsWith(".toml")) return JSON.stringify(parseToml(text));
  } catch {
    // 형식이 깨진 파일은 글자 그대로 비교한다.
  }
  return text;
}

function normalizedTerms(terms: string[]) {
  return JSON.stringify(terms.map((term) => term.trim()).filter(Boolean));
}

function dirtyEntries(saved: ProfileDocument, current: ProfileDocument) {
  const dirty = new Set<string>();
  for (const group of ["files", "personal"] as const)
    for (const key of new Set([
      ...Object.keys(saved[group]),
      ...Object.keys(current[group]),
    ]))
      if (saved[group][key] !== current[group][key]) dirty.add(key);
  if (normalizedTerms(saved.privateTerms) !== normalizedTerms(current.privateTerms))
    dirty.add(PRIVATE_TERMS);
  if (
    JSON.stringify([...saved.portable].sort()) !==
    JSON.stringify([...current.portable].sort())
  )
    dirty.add(PORTABLE);
  return dirty;
}

function itemCount(document: ProfileDocument, tab: EditTab, file: string) {
  if (file === PRIVATE_TERMS)
    return `${document.privateTerms.filter((term) => term.trim()).length}개`;
  const text = document[tab === "personal" ? "personal" : "files"][file];
  if (text === undefined) return "없음";
  try {
    if (file.endsWith(".json"))
      return `${countProfileItems(JSON.parse(text))}개`;
    if (file.endsWith(".toml"))
      return `${countProfileItems(parseToml(text))}개`;
  } catch {
    return "형식 오류";
  }
  const trimmed = text.trimEnd();
  return `${trimmed ? trimmed.split("\n").length : 0}줄`;
}

function FileList({
  tab,
  document,
  file,
  dirty,
  disabled,
  onSelect,
  onPortable,
}: {
  tab: EditTab;
  document: ProfileDocument;
  file: string;
  dirty: Set<string>;
  disabled: boolean;
  onSelect(file: string): void;
  onPortable(file: string, checked: boolean): void;
}) {
  const personal = tab === "personal";
  return (
    <section className="pc-master" aria-label="편집할 파일">
      <div className="profiles-file-list">
        <table className="data-table profiles-file-table">
          <thead>
            <tr>
              <th>파일</th>
              <th>항목</th>
              {personal && <th title="다른 PC로 이동">이동</th>}
            </tr>
          </thead>
          <tbody>
            {FILE_GROUPS[tab].map((entry) => {
              const label = FILE_LABELS[entry] ?? entry;
              return (
                <tr
                  key={entry}
                  className={entry === file ? "selected" : undefined}
                >
                  <td>
                    <button
                      type="button"
                      className="profiles-file-button"
                      aria-current={entry === file ? "true" : undefined}
                      onClick={() => onSelect(entry)}
                    >
                      {label}
                    </button>
                  </td>
                  <td className="profiles-file-count">
                    {itemCount(document, tab, entry)}
                    {dirty.has(entry) && (
                      <StatusTag tone="warn">변경</StatusTag>
                    )}
                  </td>
                  {personal && (
                    <td>
                      {entry !== PRIVATE_TERMS && (
                        <input
                          type="checkbox"
                          aria-label={`${label} 다른 PC로 이동`}
                          disabled={disabled}
                          checked={document.portable.includes(entry)}
                          onChange={(event) =>
                            onPortable(entry, event.target.checked)
                          }
                        />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {personal && (
        <p className="muted profiles-file-note">
          인증 정보와 PC 고유 절대경로는 선택해도 이동하지 않습니다.
        </p>
      )}
    </section>
  );
}

export default function Profiles({ navigate }: PageContext) {
  const [list, setList] = useState<SetupProfiles | null>(null);
  const [editor, setEditor] = useState<ProfileEditor | null>(null);
  const [saved, setSaved] = useState<ProfileDocument | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>(storedTab);
  const [selected, setSelected] = useState<Record<EditTab, string>>({
    items: FILE_GROUPS.items[0],
    managed: FILE_GROUPS.managed[0],
    personal: FILE_GROUPS.personal[0],
  });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ProfilePreview | null>(null);
  const [action, setAction] = useState<ProfileAction>("edit");
  const [sync, setSync] = useState<ProfileSyncStatus | null>(null);
  const [repo, setRepo] = useState("");
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>(
    {},
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [maintainer, setMaintainer] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  const adopt = (next: ProfileEditor) => {
    setEditor(next);
    setSaved(next.document);
    // 표 안의 임시 상태(입력 중인 새 키, 해제한 플러그인 행)도 저장본에 맞춰 비운다.
    setResetKey((key) => key + 1);
  };
  const load = async () => {
    const profiles = await call("profiles:list");
    setList(profiles);
    const next = await call("profiles:editor", profiles.activeId);
    adopt(next);
    setName(next.profile.name);
    setPreview(null);
    setSync(null);
    void call("profiles:github-status", next.profile.id)
      .then(setSync)
      .catch(() => undefined);
  };
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
    void call("settings:get").then((s) =>
      setMaintainer(Boolean(s.maintainerMode)),
    );
    return window.hm.on("profiles:log", (event) =>
      setLogs((lines) => [...lines.slice(-100), event.text]),
    );
  }, [version]);
  const dirty = useMemo(
    () =>
      editor && saved
        ? dirtyEntries(saved, editor.document)
        : new Set<string>(),
    [editor, saved],
  );
  const hasChanges = dirty.size > 0;
  useEffect(() => {
    if (!hasChanges) return;
    const guard = (event: Event) => {
      event.preventDefault();
      void confirm({
        title: "프로필 편집을 마칠까요?",
        message: `저장하지 않은 변경 ${dirty.size}개가 있습니다.`,
        confirmLabel: "편집 내용 버리기",
        danger: true,
      }).then((ok) => {
        if (ok) (event as CustomEvent<{ proceed(): void }>).detail.proceed();
      });
    };
    window.addEventListener("hm:before-navigate", guard);
    return () => window.removeEventListener("hm:before-navigate", guard);
  }, [hasChanges, dirty.size, confirm]);
  const work = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mutable =
    editor &&
    !editor.profile.archived &&
    !["builtin", "legacy"].includes(editor.profile.kind);
  const changed = () => {
    setVersion((v) => v + 1);
  };
  const chooseTab = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // 기억하지 못해도 화면은 동작한다.
    }
  };
  const editTab: EditTab | null =
    tab === "items" || tab === "managed" || tab === "personal" ? tab : null;
  const file = editTab ? selected[editTab] : "";
  const group = editTab === "personal" ? "personal" : "files";
  // 없는 파일의 빈 값은 화면용이다. document에 쓰면 main이 파일 제거로 판단할 수 있어 편집 전까지 넣지 않는다.
  const current =
    editor?.document[group][file] ?? (file.endsWith(".json") ? "{}" : "");
  const setDocument = (next: Partial<ProfileDocument>) => {
    if (!editor) return;
    setEditor({ ...editor, document: { ...editor.document, ...next } });
    setPreview(null);
  };
  const setText = (text: string) => {
    if (!editor) return;
    const before = saved?.[group][file];
    // 값을 되돌리면 원래 서식으로 돌아가 변경으로 세지 않는다.
    const next =
      before !== undefined && canonical(file, before) === canonical(file, text)
        ? before
        : text;
    setDocument({ [group]: { ...editor.document[group], [file]: next } });
  };
  const show = async (
    kind: ProfileAction,
    fn: () => Promise<ProfilePreview | null>,
  ) => {
    setAction(kind);
    setChoices({});
    setPreview(await fn());
  };
  const apply = async () => {
    if (!preview || !editor) return;
    if (action === "edit")
      adopt(await call("profiles:apply", editor.profile.id, preview.token));
    else if (action === "export") {
      const result = await call(
        "profiles:export",
        editor.profile.id,
        preview.token,
      );
      if (result) setMessage(`내보냈습니다: ${result}`);
    } else if (action === "import") {
      await call("profiles:import", preview.token);
      changed();
    } else {
      setSync(
        await call("profiles:sync", editor.profile.id, preview.token, choices),
      );
      adopt(await call("profiles:editor", editor.profile.id));
    }
    setPreview(null);
  };
  const countByTab = (target: EditTab) =>
    FILE_GROUPS[target].filter((entry) => dirty.has(entry)).length +
    (target === "personal" && dirty.has(PORTABLE) ? 1 : 0);
  const tabLabel = (id: EditTab) => {
    const count = countByTab(id);
    return (
      <>
        {TAB_LABELS[id]}
        {count > 0 && <span className="count">{count}</span>}
      </>
    );
  };
  const renderFileBody = () => {
    const disabled = !mutable || busy;
    const label = FILE_LABELS[file] ?? file;
    const key = `${file}:${resetKey}`;
    if (file === PRIVATE_TERMS)
      return (
        <>
          <p className="muted">
            가져오기에서 공개 파일에 이 낱말이 남으면 적용을 막습니다. 한 줄에
            하나씩 적습니다.
          </p>
          <textarea
            className="mono profiles-text"
            aria-label="프로필 비공개 낱말"
            disabled={disabled}
            value={editor?.document.privateTerms.join("\n") ?? ""}
            onChange={(e) =>
              setDocument({ privateTerms: e.target.value.split("\n") })
            }
          />
        </>
      );
    try {
      if (file.endsWith(".json"))
        return (
          <ProfileFields
            key={key}
            label={label}
            disabled={disabled}
            flatKeys={FLAT_KEY_FILES.includes(file)}
            value={JSON.parse(current)}
            onChange={(value) => setText(JSON.stringify(value, null, 2) + "\n")}
          />
        );
      if (file.endsWith(".toml"))
        return (
          <ProfileFields
            key={key}
            label={label}
            disabled={disabled}
            value={parseToml(current) as never}
            onChange={(value) =>
              setText(stringifyToml(value as Record<string, never>))
            }
          />
        );
      return (
        <textarea
          className="mono profiles-text"
          aria-label={label}
          disabled={disabled}
          value={current}
          onChange={(e) => setText(e.target.value)}
        />
      );
    } catch {
      return (
        <textarea
          className="mono profiles-text"
          aria-label={`${file} 형식 수정`}
          disabled={disabled}
          value={current}
          onChange={(e) => setText(e.target.value)}
        />
      );
    }
  };
  const archived = list?.profiles.filter((p) => p.archived) ?? [];
  return (
    <div className="pc-page profiles-page">
      {dialog}
      <PageHeader title="고급 프로필" meta="로컬 저장 · GitHub 동기화는 선택">
        <SetupProfilePicker
          key={version}
          parts="select"
          disabled={busy || hasChanges}
          onChanged={changed}
        />
        <button className="btn ghost" onClick={() => navigate("install")}>
          설치 미리보기
        </button>
        <button className="btn ghost" onClick={() => navigate("capture")}>
          현재 PC 설정 가져오기
        </button>
      </PageHeader>
      <Tabs<Tab>
        label="고급 프로필"
        value={tab}
        onChange={chooseTab}
        items={[
          { id: "items", label: tabLabel("items") },
          { id: "managed", label: tabLabel("managed") },
          { id: "personal", label: tabLabel("personal") },
          { id: "transfer", label: TAB_LABELS.transfer },
          { id: "manage", label: TAB_LABELS.manage },
        ]}
      />
      {error && <Banner tone="err">{error}</Banner>}
      {message && <Banner tone="ok">{message}</Banner>}
      {editor && !mutable && tab !== "manage" && (
        <Banner tone="warn">
          <div className="pc-inline">
            공통 기본은 읽기 전용입니다. 프로필 관리 탭에서 개인 사본을 만드세요.
            <button className="btn ghost" onClick={() => chooseTab("manage")}>
              프로필 관리로 이동
            </button>
          </div>
        </Banner>
      )}
      {editor && editTab && (
        <div className="profiles-editor">
          <FileList
            tab={editTab}
            document={editor.document}
            file={file}
            dirty={dirty}
            disabled={!mutable || busy}
            onSelect={(entry) =>
              setSelected({ ...selected, [editTab]: entry })
            }
            onPortable={(entry, checked) =>
              setDocument({
                portable: checked
                  ? [...editor.document.portable, entry]
                  : editor.document.portable.filter((v) => v !== entry),
              })
            }
          />
          <section className="pc-master" aria-label={FILE_LABELS[file] ?? file}>
            <header className="profiles-pane-head">
              <strong>{FILE_LABELS[file] ?? file}</strong>
              {file !== PRIVATE_TERMS && (
                <span className="mono muted">{file}</span>
              )}
            </header>
            <div className="pc-scroll profiles-pane-body">
              {renderFileBody()}
            </div>
          </section>
        </div>
      )}
      {editor && tab === "transfer" && (
        <div className="pc-settings-body profiles-tab-body">
          {hasChanges && (
            <Banner tone="warn">
              저장하지 않은 변경은 내보내기·동기화에 포함되지 않습니다. 보내기와
              받기는 저장 후 사용할 수 있습니다.
            </Banner>
          )}
          <Panel head="파일로 이동">
            <table className="data-table">
              <thead>
                <tr>
                  <th>작업</th>
                  <th>하는 일</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="settings-tool-cell">
                    <button
                      className="btn ghost"
                      disabled={busy}
                      onClick={() =>
                        void work(() =>
                          show("export", () =>
                            call("profiles:export-plan", editor.profile.id),
                          ),
                        )
                      }
                    >
                      파일 내보내기 미리보기
                    </button>
                  </td>
                  <td>
                    정의와 선택한 개인 설정을 .hmprofile.json으로 저장합니다.
                    인증 정보와 PC 절대경로는 제외합니다.
                  </td>
                </tr>
                <tr>
                  <td className="settings-tool-cell">
                    <button
                      className="btn ghost"
                      disabled={busy || hasChanges}
                      onClick={() =>
                        void work(() =>
                          show("import", () => call("profiles:import-plan")),
                        )
                      }
                    >
                      파일에서 새 프로필 가져오기
                    </button>
                  </td>
                  <td>.hmprofile.json 파일을 새 프로필로 가져옵니다.</td>
                </tr>
              </tbody>
            </table>
          </Panel>
          <Panel head="GitHub 동기화">
            <p>{sync?.detail ?? "연결 상태 확인 중…"}</p>
            <p className="muted">
              {sync?.account && `계정 ${sync.account} · `}
              {sync?.repository ??
                "저장소를 만들지 않고도 모든 로컬 기능을 사용할 수 있습니다."}
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="settings-tool-cell">도구</td>
                  <td>
                    <div className="pc-inline">
                      <button
                        className="btn ghost"
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            if (
                              await confirm({
                                title: "GitHub 도구 준비",
                                message:
                                  "Windows에서 Git.Git과 GitHub.cli를 winget으로 설치합니다. 설치 후 열린 터미널을 다시 열어 주세요.",
                                confirmLabel: "설치",
                              })
                            )
                              await call("profiles:github-tools");
                          })
                        }
                      >
                        GitHub 도구 준비
                      </button>
                      <button
                        className="btn ghost"
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            setLogs([]);
                            await call("profiles:github-login");
                            setSync(
                              await call(
                                "profiles:github-status",
                                editor.profile.id,
                              ),
                            );
                          })
                        }
                      >
                        GitHub 로그인
                      </button>
                      <button
                        className="btn ghost"
                        disabled={busy}
                        onClick={() =>
                          void work(async () =>
                            setSync(
                              await call(
                                "profiles:github-status",
                                editor.profile.id,
                              ),
                            ),
                          )
                        }
                      >
                        원격 변경 확인
                      </button>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td className="settings-tool-cell">저장소</td>
                  <td>
                    <div className="pc-inline">
                      <input
                        aria-label="프로필 GitHub 저장소"
                        placeholder="소유자/저장소"
                        value={repo}
                        onChange={(e) => setRepo(e.target.value)}
                      />
                      {([true, false] as const).map((create) => (
                        <button
                          key={String(create)}
                          className="btn ghost"
                          disabled={busy || !mutable || !repo.trim()}
                          onClick={() =>
                            void work(async () => {
                              if (
                                await confirm({
                                  title: create
                                    ? "비공개 저장소 만들기"
                                    : "저장소 연결",
                                  message: `${repo}\n${create ? "이 비공개 저장소를 새로 만듭니다." : "비공개 HM 프로필 저장소에 연결합니다."} 프로필 전송은 미리보기 후 별도로 실행합니다.`,
                                  confirmLabel: create ? "만들기" : "연결",
                                })
                              )
                                setSync(
                                  await call(
                                    "profiles:github-connect",
                                    editor.profile.id,
                                    repo.trim(),
                                    create,
                                  ),
                                );
                            })
                          }
                        >
                          {create ? "비공개 저장소 만들기" : "기존 저장소 연결"}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td className="settings-tool-cell">전송</td>
                  <td>
                    <div className="pc-inline">
                      {(["send", "receive"] as const).map((direction) => (
                        <button
                          key={direction}
                          className="btn"
                          disabled={
                            busy ||
                            !mutable ||
                            hasChanges ||
                            !sync?.connected ||
                            !sync.available
                          }
                          onClick={() =>
                            void work(() =>
                              show("sync", () =>
                                call(
                                  "profiles:sync-plan",
                                  editor.profile.id,
                                  direction,
                                ),
                              ),
                            )
                          }
                        >
                          {direction === "send" ? "보내기" : "받기"} 미리보기
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            {busy && (
              <button
                className="btn ghost"
                onClick={() => void call("profiles:cancel")}
              >
                진행 중 작업 취소
              </button>
            )}
            {logs.length > 0 && (
              <pre className="capture-diff">{logs.join("\n")}</pre>
            )}
          </Panel>
        </div>
      )}
      {tab === "manage" && (
        <div className="pc-settings-body profiles-tab-body">
          {hasChanges && (
            <Banner tone="warn">
              저장하지 않은 변경이 있어 프로필을 바꾸거나 만들 수 없습니다. 먼저
              저장하거나 되돌리세요.
            </Banner>
          )}
          {editor && (
            <Panel head="이 프로필">
              <div className="pc-inline">
                <input
                  aria-label="프로필 이름"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
                <button
                  className="btn ghost"
                  disabled={busy || !mutable || hasChanges || !name.trim()}
                  onClick={() =>
                    void work(async () => {
                      await call(
                        "profiles:update",
                        editor.profile.id,
                        "rename",
                        name.trim(),
                      );
                      changed();
                    })
                  }
                >
                  이름 변경
                </button>
                <button
                  className="btn ghost"
                  disabled={busy || !mutable || hasChanges}
                  onClick={() =>
                    void work(async () => {
                      if (
                        await confirm({
                          title: "프로필 보관",
                          message:
                            "프로필 파일은 보존합니다. 연결한 외부 폴더도 삭제하지 않습니다. 기본 프로필로 전환합니다.",
                          confirmLabel: "보관",
                        })
                      ) {
                        await call(
                          "profiles:update",
                          editor.profile.id,
                          "archive",
                        );
                        changed();
                      }
                    })
                  }
                >
                  {editor.profile.kind === "linked" ? "연결 해제" : "보관"}
                </button>
              </div>
            </Panel>
          )}
          <SetupProfilePicker
            key={version}
            parts="manage"
            disabled={busy || hasChanges}
            onChanged={changed}
          />
          {archived.length > 0 && (
            <Panel head="보관한 프로필">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>복원</th>
                  </tr>
                </thead>
                <tbody>
                  {archived.map((profile) => (
                    <tr key={profile.id}>
                      <td>{profile.name}</td>
                      <td className="settings-tool-cell">
                        <button
                          className="btn ghost"
                          disabled={busy || hasChanges}
                          onClick={() =>
                            void work(async () => {
                              await call(
                                "profiles:update",
                                profile.id,
                                "restore",
                              );
                              changed();
                            })
                          }
                        >
                          복원
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
          <details>
            <summary>개발자 설정</summary>
            <RepoConnect
              onConnected={() => {
                // 다시 불러오면 편집 내용을 잃는다. 저장 후에는 다음 진입 때 반영된다.
                if (!hasChanges) changed();
              }}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={maintainer}
                disabled={busy}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void work(async () => {
                    if (
                      checked &&
                      !(await confirm({
                        title: "관리자 모드",
                        message:
                          "AI 복구에서 별도 기여 동의와 쓰기 권한 확인을 거쳐 HM dev에 직접 push할 수 있게 합니다.",
                        confirmLabel: "활성화",
                      }))
                    )
                      return;
                    await call("settings:set", { maintainerMode: checked });
                    setMaintainer(checked);
                  });
                }}
              />
              관리자 직접 push 허용
            </label>
          </details>
        </div>
      )}
      {editor && (
        <footer className="pc-footer profiles-save">
          <strong>
            {hasChanges ? `저장하지 않은 변경 ${dirty.size}개` : "변경 없음"}
          </strong>
          <span className="muted profiles-save-note">
            저장은 프로필만 변경합니다. 항목을 빼도 설치된 패키지를 제거하지
            않습니다.
          </span>
          <button
            className="btn ghost"
            disabled={busy || !hasChanges}
            onClick={() =>
              void work(async () => {
                if (
                  saved &&
                  (await confirm({
                    title: "변경을 되돌릴까요?",
                    message: `저장하지 않은 변경 ${dirty.size}개를 버립니다.`,
                    confirmLabel: "되돌리기",
                    danger: true,
                  }))
                ) {
                  setEditor({ ...editor, document: saved });
                  setResetKey((key) => key + 1);
                  setPreview(null);
                }
              })
            }
          >
            변경 되돌리기
          </button>
          <button
            className="btn"
            disabled={!mutable || busy || !hasChanges}
            onClick={() =>
              void work(() =>
                show("edit", () =>
                  call(
                    "profiles:preview",
                    editor.profile.id,
                    editor.fingerprint,
                    editor.document,
                  ),
                ),
              )
            }
          >
            저장 미리보기
          </button>
        </footer>
      )}
      {preview && (
        <ProfilePreviewDialog
          preview={preview}
          action={action}
          busy={busy}
          error={error}
          choices={choices}
          onChoose={(conflict, choice) =>
            setChoices({ ...choices, [conflict]: choice })
          }
          onApply={() => void work(apply)}
          onClose={() => {
            setPreview(null);
            setError("");
          }}
        />
      )}
    </div>
  );
}
