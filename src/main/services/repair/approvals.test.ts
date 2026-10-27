import { expect, it, vi } from "vitest";
import { RepairApprovals } from "./approvals.js";

it("binds each decision to a live request and rejects stale or invented approval ids", async () => {
  const approvals = new RepairApprovals(vi.fn());
  const pending = approvals.ask("command", "winget install example", new AbortController().signal);
  const id = approvals.list()[0]!.id;
  expect(() => approvals.answer("invented", true)).toThrow();
  approvals.answer(id, false);
  await expect(pending).resolves.toBe(false);
  expect(() => approvals.answer(id, true)).toThrow();
  expect(approvals.list()).toEqual([]);
});

it("denies pending approvals on cancellation and refuses truncated command previews", async () => {
  const approvals = new RepairApprovals(vi.fn());
  const abort = new AbortController();
  const pending = approvals.ask("command", "command", abort.signal);
  abort.abort();
  await expect(pending).resolves.toBe(false);
  await expect(approvals.ask("large", "a".repeat(64_001), new AbortController().signal)).resolves.toBe(false);
  expect(approvals.list()).toHaveLength(0);
});
