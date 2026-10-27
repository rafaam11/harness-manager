import { expect, it, vi } from "vitest";
import { createAgentProtocol } from "./protocol.js";
const callbacks = () => ({ send: vi.fn(), log: vi.fn(), done: vi.fn() });

it("streams Codex exec command output and completes once", async () => {
  const cb = callbacks(); const protocol = createAgentProtocol("codex", "prompt", cb);
  await protocol.receive({ type: "item.started", item: { type: "command_execution", command: "node --version" } });
  await protocol.receive({ type: "item.completed", item: { type: "command_execution", aggregated_output: "v22", exit_code: 0 } });
  await protocol.receive({ type: "item.completed", item: { type: "agent_message", text: "확인 완료" } });
  await protocol.receive({ type: "turn.completed" });
  await protocol.receive({ type: "turn.failed", error: { message: "late error" } });
  expect(cb.log.mock.calls).toEqual([["info", "node --version"], ["stdout", "v22"], ["stdout", "확인 완료"]]);
  expect(cb.done).toHaveBeenCalledExactlyOnceWith(undefined);
});
it("reports Codex failure instead of treating process output as success", async () => {
  const cb = callbacks(); const protocol = createAgentProtocol("codex", "prompt", cb);
  await protocol.receive({ type: "turn.failed", error: { message: "login required" } });
  expect(cb.done).toHaveBeenCalledWith("login required");
});
it("initializes Claude and sends the exact prompt through stdin JSON", async () => {
  const cb = callbacks(); const protocol = createAgentProtocol("claude", "한글 & prompt", cb);
  protocol.start();
  await protocol.receive({ type: "control_response", response: { request_id: "hm-init", subtype: "success" } });
  expect(cb.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "user", message: { role: "user", content: "한글 & prompt" } }));
  await protocol.receive({ type: "result", subtype: "success", is_error: false, result: "done" });
  expect(cb.done).toHaveBeenCalledWith(undefined);
});
it("does not fabricate approval if Claude requires an interactive request despite bypass mode", async () => {
  const cb = callbacks(); const protocol = createAgentProtocol("claude", "prompt", cb);
  await protocol.receive({ type: "control_request", request_id: "p", request: { subtype: "can_use_tool" } });
  expect(cb.send.mock.lastCall?.[0].response.subtype).toBe("error");
  await protocol.receive({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["login required"] });
  expect(cb.done).toHaveBeenCalledWith("login required");
});
