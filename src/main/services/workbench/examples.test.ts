import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExampleService } from "./examples.js";
import type { InstallContext } from "../install/engine.js";
import type { ExampleRequest } from "@shared/example-types";
import type { CommandSpec, LogSink } from "../install/exec.js";
let root: string, service: ExampleService, ctx: InstallContext, bodyFile: string;
let generated: unknown, output: unknown;
const signal = new AbortController().signal;
const request: ExampleRequest = { itemId: "skill-one", provider: "claude", scopeId: "global", generation: { model: "test-model", budgetUsd: 0.1, timeoutSeconds: 10 }, execution: { model: "test-model", budgetUsd: 0.2, timeoutSeconds: 10 } };
const transport = vi.fn();
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-examples-")); bodyFile = path.join(root, "skill", "SKILL.md"); await fs.mkdir(path.dirname(bodyFile)); await fs.writeFile(bodyFile, "Summarize input in Korean.");
  generated = { description: "Summarize", input: "A sample", expectedArtifact: "A summary", tools: [], connections: [], checks: [{ type: "contains", text: "요약" }] }; output = { artifact: "요약: sample" };
  transport.mockReset().mockImplementation(async options => {
    expect(options.cwd).toContain(path.join(root, "state", "workbench", "examples"));
    expect(options.args).toEqual(expect.arrayContaining(["--bare", "--restricted", "--tools", "", "--disallowedTools", "*", "--strict-mcp-config", "--no-session-persistence"]));
    expect(options.args).not.toContain("--dangerously-skip-permissions");
    expect(options.input).toContain("Summarize input in Korean.");
    return JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(options.cwd.includes("generation-") ? generated : output) });
  });
  ctx = { env: {}, findExecutable: async () => "claude", readVersion: async () => "2.1.318", runner: { run: async (_spec: CommandSpec, log: LogSink) => { log("stdout", "--bare --restricted --tools --disallowedTools --strict-mcp-config --max-budget-usd --no-session-persistence --model"); return { code: 0, notFound: false, timedOut: false }; } } } as unknown as InstallContext;
  service = new ExampleService(async () => ctx, path.join(root, "state"), async () => ({ name: "summary", path: bodyFile, provider: "claude", scopeId: "global" }), transport);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 3 }); });
it("only executes the reviewed plan and independently validates its artifact", async () => {
  const preview = await service.generate(request, signal);
  expect(transport).toHaveBeenCalledTimes(1);
  const result = await service.execute(preview.token, signal);
  expect(result).toMatchObject({ status: "completed", exit: "success", artifactVerified: true, skillEvidence: "content-supplied" });
  expect(await fs.readdir(path.join(root, "state", "workbench", "examples"))).toEqual([]);
  await expect(service.execute(preview.token, signal)).rejects.toMatchObject({ statusCode: 409 });
});
it("does not accept model claims of success when artifact checks fail", async () => {
  output = { artifact: "Success!" }; const preview = await service.generate(request, signal);
  expect(await service.execute(preview.token, signal)).toMatchObject({ exit: "success", artifactVerified: false });
});
it("rejects tools, external connections, arbitrary commands and unknown checks", async () => {
  for (const extra of [{ tools: ["Bash"] }, { connections: ["https://example.com"] }, { command: "deploy" }, { checks: [{ type: "shell", text: "run" }] }]) {
    generated = { description: "task", input: "sample", expectedArtifact: "preview", tools: [], connections: [], checks: [{ type: "contains", text: "ok" }], ...extra };
    await expect(service.generate(request, signal)).rejects.toMatchObject({ statusCode: 422 });
  }
});
it("blocks changed skills, unsupported CLI isolation and arbitrary request fields before a model call", async () => {
  const preview = await service.generate(request, signal); await fs.writeFile(bodyFile, "Changed");
  await expect(service.execute(preview.token, signal)).rejects.toMatchObject({ statusCode: 409 });
  const count = transport.mock.calls.length;
  await expect(service.generate({ ...request, provider: "codex" }, signal)).rejects.toMatchObject({ statusCode: 422 });
  await expect(service.generate({ ...request, command: "arbitrary" }, signal)).rejects.toMatchObject({ statusCode: 400 });
  ctx.runner = { run: async () => ({ code: 0, notFound: false, timedOut: false }) };
  await expect(service.generate(request, signal)).rejects.toMatchObject({ statusCode: 422 });
  expect(transport).toHaveBeenCalledTimes(count);
});
it("handles authentication errors, cancellation and oversized output without declaring success", async () => {
  const preview = await service.generate(request, signal);
  transport.mockRejectedValueOnce(new Error("authentication failed"));
  expect(await service.execute(preview.token, signal)).toMatchObject({ status: "failed", artifactVerified: false });
  const other = await service.generate(request, signal), controller = new AbortController(); controller.abort();
  transport.mockRejectedValueOnce(new Error("cancelled"));
  expect(await service.execute(other.token, controller.signal)).toMatchObject({ status: "cancelled", artifactVerified: false });
});
