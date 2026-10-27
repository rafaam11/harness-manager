import type { ProviderId } from "@shared/provider-types";

// CLI 경계에서만 느슨한 JSON을 다루고, 화면에는 읽을 수 있는 이벤트만 전달한다.
type Json = Record<string, any>;
export interface AgentCallbacks {
  send(message: Json): void;
  log(stream: "stdout" | "stderr" | "info", text: string): void;
  approve(title: string, detail: string): Promise<boolean>;
  done(error?: string): void;
}

export function createAgentProtocol(provider: ProviderId, cwd: string, prompt: string, cb: AgentCallbacks) {
  let threadId = "";
  let finished = false;
  const items = new Map<string, Json>();
  const streamed = new Set<string>();
  const deltas = new Map<string, string>();
  const flush = (id: string) => { const text = deltas.get(id); if (text) cb.log("stdout", text); deltas.delete(id); };
  const finish = (error?: string) => { if (!finished) { finished = true; cb.done(error); } };
  const control = (id: string, response: Json) => cb.send({ type: "control_response", response: { subtype: "success", request_id: id, response } });
  return {
    start() {
      if (provider === "codex") cb.send({ id: 1, method: "initialize", params: { clientInfo: { name: "harness_manager", title: "Harness Manager", version: "1" } } });
      else cb.send({ type: "control_request", request_id: "hm-init", request: { subtype: "initialize", hooks: {} } });
    },
    async receive(message: Json) {
      if (finished) return;
      if (provider === "codex") {
        if (message.error && message.id !== undefined) { finish(String(message.error.message ?? "Codex 요청 실패")); return; }
        if (message.id === 1 && message.result) {
          cb.send({ method: "initialized", params: {} });
          cb.send({ id: 2, method: "thread/start", params: { cwd, approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "read-only", ephemeral: true } });
        } else if (message.id === 2 && message.result) {
          threadId = message.result.thread?.id;
          if (!threadId) { finish("Codex 대화를 시작하지 못했습니다"); return; }
          cb.send({ id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: prompt }] } });
        } else if (message.method && message.id !== undefined) {
          const params = message.params ?? {};
          if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method)) {
            const item = items.get(params.itemId);
            const detail = JSON.stringify({ ...params, ...(item ? { operation: item } : {}) }, null, 2);
            // 수정 diff/명령이 없는 요청은 사용자가 검토할 수 없다.
            const reviewable = message.method.includes("commandExecution") ? Boolean(params.command || item?.command || params.networkApprovalContext) : Boolean(item?.changes?.length);
            const allow = reviewable && await cb.approve(message.method.includes("commandExecution") ? "Codex 명령 실행" : "Codex 파일 수정", detail);
            cb.send({ id: message.id, result: { decision: allow ? "accept" : "decline" } });
          } else if (message.method === "item/permissions/requestApproval") {
            // 세션 전체 권한 확대 대신 개별 명령·수정 승인을 사용한다.
            cb.send({ id: message.id, result: { permissions: {}, scope: "turn" } });
          } else if (message.method === "item/tool/requestUserInput") {
            cb.log("info", "AI가 추가 설명을 요청했습니다. 작업 로그를 확인한 뒤 다시 요청하세요.");
            cb.send({ id: message.id, result: { answers: {} } });
          } else cb.send({ id: message.id, error: { code: -32601, message: "HM에서 지원하지 않는 요청입니다. 승인하지 않았습니다." } });
        } else if (message.method === "item/started" || message.method === "item/completed") {
          const item = message.params?.item;
          if (!item) return;
          if (item.type === "fileChange" || item.type === "commandExecution") {
            items.set(item.id, item);
            if (message.method === "item/started") cb.log("info", item.command ?? JSON.stringify(item.changes));
            else items.delete(item.id);
          }
          if (message.method === "item/completed") {
            flush(item.id);
            if (item.type === "agentMessage" && !streamed.has(item.id)) cb.log("stdout", item.text ?? "");
            streamed.delete(item.id);
          }
        } else if (["item/commandExecution/outputDelta", "item/agentMessage/delta"].includes(message.method)) {
          const id = message.params?.itemId ?? "output";
          streamed.add(id);
          deltas.set(id, (deltas.get(id) ?? "") + (message.params?.delta ?? ""));
          if (deltas.get(id)!.includes("\n") || deltas.get(id)!.length >= 256) flush(id);
        } else if (message.method === "turn/completed") {
          const turn = message.params?.turn;
          for (const id of deltas.keys()) flush(id);
          finish(turn?.status === "completed" ? undefined : turn?.error?.message ?? `Codex 작업 종료: ${turn?.status ?? "unknown"}`);
        } else if (message.method === "error") cb.log("stderr", message.params?.error?.message ?? "Codex 오류");
      } else {
        if (message.type === "control_response" && message.response?.request_id === "hm-init") {
          if (message.response.subtype !== "success") { finish(String(message.response.error ?? "Claude 초기화 실패")); return; }
          cb.send({ type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null, session_id: "" });
        } else if (message.type === "control_request") {
          const request = message.request ?? {};
          if (request.subtype === "can_use_tool") {
            const allowed = ["Bash", "PowerShell", "Read", "Glob", "Grep", "Edit", "Write"].includes(request.tool_name) &&
              await cb.approve(`Claude Code · ${request.tool_name}`, JSON.stringify(request.input, null, 2));
            control(message.request_id, allowed ? { behavior: "allow", updatedInput: request.input } : { behavior: "deny", message: "사용자가 승인하지 않았습니다. 다른 방법을 찾거나 필요한 수동 조치를 설명하세요." });
          } else cb.send({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: "지원하지 않는 요청입니다" } });
        } else if (message.type === "assistant") {
          for (const block of message.message?.content ?? []) {
            if (block.type === "text") cb.log("stdout", block.text);
            if (block.type === "tool_use") cb.log("info", `${block.name}: ${JSON.stringify(block.input)}`);
          }
        } else if (message.type === "user") {
          for (const block of message.message?.content ?? []) if (block.type === "tool_result") cb.log(block.is_error ? "stderr" : "stdout", typeof block.content === "string" ? block.content : JSON.stringify(block.content));
        } else if (message.type === "result") {
          if (message.result) cb.log("stdout", message.result);
          finish(message.is_error || message.subtype !== "success" ? (message.errors ?? [message.result ?? message.subtype]).join("\n") : undefined);
        }
      }
    },
  };
}
