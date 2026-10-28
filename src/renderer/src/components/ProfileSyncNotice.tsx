import { useEffect } from "react";
import { call } from "../api/client";
import { showToast } from "./toast";

export default function ProfileSyncNotice() {
  useEffect(() => {
    let alive = true;
    void call("profiles:list")
      .then((profiles) => call("profiles:github-status", profiles.activeId))
      .then((state) => {
        if (alive && state.connected && (state.changed || !state.available))
          showToast({
            tone: "warning",
            title: "프로필 동기화 확인",
            detail: state.detail,
          });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return null;
}
