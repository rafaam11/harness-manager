// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Profiles from "./Profiles";
import PrivateTerms from "../components/PrivateTerms";
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../api/client", () => ({ call }));
const profile = {
  id: "mine",
  name: "나의 환경",
  kind: "local",
  root: "/profile",
  localDir: "/local",
};
const document = {
  files: {
    "manifest/packages.json": '{"schemaVersion":1,"packages":[]}',
    "home/claude/settings.managed.json": '{"model":"old"}',
  },
  personal: {},
  portable: [],
  privateTerms: [],
};
beforeEach(() => {
  localStorage.clear();
  call.mockReset();
  call.mockImplementation(async (channel) => {
    if (channel === "repo:clone-target") return "/dev/harness-manager";
    if (channel === "profiles:list")
      return { activeId: "mine", profiles: [profile] };
    if (channel === "profiles:editor" || channel === "profiles:apply")
      return {
        profile,
        document: structuredClone(document),
        fingerprint: "original",
      };
    if (channel === "profiles:github-status")
      return {
        connected: false,
        available: false,
        detail: "GitHub 연결은 선택입니다",
      };
    if (channel === "profiles:preview")
      return {
        token: "preview",
        changes: [{ file: "model", diff: "old → new" }],
        notes: [],
      };
    if (channel === "profiles:terms") return { id: "mine", terms: [] };
    return {};
  });
  Object.defineProperty(window, "hm", {
    configurable: true,
    value: { on: vi.fn(() => vi.fn()) },
  });
});
afterEach(cleanup);
it("edits a profile through a preview without applying it to the PC", async () => {
  render(<Profiles navigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "관리 설정" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Claude 관리 설정" }),
  );
  expect(screen.getByRole("button", { name: "저장 미리보기" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("모델"), { target: { value: "new" } });
  expect(screen.getByText("저장하지 않은 변경 1개")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "저장 미리보기" }));
  const dialog = await screen.findByRole("dialog", { name: "저장 미리보기" });
  expect(dialog.textContent).toContain("old → new");
  expect(call).toHaveBeenCalledWith(
    "profiles:preview",
    "mine",
    "original",
    expect.objectContaining({
      files: expect.objectContaining({
        "home/claude/settings.managed.json": expect.stringContaining("new"),
      }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "변경 적용" }));
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("profiles:apply", "mine", "preview"),
  );
  expect(call.mock.calls.some(([channel]) => channel === "install:run")).toBe(
    false,
  );
});
it("treats a value changed back as no change and keeps the original file text", async () => {
  render(<Profiles navigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "관리 설정" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Claude 관리 설정" }),
  );
  fireEvent.change(screen.getByLabelText("모델"), { target: { value: "new" } });
  fireEvent.change(screen.getByLabelText("모델"), { target: { value: "old" } });
  expect(screen.getByText("변경 없음")).toBeTruthy();
  expect(screen.getByRole("button", { name: "저장 미리보기" })).toBeDisabled();
});
it("asks before leaving with unsaved edits and blocks profile switching", async () => {
  render(<Profiles navigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "관리 설정" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Claude 관리 설정" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("사용할 프로필")).not.toBeDisabled(),
  );
  fireEvent.change(screen.getByLabelText("모델"), { target: { value: "new" } });
  expect(screen.getByLabelText("사용할 프로필")).toBeDisabled();
  const proceed = vi.fn();
  const event = new CustomEvent("hm:before-navigate", {
    cancelable: true,
    detail: { proceed },
  });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  const guard = await screen.findByRole("dialog", {
    name: "프로필 편집을 마칠까요?",
  });
  fireEvent.click(
    within(guard).getByRole("button", { name: "편집 내용 버리기" }),
  );
  await waitFor(() => expect(proceed).toHaveBeenCalled());
});
it("keeps the portable selection on the personal file list and shows private terms there", async () => {
  render(<Profiles navigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "개인 설정" }));
  fireEvent.click(
    await screen.findByLabelText("Claude 개인 설정 다른 PC로 이동"),
  );
  expect(screen.getByText("저장하지 않은 변경 1개")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "비공개 낱말" }));
  expect(screen.getByLabelText("프로필 비공개 낱말")).toBeTruthy();
});
it("explains read-only profiles and sends the user to the manage tab", async () => {
  call.mockImplementation(async (channel) => {
    if (channel === "profiles:list")
      return {
        activeId: "default",
        profiles: [{ ...profile, id: "default", kind: "builtin" }],
      };
    if (channel === "profiles:editor")
      return {
        profile: { ...profile, id: "default", kind: "builtin" },
        document: structuredClone(document),
        fingerprint: "original",
      };
    if (channel === "profiles:github-status")
      return { connected: false, available: false, detail: "" };
    if (channel === "repo:clone-target") return "/dev/harness-manager";
    return {};
  });
  render(<Profiles navigate={vi.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "프로필 관리로 이동" }),
  );
  expect(screen.getByRole("tab", { name: "프로필 관리" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByLabelText("새 프로필 이름")).toBeTruthy();
});
it("allows an empty private-terms list without asking users to create JSON files", async () => {
  const saved = vi.fn();
  render(<PrivateTerms onSaved={saved} />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "낱말 목록 저장" }),
    ).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "낱말 목록 저장" }));
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("profiles:set-terms", "mine", []),
  );
  expect(saved).toHaveBeenCalled();
});
