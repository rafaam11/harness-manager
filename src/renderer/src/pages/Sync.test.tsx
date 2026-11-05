// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProfileSyncPreview, ProfileSyncStatus } from "@shared/setup-profile-types";
import type { WorkbenchPlan } from "@shared/workbench-types";
import { ApiError } from "../api/client";
import Sync from "./Sync";

const { call } = vi.hoisted(() => ({ call: vi.fn() }));
// ApiError는 실제 클래스를 써야 화면의 instanceof 판정을 검증할 수 있다.
vi.mock("../api/client", async (original) => ({ ...(await original<typeof import("../api/client")>()), call }));

const connected: ProfileSyncStatus = { connected: true, available: true, repository: "me/private", account: "me", detail: "원격 변경 없음", changed: true, outgoing: false };
const plan: WorkbenchPlan = { token: "receive-token", title: "다른 PC의 변경 받기", files: [], notes: [], commands: [], automatic: false, scope: "settings-and-pc" };
const conflicted: ProfileSyncPreview = { token: "conflict-token", changes: [], notes: [], conflicts: ["manifest/plugins.json"], direction: "receive" };

let status: ProfileSyncStatus;
let receive: () => WorkbenchPlan;
let syncPlan: () => ProfileSyncPreview;
let logListener: ((event: { text: string }) => void) | undefined;

beforeEach(() => {
  status = connected;
  receive = () => plan;
  syncPlan = () => conflicted;
  logListener = undefined;
  call.mockReset();
  call.mockImplementation(async (channel: string) => {
    if (channel === "profiles:list") return { activeId: "mine", profiles: [] };
    if (channel === "profiles:github-status") return status;
    if (channel === "changes:receive") return receive();
    if (channel === "changes:resolved-receive") return plan;
    if (channel === "profiles:sync-plan") return syncPlan();
    if (channel === "profiles:sync") return { ...connected, changed: false };
    return {};
  });
  Object.defineProperty(window, "hm", {
    configurable: true,
    value: { on: vi.fn((_channel: string, listener: (event: { text: string }) => void) => { logListener = listener; return vi.fn(); }) },
  });
});
afterEach(cleanup);

const noop = vi.fn();
const renderSync = (navigate = noop) => render(<Sync navigate={navigate} />);
const receiveButton = async () => {
  const button = await screen.findByRole("button", { name: "다른 PC의 변경 받기" });
  await waitFor(() => expect(button).not.toBeDisabled());
  return button;
};

it("applies a conflict-free receive to the PC through the workbench", async () => {
  renderSync();
  fireEvent.click(await receiveButton());
  const review = await screen.findByRole("dialog", { name: "변경 검토" });
  expect(call).not.toHaveBeenCalledWith("profiles:sync-plan", "mine", "receive");
  fireEvent.click(within(review).getByRole("button", { name: "이 PC에 적용" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("workbench:apply", "receive-token"));
  expect(call).not.toHaveBeenCalledWith("profiles:sync", expect.anything(), expect.anything(), expect.anything());
});

it("reviews PC changes after conflict resolution before writing the merged baseline", async () => {
  receive = () => { throw new ApiError(409, "같은 파일이 양쪽에서 바뀌었습니다"); };
  const navigate = vi.fn();
  renderSync(navigate);
  fireEvent.click(await receiveButton());

  const dialog = await screen.findByRole("dialog", { name: "동기화 미리보기" });
  // 충돌 대화상자가 답이므로 409 원문을 페이지에 또 띄우지 않는다.
  expect(screen.queryByText("같은 파일이 양쪽에서 바뀌었습니다")).toBeNull();
  const apply = within(dialog).getByRole("button", { name: "변경 적용" });
  expect(apply).toBeDisabled();

  fireEvent.change(within(dialog).getByLabelText("manifest/plugins.json 충돌 선택"), { target: { value: "remote" } });
  expect(apply).not.toBeDisabled();
  fireEvent.click(apply);

  await waitFor(() => expect(call).toHaveBeenCalledWith("changes:resolved-receive", "mine", "conflict-token", { "manifest/plugins.json": "remote" }));
  expect(call).not.toHaveBeenCalledWith("workbench:apply", expect.anything());
  expect(screen.queryByRole("dialog", { name: "동기화 미리보기" })).toBeNull();

  const review = await screen.findByRole("dialog", { name: "변경 검토" });
  expect(call).not.toHaveBeenCalledWith("profiles:sync", expect.anything(), expect.anything(), expect.anything());
  fireEvent.click(within(review).getByRole("button", { name: "이 PC에 적용" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("workbench:apply", "receive-token"));
  expect(navigate).not.toHaveBeenCalled();
});

it("shows the original error when a 409 has no conflict to choose", async () => {
  receive = () => { throw new ApiError(409, "원격 프로필이 없습니다. 먼저 보내기를 실행하세요."); };
  syncPlan = () => ({ ...conflicted, conflicts: [] });
  renderSync();
  fireEvent.click(await receiveButton());
  expect(await screen.findByText("원격 프로필이 없습니다. 먼저 보내기를 실행하세요.")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("does not look for conflicts on other failures", async () => {
  receive = () => { throw new ApiError(500, "clone 실패"); };
  renderSync();
  fireEvent.click(await receiveButton());
  expect(await screen.findByText("clone 실패")).toBeTruthy();
  expect(call).not.toHaveBeenCalledWith("profiles:sync-plan", "mine", "receive");
});

it("shows login output because gh prints its one-time code there", async () => {
  renderSync();
  await receiveButton();
  act(() => logListener!({ text: "일회용 코드: ABCD-1234" }));
  expect(screen.getByText("일회용 코드: ABCD-1234")).toBeTruthy();
});

it("keeps the connection and tool install behind a confirmation", async () => {
  renderSync();
  fireEvent.click(await screen.findByRole("button", { name: "연결 변경" }));
  fireEvent.change(screen.getByLabelText("동기화 저장소"), { target: { value: "  me/new  " } });

  fireEvent.click(screen.getByRole("button", { name: "연결" }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "저장소 연결" })).getByRole("button", { name: "취소" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "저장소 연결" })).toBeNull());
  expect(call).not.toHaveBeenCalledWith("profiles:github-connect", expect.anything(), expect.anything(), expect.anything());

  fireEvent.click(screen.getByRole("button", { name: "GitHub 도구 준비" }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "GitHub 도구 준비" })).getByRole("button", { name: "취소" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "GitHub 도구 준비" })).toBeNull());
  expect(call).not.toHaveBeenCalledWith("profiles:github-tools");

  fireEvent.click(screen.getByRole("button", { name: "연결" }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "저장소 연결" })).getByRole("button", { name: "연결" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("profiles:github-connect", "mine", "me/new", false));
});

it("keeps login reachable on a PC where gh already works, so the account can change", async () => {
  renderSync();
  await screen.findByRole("button", { name: "연결 변경" });
  expect(screen.queryByRole("button", { name: "GitHub 로그인" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "연결 변경" }));
  expect(screen.getByRole("button", { name: "GitHub 로그인" })).toBeTruthy();
});

it("shows the tools without opening the connection when gh is unavailable", async () => {
  status = { connected: false, available: false, detail: "GitHub CLI가 없습니다" };
  renderSync();
  expect(await screen.findByRole("button", { name: "GitHub 도구 준비" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "다른 PC의 변경 받기" })).toBeDisabled();
});
