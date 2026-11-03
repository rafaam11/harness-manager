// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CaptureItem, CapturePlan } from "@shared/manifest-types";
import Capture from "./Capture";

const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../api/client", async (original) => ({ ...(await original<typeof import("../api/client")>()), call }));
// 프로필 선택과 비공개 낱말은 자기 채널을 쓴다. 여기서는 표와 적용만 본다.
vi.mock("../components/SetupProfilePicker", () => ({ default: () => null }));
vi.mock("../components/PrivateTerms", () => ({ default: () => null }));

const clean: CaptureItem = {
  id: "plugins",
  label: "플러그인",
  sources: ["~/.claude/settings.json"],
  changes: [{ scope: "repo", displayPath: "manifest/plugins.json", existed: true, changed: true, diff: "+\"new\"", exposure: [] }],
  notes: ["관리하지 않는 키 1개"],
  applicable: true,
  fingerprint: "fp-plugins",
};
const exposed: CaptureItem = {
  id: "agents",
  label: "AGENTS.md",
  sources: ["~/.codex/AGENTS.md"],
  changes: [{ scope: "repo", displayPath: "home/AGENTS.md", existed: true, changed: true, diff: "+내용", exposure: [{ kind: "home-path", line: 3, text: "~/secret" }] }],
  notes: [],
  applicable: false,
  fingerprint: "fp-agents",
};
const broken: CaptureItem = { id: "mcp", label: "MCP", sources: [], changes: [], notes: [], error: "원본을 읽지 못했습니다", applicable: false, fingerprint: "fp-mcp" };
const unchanged: CaptureItem = { id: "skills", label: "스킬", sources: [], changes: [], notes: [], applicable: false, fingerprint: "fp-skills" };
const plan: CapturePlan = { repoRoot: "/profile", profileDir: "/local", warnings: [], items: [clean, exposed, broken, unchanged] };

beforeEach(() => {
  call.mockReset();
  call.mockImplementation(async (channel: string) => {
    if (channel === "capture:plan") return structuredClone(plan);
    if (channel === "manifest:validate") return [];
    if (channel === "capture:apply") return { applied: ["plugins"], written: ["manifest/plugins.json"] };
    return {};
  });
});
afterEach(cleanup);

it("opens rows with an exposure warning or error without being asked", async () => {
  render(<Capture />);
  expect(await screen.findByRole("table")).toBeTruthy();
  expect(screen.getByText("노출 경고")).toBeTruthy();
  expect(screen.getByRole("button", { name: "AGENTS.md 상세 닫기" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("3행: ~/secret")).toBeTruthy();
  expect(screen.getByText("원본을 읽지 못했습니다")).toBeTruthy();
  // 경고가 없는 행의 diff는 접어 둔다.
  expect(screen.getByRole("button", { name: "플러그인 상세 열기" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("manifest/plugins.json")).toBeNull();
});

it("keeps exposed items out of the selection", async () => {
  render(<Capture />);
  expect(await screen.findByRole("checkbox", { name: "AGENTS.md 선택" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "적용 가능한 항목 전체" }));
  expect(screen.getByRole("checkbox", { name: "플러그인 선택" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "AGENTS.md 선택" })).not.toBeChecked();
  expect(screen.getByText("선택 1 / 1")).toBeTruthy();
});

it("sends only ids and preview fingerprints when applying", async () => {
  render(<Capture />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "플러그인 선택" }));
  fireEvent.click(screen.getByRole("button", { name: "적용 (1)" }));
  const confirm = await screen.findByRole("dialog", { name: "1개 항목을 적용할까요?" });
  fireEvent.click(within(confirm).getByRole("button", { name: "적용" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("capture:apply", ["plugins"], { plugins: "fp-plugins" }));
});

it("offers no expand button for a row with nothing to show", async () => {
  render(<Capture />);
  await screen.findByRole("table");
  expect(screen.queryByRole("button", { name: /스킬 상세/ })).toBeNull();
  expect(within(screen.getByRole("cell", { name: "스킬" }).closest("tr")!).getByText("없음")).toBeTruthy();
});
