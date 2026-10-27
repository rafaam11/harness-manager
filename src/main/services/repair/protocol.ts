import type { ProviderId } from "@shared/provider-types";

// CLI 경계에서만 느슨한 JSON을 다루고, 화면에는 읽을 수 있는 이벤트만 전달한다.
type Json = Record<string, any>;
export interface AgentCallbacks {
  send(message: Json): void;
  log(stream: "stdout" | "stderr" | "info", text: string): void;
  done(error?: string): void;
}

export function createAgentProtocol(provider: ProviderId, prompt: string, cb: AgentCallbacks) {
  let finished = false;
  const finish = (error?: string) => { if (!finished) { finished = true; cb.done(error); } };
  return {
    start() {
      if (provider === "claude") cb.send({ type: "control_request", request_id: "hm-init", request: { subtype: "initialize", hooks: {} } });
    },
    async receive(message: Json) {
      if (finished) return;
      if (provider === "codex") {
        const item = message.item;
        if (item && ["item.started", "item.completed"].includes(message.type)) {
          if (item.type === "command_execution" && message.type === "item.started") cb.log("info", item.command ?? "명령 실행");
          if (message.type === "item.completed") {
            if (item.type === "agent_message") cb.log("stdout", item.text ?? "");
            if (item.type === "command_execution" && item.aggregated_output) cb.log(item.exit_code ? "stderr" : "stdout", item.aggregated_output);
            if (item.type === "file_change") cb.log("info", JSON.stringify(item.changes ?? []));
          }
        } else if (message.type === "turn.completed") finish();
        else if (message.type === "turn.failed") finish(message.error?.message ?? "Codex 작업 실패");
        else if (message.type === "error") cb.log("stderr", message.message ?? "Codex 오류");
      } else {
        if (message.type === "control_response" && message.response?.request_id === "hm-init") {
          if (message.response.subtype !== "success") { finish(String(message.response.error ?? "Claude 초기화 실패")); return; }
          cb.send({ type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null, session_id: "" });
        } else if (message.type === "control_request") {
          // 조직 정책 등으로 bypass가 허용되지 않는 경우 승인했다고 가장하지 않는다.
          cb.send({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: "자동 복구에서 대화형 요청을 처리할 수 없습니다" } });
          cb.log("info", "CLI가 대화형 요청을 보냈습니다. 로그인 또는 조직 정책을 확인하세요.");
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
