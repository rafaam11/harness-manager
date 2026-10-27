// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RepairEvent, RepairSnapshot } from "@shared/repair-types";
import RepairPanel from "./RepairPanel";
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../api/client", () => ({ call }));
let listener: (event: RepairEvent) => void;
const idle: RepairSnapshot = { running: false, phase: "idle", provider: null, stepId: null, round: 0, detail: "", approvals: [], lines: [] };
beforeEach(() => {
  call.mockReset();
  call.mockImplementation(async (channel) => channel === "repair:status" ? idle : channel === "repair:providers" ? [{ id: "codex", available: true, detail: "ok" }, { id: "claude", available: false, detail: "Claude 설치 필요" }] : undefined);
  Object.defineProperty(window, "hm", { configurable: true, value: { on: vi.fn((_channel, cb) => { listener = cb; return vi.fn(); }) } });
});
afterEach(cleanup);

it("shows both provider buttons, confirms the context sharing, and sends only ids", async () => {
  const busy = vi.fn();
  render(<RepairPanel targets={[{ id: "tools.codex", title: "Codex 설치" }]} disabled={false} onBusyChange={busy} onResult={vi.fn()} />);
  const codex = screen.getByRole("button", { name: "Codex에게 해결 요청" });
  await waitFor(() => expect((codex as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByRole("button", { name: "Claude Code에게 해결 요청" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(codex);
  await screen.findByRole("dialog");
  call.mockImplementation(async (channel) => channel === "repair:run" ? { ...idle, phase: "failed", stepId: "tools.codex", provider: "codex", detail: "로그 확인" } : undefined);
  fireEvent.click(screen.getByRole("button", { name: /^해결 요청$/ }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("repair:run", "tools.codex", "codex"));
});

it("renders live output and pending approval, and exposes reject and cancellation actions", async () => {
  render(<RepairPanel targets={[]} disabled={false} onBusyChange={vi.fn()} onResult={vi.fn()} />);
  await act(async () => { listener({ type: "state", state: { ...idle, running: true, provider: "claude", stepId: "tools.codex", phase: "approval", round: 1, detail: "승인 필요", approvals: [{ id: "nonce", title: "명령 실행", detail: "node --version" }], lines: [] } }); });
  await act(async () => { listener({ type: "log", line: { id: 1, stream: "stdout", text: "현재 상태 확인 중" } }); });
  expect(screen.getByText("현재 상태 확인 중", { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "거절" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("repair:respond", "nonce", false));
  fireEvent.click(screen.getByRole("button", { name: "복구 중단" }));
  expect(call).toHaveBeenCalledWith("repair:cancel");
});
