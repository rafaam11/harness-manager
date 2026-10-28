import { useEffect, useState } from "react";
import { call } from "../api/client";
import { Banner, Panel, Toolbar } from "./ui";

export default function PrivateTerms({
  refreshKey,
  onSaved,
}: {
  refreshKey?: number;
  onSaved(): void;
}) {
  const [id, setId] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void call("profiles:terms")
      .then((value) => {
        setId(value.id);
        setText(value.terms.join("\n"));
        setError(value.issue ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, [refreshKey]);
  const save = async () => {
    setBusy(true);
    try {
      await call(
        "profiles:set-terms",
        id,
        text
          .split(/\r?\n/)
          .map((v) => v.trim())
          .filter(Boolean),
      );
      setError("");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel head={<span className="panel-title">비공개 낱말</span>}>
      <p className="muted">
        회사명 등 공개하면 안 되는 낱말을 한 줄에 하나씩 입력하세요. 없으면 비워
        두어도 됩니다. 목록 파일은 앱이 관리하며 인증 정보 검사는 별도로
        유지합니다.
      </p>
      {error && <Banner tone="err">{error}</Banner>}
      <textarea
        aria-label="비공개 낱말"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <Toolbar>
        <button
          className="btn ghost"
          disabled={busy || !id}
          onClick={() => void save()}
        >
          낱말 목록 저장
        </button>
      </Toolbar>
    </Panel>
  );
}
