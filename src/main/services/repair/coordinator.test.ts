import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InstallContext } from "../install/engine.js";
import { InstallSession } from "../install/session.js";
import { RepairCoordinator } from "./coordinator.js";
const ids = ["claude.settings", "codex.config", "dotfiles.git", "dotfiles.powershell-profile", "claude.plugin.x", "packages.winget.nvm"];
vi.mock("../install/engine.js", () => ({ planInstallWith: vi.fn(async () => ({ steps: ids.map((id) => ({ id, state: "error", actions: [], actionable: false })) })), runInstallWith: vi.fn() }));
vi.mock("../../providers/provider-launch.js", () => ({ findOnPath: vi.fn(async () => "/fake/codex") }));
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-parallel-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const context = async () => ({ repoRoot: "/repo", env: {}, refreshEnvironment: async () => false }) as unknown as InstallContext;

it("runs independent repairs concurrently, queues at three, rejects duplicates, and cancels queued jobs", async () => {
  const tasks = new InstallSession();
  const started: string[] = [];
  const coordinator = new RepairCoordinator(tasks, vi.fn(), root, undefined, async ({ prompt, signal }) => {
    started.push(ids.find((id) => prompt.includes(id))!);
    await new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
  });
  for (const id of ids.slice(0, 3)) coordinator.enqueue(context, id, "codex");
  const queued = coordinator.enqueue(context, ids[3], "claude");
  await vi.waitFor(() => expect(started).toHaveLength(3));
  expect(() => coordinator.enqueue(context, ids[0], "claude")).toThrow("이미");
  await expect(tasks.run(async () => undefined)).rejects.toMatchObject({ statusCode: 409 });
  coordinator.cancel(queued.jobId);
  await vi.waitFor(() => expect(coordinator.snapshot().jobs.find((job) => job.jobId === queued.jobId)?.phase).toBe("cancelled"));
  await tasks.cancelAndWait();
  expect(started).toHaveLength(3);
  expect(tasks.running).toBe(false);
  expect(coordinator.snapshot().jobs.every((job) => !job.running)).toBe(true);
});
it("serializes changes to one provider and makes runtime changes wait for all active jobs", async () => {
  const tasks = new InstallSession();
  const started: string[] = [];
  const coordinator = new RepairCoordinator(tasks, vi.fn(), root, undefined, async ({ prompt, signal }) => {
    started.push(ids.find((id) => prompt.includes(id))!);
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  });
  coordinator.enqueue(context, ids[0], "codex");
  coordinator.enqueue(context, ids[4], "codex");
  coordinator.enqueue(context, ids[5], "claude");
  await vi.waitFor(() => expect(started).toEqual([ids[0]]));
  expect(coordinator.snapshot().jobs.filter((job) => job.phase === "queued")).toHaveLength(2);
  await tasks.cancelAndWait();
});
