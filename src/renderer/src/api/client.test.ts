import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessBridge } from "@shared/api-types";
import { ApiError, call } from "./client";

function installBridge(invoke: HarnessBridge["invoke"]) {
  vi.stubGlobal("window", { hm: { platform: "win32", invoke, on: () => () => undefined } });
}

afterEach(() => vi.unstubAllGlobals());

describe("call", () => {
  it("returns the data of a successful envelope", async () => {
    installBridge((async () => ({ ok: true, data: "1.2.3" })) as HarnessBridge["invoke"]);
    await expect(call("app:version")).resolves.toBe("1.2.3");
  });

  it("restores main's status code so callers can tell a conflict apart", async () => {
    installBridge((async () => ({ ok: false, statusCode: 409, error: "changed" })) as HarnessBridge["invoke"]);
    const error = await call("capture:apply", ["agents"], {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: "changed" });
  });

  it("turns a rejected invoke into a 500 with only main's reason", async () => {
    installBridge((async () => {
      throw new Error("Error invoking remote method 'plugins:list': Error: disk gone");
    }) as HarnessBridge["invoke"]);
    await expect(call("plugins:list")).rejects.toMatchObject({ status: 500, message: "disk gone" });
  });
});
