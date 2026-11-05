import { useEffect, useRef, useState } from "react";
import type { ManagedComponent } from "@shared/workbench-types";
import type { ExampleLimits, ExamplePreview, ExampleResult, ExampleRecord } from "@shared/example-types";
import { call } from "../api/client";
import { Banner, Panel } from "./ui";

export function SkillExample({ item, scopeId }: { item: ManagedComponent; scopeId: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [provider, setProvider] = useState(item.observations[0]?.provider ?? "codex");
  const [generation, setGeneration] = useState<ExampleLimits>({ model: "", budgetUsd: 0.1, timeoutSeconds: 60 });
  const [execution, setExecution] = useState<ExampleLimits>({ model: "", budgetUsd: 0.1, timeoutSeconds: 60 });
  const [preview, setPreview] = useState<ExamplePreview | null>(null), [result, setResult] = useState<ExampleResult | null>(null);
  const [records, setRecords] = useState<ExampleRecord[]>([]); const running = useRef(false);
  useEffect(() => () => { if (running.current) void call("install:cancel"); }, []);
  const work = async (task: () => Promise<void>) => { running.current = true; setBusy(true); setError(""); try { await task(); } catch (e) { setError((e as Error).message); } finally { running.current = false; setBusy(false); } };
  const limitFields = (label: string, value: ExampleLimits, change: (value: ExampleLimits) => void) => <fieldset disabled={busy || Boolean(preview)}><legend>{label}</legend><label>모델<input aria-label={`${label} 모델`} value={value.model} placeholder="사용할 모델 ID" onChange={e => change({ ...value, model: e.target.value })} /></label><label>추정 비용 상한 (USD)<input type="number" min="0.01" max="5" step="0.01" value={value.budgetUsd} onChange={e => change({ ...value, budgetUsd: Number(e.target.value) })} /></label><label>시간 제한 (초)<input type="number" min="5" max="120" value={value.timeoutSeconds} onChange={e => change({ ...value, timeoutSeconds: Number(e.target.value) })} /></label></fieldset>;
  return <Panel head="예제 실행 검사"><button className="btn ghost" disabled={busy} onClick={() => { setOpen(!open); if (!open) void call("examples:records", item.id, scopeId).then(setRecords).catch(e => setError((e as Error).message)); }}>{open ? "예제 검사 닫기" : "예제 준비"}</button>{open && <>
    <p>스킬 본문과 샘플 입력을 선택한 모델에 보냅니다. 텍스트 예제만 지원하며 도구·MCP·외부 연결을 차단합니다. 비용은 CLI 추정치 기준으로 지정 금액을 넘을 수 있습니다.</p>
    <label>검사 CLI<select disabled={busy || Boolean(preview)} value={provider} onChange={e => setProvider(e.target.value as typeof provider)}>{item.observations.map(o => <option key={o.provider} value={o.provider}>{o.provider}</option>)}</select></label>
    {provider === "codex" && <Banner tone="warn">현재 Codex 어댑터는 모든 도구 차단을 보장할 수 없어 예제 실행을 지원하지 않습니다.</Banner>}
    {limitFields("예제 생성", generation, setGeneration)}{limitFields("예제 실행", execution, setExecution)}
    {error && <Banner tone="err">{error}</Banner>}
    {records.length > 0 && <details><summary>이 범위의 이전 예제 기록 {records.length}개</summary>{records.map((record, i) => <p key={i}>{new Date(record.result.at).toLocaleString("ko-KR")} · {record.provider} · {record.limits.model} · {record.result.detail}<br />검사 당시 지문: {record.result.fingerprint} · 현재 내용의 통과를 뜻하지 않습니다.</p>)}</details>}
    {!preview && <button className="btn" disabled={busy || provider !== "claude" || !generation.model || !execution.model} onClick={() => void work(async () => { setResult(null); setPreview(await call("examples:generate", { itemId: item.id, provider, scopeId, generation, execution })); })}>{busy ? "생성 중…" : "모델로 예제 생성"}</button>}
    {preview && <><h3>생성된 예제 검토</h3><p>{preview.plan.description}</p><dl className="pc-facts"><dt>샘플 입력</dt><dd>{preview.plan.input}</dd><dt>예상 산출물</dt><dd>{preview.plan.expectedArtifact}</dd><dt>검증 조건</dt><dd>{preview.plan.checks.map((check, i) => <p key={i}>포함 문자열: {check.text}</p>)}</dd><dt>실행 제한</dt><dd>{preview.execution.model} · ${preview.execution.budgetUsd} · {preview.execution.timeoutSeconds}초</dd><dt>스킬 지문</dt><dd>{preview.fingerprint}</dd></dl>{preview.limitations.map(text => <p className="muted" key={text}>{text}</p>)}<div className="pc-inline"><button className="btn ghost" disabled={busy} onClick={() => { setPreview(null); setResult(null); }}>다시 생성 준비</button><button className="btn" disabled={busy || Boolean(result)} onClick={() => void work(async () => setResult(await call("examples:execute", preview.token)))}>검토한 예제 실행</button></div></>}
    {busy && <button className="btn ghost" onClick={() => void call("install:cancel")}>예제 작업 취소</button>}
    {result && <><Banner tone={result.artifactVerified ? "ok" : "warn"}>{result.detail}</Banner><p>실행 종료: {result.exit} · 스킬 본문 제공: 확인 · Skill 도구 호출: 미검증</p>{result.checks.map((check, i) => <p key={i}>{check.passed ? "통과" : "실패"}: {check.text}</p>)}{result.artifact && <pre className="capture-diff">{result.artifact}</pre>}</>}
  </>}</Panel>;
}
