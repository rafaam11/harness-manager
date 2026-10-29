// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkbenchSnapshot } from "@shared/workbench-types";
import { call } from "../api/client";
import Workbench from "./Workbench";

vi.mock("../api/client", () => ({ call: vi.fn() }));
const snapshot: WorkbenchSnapshot = { profile: { id: "mine", name: "내 설정", kind: "local" }, migrated: true, automatic: false, components: [], warnings: [], checkedAt: "2026-10-29T00:00:00Z" };
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async () => snapshot as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("allows navigation while the post-apply component list is still refreshing", async () => {
  let finish!: (value: WorkbenchSnapshot) => void;
  vi.mocked(call).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
  render(<Workbench />);
  await waitFor(() => expect(screen.getByRole("button", { name: "다시 확인" })).toBeDisabled());
  const proceed = vi.fn();
  const event = new CustomEvent("hm:before-navigate", { cancelable: true, detail: { proceed } });
  if (window.dispatchEvent(event)) proceed();
  expect(event.defaultPrevented).toBe(false);
  expect(proceed).toHaveBeenCalledOnce();
  await act(async () => finish(snapshot));
});

it("still asks before leaving an unapplied edit", async () => {
  render(<Workbench />);
  await waitFor(() => expect(screen.getByRole("button", { name: "다시 확인" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "새 스킬", hidden: true }));
  fireEvent.change(await screen.findByRole("textbox", { name: /^이름$/ }), { target: { value: "Draft" } });
  const proceed = vi.fn();
  let accepted = true;
  act(() => { accepted = window.dispatchEvent(new CustomEvent("hm:before-navigate", { cancelable: true, detail: { proceed } })); });
  expect(accepted).toBe(false);
  const dialog = await screen.findByRole("dialog", { name: "편집을 마칠까요?" });
  fireEvent.click(within(dialog).getByRole("button", { name: /^취소$/ }));
  expect(proceed).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: /^이름$/ })).toHaveValue("Draft");
});
