// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExtensionDescriptor } from "@shared/cli-settings-types";
import { call } from "../api/client";
import CliExtensionsExplorer from "./CliExtensionsExplorer";

vi.mock("../api/client", () => ({ call: vi.fn() }));
const extensions: ExtensionDescriptor[] = [{ id: "hud@jinmin", provider: "claude", title: "상황판", description: "", installed: false, enabled: null, managed: false, detail: "", options: [{ id: "rows", provider: "claude", path: ["pluginConfigs", "hud@jinmin", "options", "rows"], title: "줄 수", category: "확장 옵션", description: "", type: "number", schema: { type: "number" }, defaultDescription: "4", source: "userConfig", managed: false }] }];
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  sessionStorage.clear(); sessionStorage.setItem("extensions-selected-claude", "hud@jinmin");
  vi.mocked(call).mockReset(); vi.mocked(call).mockResolvedValue(extensions as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

it("protects unsaved options but permits navigation while saved options reload", async () => {
  const props = { provider: "claude" as const, revision: 0, onPlan: vi.fn() };
  const view = render(<CliExtensionsExplorer {...props} />);
  fireEvent.change(await screen.findByRole("spinbutton", { name: "줄 수" }), { target: { value: "6" } });
  let unsaved!: Event;
  act(() => { unsaved = new CustomEvent("hm:before-navigate", { cancelable: true, detail: { proceed: vi.fn() } }); window.dispatchEvent(unsaved); });
  expect(unsaved.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /^취소$/ }));
  let finish!: (value: ExtensionDescriptor[]) => void;
  vi.mocked(call).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
  view.rerender(<CliExtensionsExplorer {...props} revision={1} />);
  const saved = new CustomEvent("hm:before-navigate", { cancelable: true, detail: { proceed: vi.fn() } });
  act(() => { window.dispatchEvent(saved); });
  expect(saved.defaultPrevented).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /^닫기$/ }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => finish(extensions));
});
