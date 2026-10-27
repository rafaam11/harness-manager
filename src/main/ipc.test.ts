import { describe, expect, it, vi } from "vitest";
import { API_CHANNELS } from "@shared/api-types";
import type { ApiHandlers } from "./api-handlers.js";
import { registerMainIpc, type IpcRegistrar } from "./ipc.js";

function setup(handlerImpl: (...args: unknown[]) => unknown, trusted = true) {
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const registrar: IpcRegistrar = { handle: (channel, listener) => void listeners.set(channel, listener) };
  const handlers = Object.fromEntries(API_CHANNELS.map((c) => [c, vi.fn(handlerImpl)])) as unknown as ApiHandlers;
  registerMainIpc(registrar, handlers, () => trusted);
  return { listeners, handlers };
}

describe("registerMainIpc", () => {
  it("registers every channel in the contract", () => {
    const { listeners } = setup(() => null);
    expect([...listeners.keys()].sort()).toEqual([...API_CHANNELS].sort());
  });

  it("wraps results and keeps the status code of a thrown error", async () => {
    const { listeners } = setup(() => {
      throw Object.assign(new Error("conflict"), { statusCode: 409 });
    });
    await expect(listeners.get("capture:apply")?.({}, "a")).resolves.toEqual({
      ok: false,
      statusCode: 409,
      error: "conflict",
    });
  });

  it("defaults to 500 for errors without a status code", async () => {
    const { listeners } = setup(() => {
      throw new Error("boom");
    });
    await expect(listeners.get("plugins:list")?.({})).resolves.toMatchObject({ ok: false, statusCode: 500 });
  });

  it("passes arguments through and returns data", async () => {
    const { listeners, handlers } = setup((x) => `got ${String(x)}`);
    await expect(listeners.get("catalog:content")?.({}, "settings")).resolves.toEqual({ ok: true, data: "got settings" });
    expect(handlers["catalog:content"]).toHaveBeenCalledWith("settings");
  });

  it("refuses requests from untrusted senders without calling the handler", async () => {
    const { listeners, handlers } = setup(() => "secret", false);
    await expect(listeners.get("catalog:content")?.({}, "settings")).resolves.toMatchObject({
      ok: false,
      statusCode: 403,
    });
    expect(handlers["catalog:content"]).not.toHaveBeenCalled();
  });
});
