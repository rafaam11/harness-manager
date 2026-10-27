import { describe, expect, it, vi } from "vitest";
import { createAgentProtocol } from "./protocol.js";

function callbacks() { return { send: vi.fn(), log: vi.fn(), approve: vi.fn(async () => false), done: vi.fn() }; }
describe("Codex app-server recovery", () => {
  it("uses user approval and read-only sandbox, sending prompts over JSON stdin", async () => {
    const cb = callbacks();
    const protocol = createAgentProtocol("codex", "C:\\repo", "a & untrusted log", cb);
    protocol.start();
    await protocol.receive({ id: 1, result: {} });
    expect(cb.send).toHaveBeenCalledWith(expect.objectContaining({ method: "thread/start", params: expect.objectContaining({ approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "read-only" }) }));
    await protocol.receive({ id: 2, result: { thread: { id: "t1" } } });
    expect(cb.send).toHaveBeenLastCalledWith(expect.objectContaining({ method: "turn/start", params: { threadId: "t1", input: [{ type: "text", text: "a & untrusted log" }] } }));
  });

  it("never turns rejection into approval, never grants session-wide permissions, and requires full file diffs", async () => {
    const cb = callbacks(); const protocol = createAgentProtocol("codex", "/repo", "prompt", cb);
    await protocol.receive({ id: 80, method: "item/commandExecution/requestApproval", params: { itemId: "x", command: "winget uninstall Node" } });
    expect(cb.send).toHaveBeenLastCalledWith({ id: 80, result: { decision: "decline" } });
    cb.approve.mockResolvedValue(true);
    await protocol.receive({ id: 81, method: "item/fileChange/requestApproval", params: { itemId: "missing" } });
    expect(cb.send).toHaveBeenLastCalledWith({ id: 81, result: { decision: "decline" } });
    await protocol.receive({ method: "item/started", params: { item: { id: "file", type: "fileChange", changes: [{ path: "a", diff: "+change" }] } } });
    await protocol.receive({ id: 82, method: "item/fileChange/requestApproval", params: { itemId: "file" } });
    expect(cb.send).toHaveBeenLastCalledWith({ id: 82, result: { decision: "accept" } });
    expect(cb.approve).toHaveBeenLastCalledWith("Codex 파일 수정", expect.stringContaining("+change"));
    await protocol.receive({ id: 83, method: "item/permissions/requestApproval", params: { permissions: { network: true } } });
    expect(cb.send).toHaveBeenLastCalledWith({ id: 83, result: { permissions: {}, scope: "turn" } });
  });

  it("streams text and reports failed/interrupted turns as failures", async () => {
    const cb = callbacks(); const protocol = createAgentProtocol("codex", "/repo", "prompt", cb);
    await protocol.receive({ method: "item/agentMessage/delta", params: { itemId: "m", delta: "진단 중\n" } });
    expect(cb.log).toHaveBeenCalledWith("stdout", "진단 중\n");
    await protocol.receive({ method: "turn/completed", params: { turn: { status: "failed", error: { message: "login required" } } } });
    expect(cb.done).toHaveBeenCalledWith("login required");
  });
});

describe("Claude Code stream-json recovery", () => {
  it("waits for initialization, preserves exact tool input on one-time approval, denies unknown tools", async () => {
    const cb = callbacks(); cb.approve.mockResolvedValue(true);
    const protocol = createAgentProtocol("claude", "/repo", "prompt", cb);
    protocol.start();
    await protocol.receive({ type: "control_response", response: { request_id: "hm-init", subtype: "success" } });
    expect(cb.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "user", message: { role: "user", content: "prompt" } }));
    const input = { command: "node --version" };
    await protocol.receive({ type: "control_request", request_id: "p", request: { subtype: "can_use_tool", tool_name: "Bash", input } });
    expect(cb.send).toHaveBeenLastCalledWith({ type: "control_response", response: { subtype: "success", request_id: "p", response: { behavior: "allow", updatedInput: input } } });
    await protocol.receive({ type: "control_request", request_id: "q", request: { subtype: "can_use_tool", tool_name: "Agent", input } });
    expect(cb.send.mock.lastCall?.[0].response.response.behavior).toBe("deny");
    expect(cb.approve).toHaveBeenCalledTimes(1);
  });

  it("propagates permission denial and login/result errors", async () => {
    const cb = callbacks(); const protocol = createAgentProtocol("claude", "/repo", "prompt", cb);
    await protocol.receive({ type: "control_request", request_id: "p", request: { subtype: "can_use_tool", tool_name: "Write", input: { file_path: "x", content: "y" } } });
    expect(cb.send.mock.lastCall?.[0].response.response.behavior).toBe("deny");
    await protocol.receive({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["login required"] });
    expect(cb.done).toHaveBeenCalledWith("login required");
  });
});
