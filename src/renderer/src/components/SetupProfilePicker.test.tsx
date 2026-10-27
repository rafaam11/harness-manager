// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SetupProfilePicker from "./SetupProfilePicker";
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../api/client", () => ({ call }));
afterEach(cleanup);
it("selects explicit profiles and creates a named copy without sending filesystem paths", async () => {
  const state = { activeId: "default", profiles: [
    { id: "default", name: "공통 기본", root: "/default", localDir: "/local", kind: "builtin" },
    { id: "legacy", name: "기존 jinmin", root: "/app", localDir: "/private", kind: "legacy" },
  ] };
  call.mockImplementation(async (channel, id) => channel === "profiles:select" ? { ...state, activeId: id } : state);
  const changed = vi.fn(); render(<SetupProfilePicker disabled={false} onChanged={changed} />);
  await screen.findByRole("option", { name: "공통 기본" });
  fireEvent.change(screen.getByLabelText("사용할 프로필"), { target: { value: "legacy" } });
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(call).toHaveBeenCalledWith("profiles:select", "legacy");
  fireEvent.change(screen.getByLabelText("새 프로필 이름"), { target: { value: "my-work" } });
  fireEvent.click(screen.getByRole("button", { name: "현재 프로필 복사" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("profiles:create", "my-work", "legacy"));
});
