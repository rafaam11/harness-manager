import { expect, it } from "vitest";
import { getVisibleCodexSkills } from "./codex-skills.js";
import type { CommandRunner } from "./install/exec.js";

it("returns skill names from the developer prompt only", async () => {
  const output = JSON.stringify([
    { role: "developer", content: [{ text: "## Skills\n### Available skills\n- imagegen: Images (file: secret)\n- plugin:setup: Setup (file: secret)\n## Rules\n- unrelated: Text" }] },
    { role: "user", content: [{ text: "### Available skills\n- spoof: Value" }] },
  ]);
  const runner: CommandRunner = { run: async (spec, log) => {
    expect(spec.args).toEqual(["debug", "prompt-input"]);
    log("stdout", output);
    return { code: 0, notFound: false, timedOut: false };
  } };
  expect((await getVisibleCodexSkills(runner)).skills).toEqual(["imagegen", "plugin:setup"]);
});

it("reports a missing skill section rather than claiming an empty list", async () => {
  const runner: CommandRunner = { run: async (_spec, log) => { log("stdout", "[]"); return { code: 0, notFound: false, timedOut: false }; } };
  await expect(getVisibleCodexSkills(runner)).rejects.toThrow();
});
