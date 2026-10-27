// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RepairEvent, RepairSnapshot } from "@shared/repair-types";
import RepairPanel from "./RepairPanel";
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../api/client", () => ({ call }));
let listener: (event: RepairEvent) => void;
const job: RepairSnapshot = { jobId: "job1", running: true, phase: "agent", provider: "codex", stepId: "claude.settings", round: 1, detail: "진단 중", lines: [] };
beforeEach(() => {
  call.mockReset();
  call.mockImplementation(async (channel) => channel === "repair:status" ? { jobs: [], maxParallel: 3 } : channel === "repair:providers" ? [{ id: "codex", available: true, detail: "ok" }, { id: "claude", available: false, detail: "Claude 설치 필요" }] : job);
  Object.defineProperty(window, "hm", { configurable: true, value: { on: vi.fn((_channel, cb) => { listener = cb; return vi.fn(); }) } });
});
afterEach(cleanup);

it("explains YOLO mode and sends only the selected ids", async () => {
  render(<RepairPanel targets={[{ id: "claude.settings", title: "Claude 설정" }]} disabled={false} onBusyChange={vi.fn()} onResult={vi.fn()} />);
  const codex = screen.getByRole("button", { name: "Codex에게 해결 요청" });
  await waitFor(() => expect((codex as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByRole("button", { name: "Claude Code에게 해결 요청" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(codex);
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "YOLO로 해결 요청" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("repair:run", "claude.settings", "codex"));
});
it("keeps other targets enabled, separates live logs, and cancels only one job", async () => {
  render(<RepairPanel targets={[{ id: "claude.settings", title: "Claude 설정" }, { id: "codex.config", title: "Codex 설정" }]} disabled={false} onBusyChange={vi.fn()} onResult={vi.fn()} />);
  await act(async () => { listener({ type: "state", state: job }); });
  await act(async () => { listener({ type: "log", jobId: job.jobId, line: { id: 1, stream: "stdout", text: "현재 상태 확인 중" } }); });
  expect(screen.getByText("현재 상태 확인 중", { exact: false })).toBeTruthy();
  const buttons = screen.getAllByRole("button", { name: "Codex에게 해결 요청" }) as HTMLButtonElement[];
  expect(buttons.map((button) => button.disabled)).toEqual([true, false]);
  fireEvent.click(screen.getByRole("button", { name: "이 복구 중단" }));
  expect(call).toHaveBeenCalledWith("repair:cancel", "job1");
  await act(async () => { listener({ type: "reset" }); });
  expect(screen.queryByText("현재 상태 확인 중", { exact: false })).toBeNull();
});
