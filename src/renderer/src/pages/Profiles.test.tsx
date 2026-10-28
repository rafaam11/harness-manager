// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  await screen.findByLabelText("편집할 프로필 파일");
  fireEvent.change(screen.getByLabelText("편집할 프로필 파일"), {
    target: { value: "home/claude/settings.managed.json" },
  });
  fireEvent.change(screen.getByLabelText("모델"), { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: "저장 미리보기" }));
  await screen.findByText("old → new");
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
