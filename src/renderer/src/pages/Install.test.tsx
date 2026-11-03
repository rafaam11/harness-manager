// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InstallPlan } from "@shared/install-types";
import Install from "./Install";

const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../api/client", async (original) => ({ ...(await original<typeof import("../api/client")>()), call }));
// 복구 패널은 자체 IPC를 쓰고 이 화면의 표와 무관하다.
vi.mock("../components/RepairPanel", () => ({ default: () => null }));

const plan: InstallPlan = {
  repoRoot: "/repo",
  profile: "full",
  steps: [
    { id: "packages.winget.git", section: "toolchain", title: "Git", state: "missing", detail: "PATH에 없음", actionable: true, manual: false, actions: [{ kind: "command", summary: "winget install Git.Git" }] },
    { id: "packages.winget.gh", section: "toolchain", title: "GitHub CLI", state: "missing", detail: "PATH에 없음", actionable: true, manual: false, actions: [{ kind: "command", summary: "winget install GitHub.cli" }] },
    { id: "packages.winget.node", section: "toolchain", title: "Node", state: "ok", detail: "22.12", actionable: false, manual: false, actions: [] },
  ],
};

beforeEach(() => {
  call.mockReset();
  call.mockImplementation(async (channel: string) => {
    if (channel === "install:plan") return structuredClone(plan);
    if (channel === "install:run") return { results: [{ id: "packages.winget.git", outcome: "failed", after: "missing", detail: "winget 종료 코드 1" }], verify: [], cancelled: false };
    return {};
  });
  Object.defineProperty(window, "hm", { configurable: true, value: { on: vi.fn(() => vi.fn()) } });
});
afterEach(cleanup);

it("hides healthy steps and shows the rest in one table", async () => {
  render(<Install />);
  expect(await screen.findByRole("table")).toBeTruthy();
  expect(screen.getByText("정상 1 · 할 일 2")).toBeTruthy();
  expect(screen.getByRole("cell", { name: "Git" })).toBeTruthy();
  expect(screen.queryByRole("cell", { name: "Node" })).toBeNull();
});

it("sends only the chosen step ids, after confirmation", async () => {
  render(<Install />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Git 선택" }));
  expect(screen.getByText("선택 1 / 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "실행 (1)" }));

  const confirm = await screen.findByRole("dialog", { name: "1개 step을 실행할까요?" });
  expect(call).not.toHaveBeenCalledWith("install:run", expect.anything());
  fireEvent.click(within(confirm).getByRole("button", { name: "실행" }));

  await waitFor(() => expect(call).toHaveBeenCalledWith("install:run", ["packages.winget.git"]));
});

it("does not run when the confirmation is cancelled", async () => {
  render(<Install />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "실행할 수 있는 step 전체" }));
  fireEvent.click(screen.getByRole("button", { name: "실행 (2)" }));
  const confirm = await screen.findByRole("dialog", { name: "2개 step을 실행할까요?" });
  fireEvent.click(within(confirm).getByRole("button", { name: "취소" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(call).not.toHaveBeenCalledWith("install:run", expect.anything());
});
