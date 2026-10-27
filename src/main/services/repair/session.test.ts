import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InstallStep } from "@shared/install-types";
import type { InstallContext } from "../install/engine.js";
import { RepairSession } from "./session.js";

const { plan, retry } = vi.hoisted(() => ({ plan: vi.fn(), retry: vi.fn() }));
vi.mock("../install/engine.js", () => ({ planInstallWith: plan, runInstallWith: retry }));
vi.mock("../../providers/provider-launch.js", () => ({ findOnPath: vi.fn(async () => "/fake/codex") }));
let directory: string;
const bad: InstallStep = { id: "packages.winget.nvm", title: "Node", section: "toolchain", state: "error", detail: "MSI + NVM", actions: [], manual: true, actionable: false };
const good = { ...bad, state: "ok" as const };
const ctx = { repoRoot: "/repo", env: { API_KEY: "test-secret" }, refreshEnvironment: vi.fn(async () => true) } as unknown as InstallContext;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "hm-repair-")); vi.clearAllMocks(); plan.mockResolvedValue({ steps: [bad] }); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

it("rechecks the actual state and sends remaining failures into at most three AI attempts", async () => {
  const session = new RepairSession(); const agent = vi.fn(async () => undefined);
  const result = await session.run(ctx, bad.id, "codex", new AbortController().signal, vi.fn(), vi.fn(), directory, agent);
  expect(agent).toHaveBeenCalledTimes(3);
  expect(retry).not.toHaveBeenCalled();
  expect(result.phase).toBe("failed");
  expect(result.running).toBe(false);
});

it("stops after a successful doctor verification and masks credentials in prompts and logs", async () => {
  const session = new RepairSession();
  session.remember({ type: "log", id: bad.id, stream: "stderr", line: "test-secret failed" });
  plan.mockResolvedValueOnce({ steps: [bad] }).mockResolvedValue({ steps: [good] });
  const agent = vi.fn(async ({ prompt, log }) => { expect(prompt).not.toContain("test-secret"); log("stdout", "test-secret repaired"); });
  const result = await session.run(ctx, bad.id, "claude", new AbortController().signal, vi.fn(), vi.fn(), directory, agent);
  expect(result.phase).toBe("done");
  expect(agent).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(result.logFile!, "utf8")).not.toContain("test-secret");
});

it("does not retry an install after the user rejects the proposed actions", async () => {
  const session = new RepairSession(); plan.mockResolvedValue({ steps: [{ ...bad, actionable: true, manual: false, actions: [{ kind: "command", summary: "install fixed" }] }] });
  const result = await session.run(ctx, bad.id, "codex", new AbortController().signal, (event) => {
    if (event.type === "state" && event.state.approvals[0]) session.answer(event.state.approvals[0].id, false);
  }, vi.fn(), directory, vi.fn(async () => undefined));
  expect(retry).not.toHaveBeenCalled();
  expect(result.round).toBe(1);
  expect(result.phase).toBe("failed");
});

it("only retries the selected step after approval and uses the verified install result", async () => {
  const session = new RepairSession(); plan.mockResolvedValue({ steps: [{ ...bad, actionable: true }] });
  retry.mockResolvedValue({ results: [{ id: bad.id, outcome: "done", after: "ok", detail: "done" }] });
  const result = await session.run(ctx, bad.id, "codex", new AbortController().signal, (event) => {
    if (event.type === "state" && event.state.approvals[0]) session.answer(event.state.approvals[0].id, true);
  }, vi.fn(), directory, vi.fn(async () => undefined));
  expect(retry.mock.calls[0]?.[1]).toEqual([bad.id]);
  expect(result.phase).toBe("done");
});

it("preserves other failed items when one item is retried", async () => {
  const session = new RepairSession();
  const other = { ...bad, id: "tools.codex", state: "missing" as const };
  session.remember({ type: "step-done", result: { id: other.id, outcome: "failed", after: "missing", detail: "install failed" } });
  plan.mockResolvedValue({ steps: [{ ...bad, actionable: true }, other] });
  retry.mockImplementation(async (_ctx, _ids, emit) => {
    emit({ type: "run-start", total: 1 });
    return { results: [{ id: bad.id, outcome: "done", after: "ok", detail: "done" }] };
  });
  await session.run(ctx, bad.id, "codex", new AbortController().signal, (event) => {
    if (event.type === "state" && event.state.approvals[0]) session.answer(event.state.approvals[0].id, true);
  }, vi.fn(), directory, vi.fn(async () => undefined));
  const agent = vi.fn(async () => undefined);
  await session.run(ctx, other.id, "claude", new AbortController().signal, vi.fn(), vi.fn(), directory, agent);
  expect(agent).toHaveBeenCalledTimes(3);
});

it("cancels a pending approval without retrying and rejects unrelated or healthy step ids", async () => {
  const session = new RepairSession(); const abort = new AbortController();
  const result = await session.run(ctx, bad.id, "codex", abort.signal, (event) => {
    if (event.type === "state" && event.state.approvals.length) abort.abort();
  }, vi.fn(), directory, async ({ approve }) => { expect(await approve("change", "command")).toBe(false); });
  expect(result.phase).toBe("cancelled");
  expect(result.approvals).toEqual([]);
  await expect(session.run(ctx, "unknown", "codex", new AbortController().signal, vi.fn(), vi.fn(), directory)).rejects.toMatchObject({ statusCode: 400 });
  plan.mockResolvedValue({ steps: [good] });
  await expect(session.run(ctx, bad.id, "codex", new AbortController().signal, vi.fn(), vi.fn(), directory)).rejects.toMatchObject({ statusCode: 400 });
});
