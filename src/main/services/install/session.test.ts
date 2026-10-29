import { describe, expect, it } from "vitest";
import { InstallSession, installProgress } from "./session.js";

describe("InstallSession", () => {
  it("수동 작업은 자동 확인을 취소하고 정리가 끝난 뒤 실행한다", async () => {
    const session = new InstallSession(); const order: string[] = [];
    const background = session.runAutomatic(signal => new Promise<void>(resolve => signal.addEventListener("abort", () => { order.push("cancel"); setTimeout(() => { order.push("cleaned"); resolve(); }, 10); })));
    await session.run(async () => { order.push("manual"); }); await background;
    expect(order).toEqual(["cancel", "cleaned", "manual"]); expect(session.running).toBe(false);
  });
  it("한 번에 하나만 돌리고, 도는 중에는 409로 거절한다", async () => {
    const session = new InstallSession();
    let release!: () => void;
    const first = session.run(() => new Promise<string>((resolve) => (release = () => resolve("done"))));
    expect(session.running).toBe(true);
    await expect(session.run(async () => "second")).rejects.toMatchObject({ statusCode: 409 });
    release();
    await expect(first).resolves.toBe("done");
    expect(session.running).toBe(false);
  });

  it("cancelAndWait는 신호를 보내고 작업이 끝날 때까지 기다린다", async () => {
    const session = new InstallSession();
    let sawAbort = false;
    const work = session.run(
      (signal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => {
            sawAbort = true;
            setTimeout(resolve, 20);
          }),
        ),
    );
    await session.cancelAndWait();
    expect(sawAbort).toBe(true);
    await work;
    expect(session.running).toBe(false);
  });
});

describe("installProgress", () => {
  it("끝난 step 수로 퍼센트를 내고, 실패가 있으면 error로 남기며, 끝나면 막대를 치운다", () => {
    const progress = installProgress();
    expect(progress({ type: "run-start", total: 4 })).toEqual({ state: "normal", value: 0 });
    expect(progress({ type: "log", id: "a", stream: "stdout", line: "x" })).toBeUndefined();
    expect(progress({ type: "step-done", result: { id: "a", outcome: "done", after: "ok", detail: "" } })).toEqual({ state: "normal", value: 25 });
    expect(progress({ type: "step-done", result: { id: "b", outcome: "failed", after: "missing", detail: "" } })).toEqual({ state: "error", value: 50 });
    expect(progress({ type: "run-done", result: { results: [], verify: [], cancelled: false } })).toBe("clear");
  });
});
