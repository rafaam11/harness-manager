import { useEffect, useState } from "react";
import type { SetupProfiles } from "@shared/setup-profile-types";
import { call } from "../api/client";
export default function ActiveProfile({ onChanged }: { onChanged(): void }) {
  const [profiles, setProfiles] = useState<SetupProfiles | null>(null); const [error, setError] = useState("");
  useEffect(() => { const load = () => { void call("profiles:list").then(setProfiles).catch(e => setError(e.message)); }; load(); window.addEventListener("hm:profile-changed", load); return () => window.removeEventListener("hm:profile-changed", load); }, []);
  return <div className="wb-profile-bar"><strong>이 PC</strong><span className="muted">전역 환경</span><label>프로필 <select aria-label="현재 프로필" value={profiles?.activeId ?? "default"} disabled={!profiles} onChange={e => { void call("profiles:select", e.target.value).then(() => { setError(""); onChanged(); }).catch(e => setError(e.message)); }}>{profiles?.profiles.filter(p => !p.archived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{error && <span role="alert">{error}</span>}</div>;
}
