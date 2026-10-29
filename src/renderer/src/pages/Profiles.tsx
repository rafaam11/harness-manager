import { useEffect, useState } from "react";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type {
  ProfileEditor,
  ProfilePreview,
  ProfileSyncPreview,
  ProfileSyncStatus,
  SetupProfiles,
} from "@shared/setup-profile-types";
import { PROFILE_FILES, PERSONAL_FILES } from "@shared/setup-profile-types";
import { call } from "../api/client";
import { Banner, PageHeader, Panel, Toolbar } from "../components/ui";
import SetupProfilePicker from "../components/SetupProfilePicker";
import ProfileFields from "../components/ProfileFields";
import { useConfirmDialog } from "../components/confirm-dialog";
import RepoConnect from "../components/RepoConnect";
import type { PageContext } from "./registry";

const FILE_LABELS: Record<string, string> = {
  "home/components.v2.json": "v4 구성요소와 자동 적용 정책",
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
  "manifest.local.json": "개인 플러그인·MCP·스킬",
  "powershell.local.ps1": "PowerShell 개인 블록",
  "gitconfig.local.json": "Git 이름·이메일 등 개인 설정",
};

export default function Profiles({ navigate }: PageContext) {
  const [list, setList] = useState<SetupProfiles | null>(null);
  const [editor, setEditor] = useState<ProfileEditor | null>(null);
  const [version, setVersion] = useState(0);
  const [file, setFile] = useState<string>(PROFILE_FILES[0]);
  const [personal, setPersonal] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ProfilePreview | null>(null);
  const [action, setAction] = useState<"edit" | "export" | "import" | "sync">(
    "edit",
  );
  const [sync, setSync] = useState<ProfileSyncStatus | null>(null);
  const [repo, setRepo] = useState("");
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>(
    {},
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [maintainer, setMaintainer] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  const load = async () => {
    const profiles = await call("profiles:list");
    setList(profiles);
    const next = await call("profiles:editor", profiles.activeId);
    setEditor(next);
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
  const current =
    editor?.document[personal ? "personal" : "files"][file] ??
    (file.endsWith(".json") ? "{}" : "");
  const setText = (text: string) => {
    if (!editor) return;
    const group = personal ? "personal" : "files";
    setEditor({
      ...editor,
      document: {
        ...editor.document,
        [group]: { ...editor.document[group], [file]: text },
      },
    });
    setPreview(null);
  };
  const show = async (
    kind: typeof action,
    fn: () => Promise<ProfilePreview | null>,
  ) => {
    setAction(kind);
    setChoices({});
    setPreview(await fn());
  };
  const apply = async () => {
    if (!preview || !editor) return;
    if (action === "edit")
      setEditor(await call("profiles:apply", editor.profile.id, preview.token));
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
      setEditor(await call("profiles:editor", editor.profile.id));
    }
    setPreview(null);
  };
  const syncPreview =
    action === "sync" ? (preview as ProfileSyncPreview | null) : null;
  let form;
  try {
    form = file.endsWith(".json") ? (
      <ProfileFields
        label={FILE_LABELS[file] ?? file}
        disabled={!mutable || busy}
        value={JSON.parse(current)}
        onChange={(value) => setText(JSON.stringify(value, null, 2) + "\n")}
      />
    ) : file.endsWith(".toml") ? (
      <ProfileFields
        label="Codex 관리 설정"
        disabled={!mutable || busy}
        value={parseToml(current) as never}
        onChange={(value) =>
          setText(stringifyToml(value as Record<string, never>))
        }
      />
    ) : (
      <textarea
        aria-label={FILE_LABELS[file] ?? file}
        rows={12}
        disabled={!mutable || busy}
        value={current}
        onChange={(e) => setText(e.target.value)}
      />
    );
  } catch {
    form = (
      <textarea
        aria-label={`${file} 형식 수정`}
        rows={12}
        disabled={!mutable || busy}
        value={current}
        onChange={(e) => setText(e.target.value)}
      />
    );
  }
  return (
    <div className="profiles-page">
      {dialog}
      <PageHeader
        title="사용자 프로필"
        meta="로컬 저장 · GitHub 동기화는 선택"
      />
      {error && <Banner tone="err">{error}</Banner>}
      {message && <Banner tone="ok">{message}</Banner>}
      <SetupProfilePicker key={version} disabled={busy} onChanged={changed} />
      <Toolbar>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() =>
            void work(() => show("import", () => call("profiles:import-plan")))
          }
        >
          파일에서 새 프로필 가져오기
        </button>
        <button className="btn ghost" onClick={() => navigate("capture")}>
          현재 PC 설정 가져오기
        </button>
        <button className="btn ghost" onClick={() => navigate("install")}>
          설치 미리보기
        </button>
      </Toolbar>
      {editor && (
        <>
          <Toolbar>
            <input
              aria-label="프로필 이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
            <button
              className="btn ghost"
              disabled={busy || !mutable || !name.trim()}
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
              disabled={busy || !mutable}
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
                    await call("profiles:update", editor.profile.id, "archive");
                    changed();
                  }
                })
              }
            >
              {editor.profile.kind === "linked" ? "연결 해제" : "보관"}
            </button>
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
          </Toolbar>
          {!mutable && (
            <Banner tone="warn">
              공통 기본은 읽기 전용입니다. 위에서 이름을 입력하고 개인 사본을
              만드세요.
            </Banner>
          )}
          <Panel
            head={<span className="panel-title">설치 항목과 관리 설정</span>}
          >
            <p className="muted">
              저장은 프로필만 변경합니다. 항목을 빼도 설치된 패키지를 제거하지
              않습니다.
            </p>
            <Toolbar>
              <label>
                <input
                  type="checkbox"
                  checked={personal}
                  onChange={(e) => {
                    setPersonal(e.target.checked);
                    setFile(
                      e.target.checked ? PERSONAL_FILES[0] : PROFILE_FILES[0],
                    );
                  }}
                />
                개인 설정 편집
              </label>
              <select
                aria-label="편집할 프로필 파일"
                value={file}
                onChange={(e) => setFile(e.target.value)}
              >
                {(personal ? PERSONAL_FILES : PROFILE_FILES).map((entry) => (
                  <option key={entry} value={entry}>
                    {FILE_LABELS[entry] ?? entry}
                  </option>
                ))}
              </select>
            </Toolbar>
            {form}
            <label>
              비공개 낱말 (한 줄에 하나)
              <textarea
                aria-label="프로필 비공개 낱말"
                rows={3}
                disabled={!mutable || busy}
                value={editor.document.privateTerms.join("\n")}
                onChange={(e) => {
                  setEditor({
                    ...editor,
                    document: {
                      ...editor.document,
                      privateTerms: e.target.value.split("\n"),
                    },
                  });
                  setPreview(null);
                }}
              />
            </label>
            <fieldset className="profiles-fields" disabled={!mutable || busy}>
              <legend>다른 PC로 이동할 개인 설정</legend>
              {PERSONAL_FILES.map((entry) => (
                <label key={entry} className="check">
                  <input
                    type="checkbox"
                    checked={editor.document.portable.includes(entry)}
                    onChange={(e) => {
                      setEditor({
                        ...editor,
                        document: {
                          ...editor.document,
                          portable: e.target.checked
                            ? [...editor.document.portable, entry]
                            : editor.document.portable.filter(
                                (v) => v !== entry,
                              ),
                        },
                      });
                      setPreview(null);
                    }}
                  />
                  {FILE_LABELS[entry] ?? entry}
                </label>
              ))}
              <p className="muted">
                인증 정보와 PC 고유 절대경로는 선택해도 이동하지 않습니다.
              </p>
            </fieldset>
            <button
              className="btn"
              disabled={!mutable || busy}
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
          </Panel>
          <Panel
            head={<span className="panel-title">선택적 GitHub 동기화</span>}
          >
            <p>{sync?.detail ?? "연결 상태 확인 중…"}</p>
            <p className="muted">
              {sync?.account && `계정 ${sync.account} · `}
              {sync?.repository ??
                "저장소를 만들지 않고도 모든 로컬 기능을 사용할 수 있습니다."}
            </p>
            <Toolbar>
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
                      await call("profiles:github-status", editor.profile.id),
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
                      await call("profiles:github-status", editor.profile.id),
                    ),
                  )
                }
              >
                원격 변경 확인
              </button>
            </Toolbar>
            <Toolbar>
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
            </Toolbar>
            <Toolbar>
              {(["send", "receive"] as const).map((direction) => (
                <button
                  key={direction}
                  className="btn"
                  disabled={
                    busy || !mutable || !sync?.connected || !sync.available
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
            </Toolbar>
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
        </>
      )}
      {preview && (
        <Panel head={<span className="panel-title">변경 미리보기</span>}>
          {preview.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          {preview.changes.map((change) => (
            <details key={change.file} open>
              <summary>{change.file}</summary>
              <pre className="capture-diff">{change.diff}</pre>
            </details>
          ))}
          {syncPreview?.conflicts.map((conflict) => (
            <label key={conflict}>
              {conflict} 충돌
              <select
                value={choices[conflict] ?? ""}
                onChange={(e) =>
                  setChoices({
                    ...choices,
                    [conflict]: e.target.value as "local" | "remote",
                  })
                }
              >
                <option value="">선택하세요</option>
                <option value="local">이 PC 프로필 유지</option>
                <option value="remote">원격 프로필 사용</option>
              </select>
            </label>
          ))}
          <Toolbar>
            <button
              className="btn"
              disabled={
                busy ||
                Boolean(syncPreview?.conflicts.some((key) => !choices[key]))
              }
              onClick={() => void work(apply)}
            >
              {action === "export"
                ? "파일로 저장"
                : action === "import"
                  ? "새 프로필로 가져오기"
                  : "변경 적용"}
            </button>
            <button className="btn ghost" onClick={() => setPreview(null)}>
              닫기
            </button>
          </Toolbar>
        </Panel>
      )}
      {list?.profiles.some((p) => p.archived) && (
        <Panel head={<span className="panel-title">보관한 프로필</span>}>
          {list.profiles
            .filter((p) => p.archived)
            .map((profile) => (
              <Toolbar key={profile.id}>
                <span>{profile.name}</span>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() =>
                    void work(async () => {
                      await call("profiles:update", profile.id, "restore");
                      changed();
                    })
                  }
                >
                  복원
                </button>
              </Toolbar>
            ))}
        </Panel>
      )}
      <details>
        <summary>개발자 설정</summary>
        <RepoConnect onConnected={changed} />
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
  );
}
