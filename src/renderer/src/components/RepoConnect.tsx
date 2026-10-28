import { FolderGit2 } from "lucide-react";
import { useEffect, useState } from "react";
import { call } from "../api/client";
import { Banner } from "./ui";

/**
 * 레포 클론을 찾지 못했을 때 상태판·설치·가져오기·위저드가 함께 보여 주는 연결 카드.
 * 기존 클론은 main이 스스로 찾으므로, 여기까지 왔다면 이 PC에 클론이 없다는 뜻이다. 그래서 "레포 받기" 한 번이 주 동작이다.
 */
export default function RepoConnect({ onConnected }: { onConnected: (repoRoot: string) => void }) {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState<"clone" | "choose" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call("repo:clone-target").then(setTarget).catch(() => setTarget(null));
  }, []);

  const act = async (kind: "clone" | "choose") => {
    setBusy(kind);
    setError(null);
    try {
      const repoRoot = kind === "clone" ? await call("repo:clone") : await call("capture:choose-repo");
      if (repoRoot) onConnected(repoRoot);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="repo-connect" aria-labelledby="repo-connect-title">
      <FolderGit2 className="repo-connect-icon" size={28} aria-hidden />
      <h3 id="repo-connect-title">레포를 연결하세요</h3>
      <p className="muted">
        앱 소스 개발이나 기존 레포 프로필 가져오기에 사용할 폴더를 연결합니다. 일반 프로필 관리·진단·설치에는 필요하지 않습니다.
      </p>
      <div className="repo-connect-actions">
        <button className="btn" onClick={() => void act("clone")} disabled={busy !== null}>
          {busy === "clone" ? "받는 중…" : "레포 받기"}
        </button>
        <button className="btn ghost" onClick={() => void act("choose")} disabled={busy !== null}>
          이미 있는 폴더 선택
        </button>
      </div>
      {target && <p className="repo-connect-target muted">GitHub에서 <span className="mono">{target}</span>에 받습니다.</p>}
      {error && <Banner tone="err">{error}</Banner>}
    </section>
  );
}
