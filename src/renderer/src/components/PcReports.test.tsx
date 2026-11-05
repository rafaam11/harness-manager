// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PcStatusReport } from "@shared/pc-status-types";
import { call } from "../api/client";
import { PcReports } from "./PcReports";
vi.mock("../api/client", () => ({ call: vi.fn() }));
const report: PcStatusReport = { format: "harness-manager-pc-status", version: 1, pcId: "8b468635-0baf-420a-b7bc-e6fd10f4bfa0", alias: "Desk", reportedAt: "2026-11-05T00:00:00Z", cliVersions: { codex: "0.166.0" }, items: [{ id: "a".repeat(64), provider: "codex", kind: "skill", name: "summary", version: "1.0.0", recognition: "confirmed", enabled: true, managed: false, stale: false, source: { pluginId: "summary@market" } }] };
beforeEach(() => {
  vi.mocked(call).mockReset().mockImplementation(async (channel, ..._args: unknown[]) => {
    if (channel === "pc-status:list") return [report] as never;
    if (channel === "pc-status:current") return { ...report, items: [{ ...report.items[0], version: "2.0.0", managed: true }] } as never;
    if (channel === "pc-status:preview") return { token: "reviewed-token", report } as never;
    return undefined as never;
  });
});
afterEach(cleanup);
it("compares the last remote report with current evidence and links to plugin management", async () => {
  const inspect = vi.fn(); render(<PcReports connected onInspectPlugin={inspect} />);
  expect(call).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "다른 PC 보고 받기" }));
  expect(await screen.findByText(/버전 차이/)).toBeVisible();
  expect(screen.getByText(/공유 기준 포함 여부 차이/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "플러그인 관리 열기" }));
  expect(inspect).toHaveBeenCalledWith("codex", "summary@market");
  expect(call).not.toHaveBeenCalledWith("pc-status:send", expect.anything());
});
it("requires an explicit alias, preview and separate send action", async () => {
  render(<PcReports connected />);
  const review = screen.getByRole("button", { name: "전송 내용 검토" }); expect(review).toBeDisabled();
  fireEvent.change(screen.getByLabelText("공유할 PC 별칭"), { target: { value: "Desk" } });
  fireEvent.click(review);
  const send = await screen.findByRole("button", { name: "검토한 PC 상태 보내기" });
  expect(call).not.toHaveBeenCalledWith("pc-status:send", expect.anything());
  fireEvent.click(send);
  await waitFor(() => expect(call).toHaveBeenCalledWith("pc-status:send", "reviewed-token"));
  expect(await screen.findByText(/이 PC의 마지막 상태를 보냈습니다/)).toBeVisible();
});
it("does not offer remote report operations before a private repository is connected", () => {
  render(<PcReports connected={false} />);
  expect(screen.getByRole("button", { name: "다른 PC 보고 받기" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "전송 내용 검토" })).toBeDisabled();
});
