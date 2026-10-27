import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createJSONEditor, type Content } from "vanilla-jsoneditor";
import "vanilla-jsoneditor/themes/jse-theme-dark.css";
import type { BackupInfo, ConfigFileData as ConfigData } from "@shared/api-types";
import { call, fmtSize, fmtDate, ApiError } from "../api/client";
import { useConfirmDialog } from "../components/confirm-dialog";
import { useResolvedTheme } from "../theme";
import type { NormalizedConfigFile, ProviderFilter, ProviderId } from "@shared/provider-types";
import { Banner, PageHeader, StatusTag, Tabs, Toolbar } from "../components/ui";
import { PROVIDER_FILTER_OPTIONS, groupRowsByProvider, providerGroupLabel, providerLabel, useStoredProviderFilter } from "../provider-ui";

type EditorInstance = ReturnType<typeof createJSONEditor>;

function contentToText(c: Content): string {
  if ("text" in c && typeof c.text === "string") return c.text;
  if ("json" in c) return JSON.stringify((c as { json: unknown }).json, null, 2);
  return "";
}

function JsonTreeEditor({
  initialText,
  readOnly,
  isDark,
  onChangeText,
  apiRef,
}: {
  initialText: string;
  readOnly: boolean;
  isDark: boolean;
  onChangeText: (t: string) => void;
  apiRef: React.MutableRefObject<EditorInstance | null>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChangeText);
  onChangeRef.current = onChangeText;
  const initialRef = useRef(initialText);

  useEffect(() => {
    const editor = createJSONEditor({
      target: container.current!,
      props: {
        content: { text: initialRef.current },
        readOnly,
        mainMenuBar: true,
        onChange: (updated: Content) => {
          onChangeRef.current(contentToText(updated));
        },
      },
    });
    apiRef.current = editor;
    return () => {
      editor.destroy();
      apiRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => {
    apiRef.current?.updateProps({ readOnly });
  }, [readOnly, apiRef]);

  return <div ref={container} className={`jse-wrap${isDark ? " jse-theme-dark" : ""}`} />;
}

function TextConfigEditor({
  value,
  readOnly,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <textarea
      className="config-text mono"
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
  );
}

export default function ConfigEditor() {
  const [providerFilter, setProviderFilter] = useStoredProviderFilter("harness-manager.configs.provider");
  const [files, setFiles] = useState<NormalizedConfigFile[]>([]);
  const [selectedId, setSelectedId] = useState<string>("settings");
  const [data, setData] = useState<ConfigData | null>(null);
  const [text, setText] = useState("");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const isDark = useResolvedTheme() === "dark";
  const { confirm, dialog } = useConfirmDialog();
  const editorRef = useRef<EditorInstance | null>(null);

  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedId) ?? null,
    [files, selectedId],
  );
  const isToml = selectedFile?.format === "toml";
  const isJson = selectedFile?.format === "json";

  const loadSelected = useCallback((fileId: string) => {
    setMessage(null);
    setExternalChange(false);
    call("config:read", fileId)
      .then((d) => {
        setData(d);
        setText(d.content);
        if (d.descriptor.format === "json") {
          editorRef.current?.update({ text: d.content });
        } else {
          editorRef.current = null;
        }
      })
      .catch((e) => setMessage({ kind: "err", text: e.message }));
    // 백업은 쓰기 가능한 모든 설정 파일에 있다(main이 읽기 전용 파일엔 빈 목록을 준다).
    call("config:backups", fileId)
      .then(setBackups)
      .catch(() => setBackups([]));
  }, []);

  useEffect(() => {
    setMessage(null);
    call("config:list", providerFilter)
      .then((nextFiles) => {
        setFiles(nextFiles);
        setSelectedId((prev) => {
          if (nextFiles.some((file) => file.id === prev)) return prev;
          const preferred = nextFiles.find((file) => file.writable);
          return preferred?.id ?? nextFiles[0]?.id ?? "";
        });
      })
      .catch((e) => setMessage({ kind: "err", text: e.message }));
  }, [providerFilter]);

  useEffect(() => {
    if (!selectedFile) {
      setData(null);
      setText("");
      setBackups([]);
      setExternalChange(false);
      return;
    }
    loadSelected(selectedFile.id);
  }, [loadSelected, selectedFile]);

  useEffect(() => {
    if (!data || !selectedFile) return;
    const t = setInterval(() => {
      call("config:read", selectedFile.id)
        .then((d) => {
          if (d.sha256 !== data.sha256) setExternalChange(true);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [data, selectedFile]);

  const jsonValid = !isJson
    ? true
    : (() => {
        try {
          JSON.parse(text);
          return true;
        } catch {
          return false;
        }
      })();

  const save = async () => {
    if (!data || !selectedFile) return;
    try {
      const res = await call("config:write", selectedFile.id, text, data.sha256);
      setMessage({ kind: "ok", text: `저장 완료 (백업: ${res.backup})` });
      loadSelected(selectedFile.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMessage({ kind: "err", text: "충돌(409): 파일이 외부에서 변경되었습니다. 다시 불러오세요." });
        setExternalChange(true);
      } else {
        setMessage({ kind: "err", text: (e as Error).message });
      }
    }
  };

  const restore = async (backup: string) => {
    if (!selectedFile) return;
    const ok = await confirm({
      title: "이 백업으로 복원할까요?",
      message: `${backup}
현재 내용도 백업으로 남깁니다.`,
      confirmLabel: "복원",
    });
    if (!ok) return;
    try {
      await call("config:restore", selectedFile.id, backup);
      setMessage({ kind: "ok", text: "복원 완료" });
      loadSelected(selectedFile.id);
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    }
  };

  const prettify = () => {
    try {
      const p = JSON.stringify(JSON.parse(text), null, 2);
      setText(p);
      editorRef.current?.update({ text: p });
    } catch {
      setMessage({ kind: "err", text: "JSON 파싱 오류 — 정렬할 수 없습니다" });
    }
  };

  const dirty = data !== null && text !== data.content;
  const fileGroups =
    providerFilter === "all" ? groupRowsByProvider(files) : [{ provider: providerFilter as ProviderId, rows: files }];

  return (
    <div className="configs-page">
      {dialog}
      <PageHeader title="설정 편집기" meta={`${files.length}개 파일`} />
      <Tabs<ProviderFilter>
        label="provider"
        value={providerFilter}
        onChange={setProviderFilter}
        items={PROVIDER_FILTER_OPTIONS.map((option) => ({ id: option.value, label: option.label }))}
      />
      <div className="configs-files">
        {fileGroups.map((group) => (
          <div key={group.provider} className="configs-file-group">
            {providerFilter === "all" && (
              <div className="section-label">
                {providerGroupLabel(group.provider)} <span className="count">{group.rows.length}</span>
              </div>
            )}
            <div className="configs-file-buttons">
              {group.rows.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  className="btn ghost configs-file"
                  aria-pressed={selectedId === file.id}
                  onClick={() => setSelectedId(file.id)}
                  title={file.path}
                >
                  {file.label}
                  {!file.writable && <span className="muted"> (읽기 전용)</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {message && <Banner tone={message.kind}>{message.text}</Banner>}
      {externalChange && selectedFile && (
        <Banner tone="warn">
          파일이 외부에서 변경되었습니다.{" "}
          <button type="button" className="btn ghost" onClick={() => loadSelected(selectedFile.id)}>
            다시 불러오기
          </button>
        </Banner>
      )}

      {!selectedFile && <div className="muted">표시할 설정 파일이 없습니다.</div>}

      {data && selectedFile && (
        <div>
          {!data.descriptor.writable && (
            <Banner tone="warn">이 {providerLabel(data.descriptor.provider)} 설정 파일은 읽기 전용입니다.</Banner>
          )}
          <p className="muted mono">
            {data.descriptor.path} — {fmtDate(data.mtime)}
          </p>
          {isToml && <p className="muted">TOML 파일은 텍스트로 고치고, 저장할 때 구문을 검사합니다.</p>}
          {selectedFile.format === "json" ? (
            <JsonTreeEditor
              initialText={text}
              readOnly={!data.descriptor.writable}
              isDark={isDark}
              onChangeText={setText}
              apiRef={editorRef}
            />
          ) : (
            <TextConfigEditor value={text} readOnly={!data.descriptor.writable} onChange={setText} />
          )}
          <Toolbar>
            <button type="button" className="btn" onClick={save} disabled={!data.descriptor.writable || !dirty || !jsonValid}>
              저장
            </button>
            {isJson && (
              <button type="button" className="btn ghost" onClick={prettify} disabled={!data.descriptor.writable || !jsonValid}>
                정렬
              </button>
            )}
            {!jsonValid && <StatusTag tone="warn">JSON 파싱 오류 — 저장 불가</StatusTag>}
            {dirty && jsonValid && <StatusTag tone="muted">수정됨</StatusTag>}
          </Toolbar>

          {data.descriptor.writable && (
            <>
              <h3>백업 ({backups.length})</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th className="num">크기</th>
                    <th>시각</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.name}>
                      <td className="mono">{b.name}</td>
                      <td className="num">{fmtSize(b.size)}</td>
                      <td>{fmtDate(b.mtime)}</td>
                      <td>
                        <button type="button" className="btn ghost" onClick={() => restore(b.name)}>
                          복원
                        </button>
                      </td>
                    </tr>
                  ))}
                  {backups.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        백업 없음
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
