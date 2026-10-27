import type { UpdaterStatus } from "@shared/api-types";
import { UPDATER_EVENT_CHANNEL } from "@shared/api-types";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { call } from "../api/client";

export function updaterStatusLabel(status: UpdaterStatus): string {
  switch (status.state) {
    case "checking":
      return "업데이트 확인 중";
    case "available":
      return `${status.version} 내려받는 중`;
    case "downloading":
      return `다운로드 ${status.percent}%`;
    case "downloaded":
      return `${status.version} 설치 준비 완료`;
    case "error":
      return "업데이트 확인 실패";
    default:
      return "최신 버전";
  }
}

/**
 * 타이틀바의 버전 배지와 업데이트 버튼. 새 버전은 배경에서 차등 다운로드되고,
 * 끝나면 버튼이 "재시작"으로 바뀐다. 확인에 실패하면 릴리스 페이지로 가는 길을 준다.
 */
export function UpdateBadge() {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<UpdaterStatus>({ state: "idle" });

  useEffect(() => {
    void call("app:version").then(setVersion).catch(() => undefined);
    // 첫 확인은 이 컴포넌트가 붙기 전에 시작되므로, 이벤트를 기다리지 않고 현재 상태부터 읽는다.
    void call("updater:status").then(setStatus).catch(() => undefined);
    return window.hm.on(UPDATER_EVENT_CHANNEL, setStatus);
  }, []);

  const downloaded = status.state === "downloaded";
  const busy = status.state === "checking" || status.state === "downloading";

  return (
    <div className="update-badge">
      <RefreshCw size={12} className={busy ? "spinning" : undefined} aria-hidden="true" />
      <span className="app-version">{version ? `v${version}` : ""}</span>
      <span className={`update-status ${status.state}`}>{updaterStatusLabel(status)}</span>
      {status.state === "error" ? (
        <button type="button" title="GitHub 릴리스에서 최신 버전을 직접 받는다" onClick={() => void call("app:open-releases")}>
          릴리스
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          title={downloaded ? "앱을 재시작해 새 버전을 설치한다" : "업데이트 확인"}
          onClick={() => void (downloaded ? call("updater:install") : call("updater:check"))}
        >
          {downloaded ? "재시작" : "확인"}
        </button>
      )}
    </div>
  );
}
