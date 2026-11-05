import path from "node:path";
import { expect, it } from "vitest";
import { codexSkillList, validateRecognitionRequest } from "./workbench/recognition.js";
import type { MetadataTransport } from "./workbench/recognition.js";
const scope = { id: "global", kind: "global" as const, cwd: process.cwd() };
const transport = (result: unknown): MetadataTransport => async options => {
  expect(options.args).toEqual(["app-server"]);
  const sent: unknown[] = []; let failure: Error | undefined;
  const receive = (raw: unknown) => options.onMessage!(raw, message => sent.push(message), error => { failure = error; });
  receive({ id: 1, result: {} });
  expect(sent).toContainEqual({ id: 2, method: "skills/list", params: { cwds: [scope.cwd], forceReload: true } });
  receive(result); if (failure) throw failure; return "";
};
it("preserves path, plugin identity and disabled skills without collapsing names", async () => {
  const skills = ["one", "two"].map((name, i) => ({ name: "same", path: path.join(scope.cwd, name, "SKILL.md"), enabled: i === 0, scope: "user", pluginId: `${name}@market` }));
  expect(await codexSkillList("codex", scope, {}, new AbortController().signal, transport({ id: 2, result: { data: [{ cwd: scope.cwd, skills, errors: [] }] } }))).toMatchObject(skills);
});
it("distinguishes empty discovery from malformed or partial responses", async () => {
  expect(await codexSkillList("codex", scope, {}, new AbortController().signal, transport({ id: 2, result: { data: [{ cwd: scope.cwd, skills: [], errors: [] }] } }))).toEqual([]);
  for (const data of [[], [{ cwd: scope.cwd, skills: [], errors: [{}] }], [{ cwd: scope.cwd, skills: [{ name: "invalid" }] }]]) await expect(codexSkillList("codex", scope, {}, new AbortController().signal, transport({ id: 2, result: { data } }))).rejects.toThrow();
});
it("reports unsupported versions", async () => {
  await expect(codexSkillList("codex", scope, {}, new AbortController().signal, transport({ id: 2, error: { code: -32601 } }))).rejects.toThrow("지원하지");
});
it("rejects arbitrary paths and command fields in IPC", () => {
  expect(() => validateRecognitionRequest({ provider: "codex", scopeId: "global", refresh: true, cwd: "somewhere" })).toThrow();
});
