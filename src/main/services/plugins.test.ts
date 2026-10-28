import { describe, expect, it } from "vitest";
import { getCodexPlugins } from "./plugins.js";
import type { CommandRunner } from "./install/exec.js";

function runner(output: string, code: number | null = 0): CommandRunner {
  return { run: async (spec, log) => {
    expect(spec.command).toBe("codex");
    expect(spec.args).toEqual(["plugin", "list", "--json"]);
    for (const line of output.split("\n")) log("stdout", line);
    return { code, timedOut: false, notFound: false };
  } };
}

describe("Codex plugin inventory", () => {
  it("includes installed enabled and disabled plugins with their source provider", async () => {
    const result = await getCodexPlugins(runner(JSON.stringify({ installed: [
      { pluginId: "tools@local", installed: true, enabled: true, version: "local" },
      { pluginId: "off@local", installed: true, enabled: false },
      { pluginId: "available@local", installed: false, enabled: true },
    ] }, null, 2)));
    expect(result.plugins).toMatchObject([
      { provider: "codex", id: "tools@local", enabledInSettings: true, installs: [{ version: "local" }] },
      { provider: "codex", id: "off@local", enabledInSettings: false },
    ]);
  });
  it("reports command failures and malformed output instead of claiming nothing is installed", async () => {
    await expect(getCodexPlugins(runner("{}", 1))).rejects.toThrow();
    await expect(getCodexPlugins(runner("{}"))).rejects.toThrow();
  });
});
