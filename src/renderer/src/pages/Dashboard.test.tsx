// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../api/client", () => ({ call }));
afterEach(cleanup);
it("summarizes doctor states and opens the selected section", async () => {
  call.mockResolvedValue({ generatedAt: "2026-01-01T00:00:00Z", profile: "full", cards: [
    { section: "claude", label: "Claude Code", state: "ok", summary: "ready", checks: [] },
    { section: "mcp", label: "MCP", state: "fail", summary: "missing", checks: [{ id: "server", title: "Server", state: "missing", detail: "unavailable" }] },
  ] });
  render(<Dashboard />);
  const summary = await screen.findByLabelText("환경 상태 요약");
  expect(within(summary).getByText("정상").previousSibling).toHaveTextContent("1");
  expect(within(summary).getByText("누락").previousSibling).toHaveTextContent("1");
  const card = screen.getByText("missing").closest("section")!;
  fireEvent.click(within(card).getByRole("button"));
  expect(screen.getByText("Server")).toBeInTheDocument();
});
