import fs from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { APP_STATE_DIR, CLAUDE_HOME } from "../config.js";
import { SetupProfileStore } from "./setup-profiles.js";
import { runDoctor } from "./doctor/doctor.js";
import { defaultInstallContext, planInstallWith } from "./install/engine.js";
import { defaultCaptureContext, planCapture } from "./capture/capture.js";
vi.mock("../providers/provider-launch.js", () => ({
  findOnPath: async () => null,
}));
vi.mock("../platform-env.js", () => ({
  refreshWindowsEnvironment: async (env: NodeJS.ProcessEnv) => ({ ...env }),
}));
vi.mock("./node-runtime.js", () => ({
  inspectNodeRuntime: async () => ({
    state: "fresh",
    detail: "fresh PC",
    candidates: [],
    versions: [],
    registrations: [],
  }),
  nodeRuntimeCommand: () => ({ command: "fake", args: [], timeoutMs: 1 }),
  TERMINAL_NOTICE: "새 터미널",
}));
it("diagnoses and plans a fresh installation without Git, Node or an app repository", async () => {
  const report = await runDoctor(null);
  expect(report.repoRoot).toBe(null);
  expect(report.repoError).toBeUndefined();
  expect(report.cards).toHaveLength(8);
  const plan = await planInstallWith(await defaultInstallContext(null));
  expect(plan.setupProfile?.id).toBe("default");
  expect(plan.steps.some((step) => step.id === "tools.codex")).toBe(true);
  expect(plan.repoError).toBeUndefined();
});
it("initializes missing private terms on the real capture path and preserves configured terms", async () => {
  const store = new SetupProfileStore(APP_STATE_DIR);
  await store.create("capture", "default");
  const selected = await store.active();
  await fs.unlink(path.join(selected.localDir, "private-terms.json"));
  await fs.mkdir(CLAUDE_HOME, { recursive: true });
  await fs.writeFile(
    path.join(CLAUDE_HOME, "settings.json"),
    '{"model":"new-model"}',
  );
  const context = await defaultCaptureContext(null);
  expect(context.termsMissing).toBe(false);
  expect(context.warnings).toEqual([]);
  expect(
    (await planCapture(null)).items.find(
      (item) => item.id === "claude-settings",
    )?.applicable,
  ).toBe(true);
  await fs.writeFile(
    path.join(selected.localDir, "private-terms.json"),
    '{"terms":["confidential-company"]}',
  );
  expect((await defaultCaptureContext(null)).context.privateTerms).toEqual([
    "confidential-company",
  ]);
});
