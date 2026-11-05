import { findOnPath } from "../providers/provider-launch.js";
import { codexSkillList, type MetadataTransport } from "./workbench/recognition.js";

/** Legacy name-only API backed by structured metadata, without parsing prompts. */
export async function getVisibleCodexSkills(transport?: MetadataTransport): Promise<{ cwd: string; skills: string[] }> {
  const cwd = process.cwd(), executable = await findOnPath("codex");
  if (!executable) throw new Error("Codex 실행 파일을 찾지 못했습니다");
  const skills = await codexSkillList(executable, { id: "legacy", kind: "project", cwd }, process.env, new AbortController().signal, transport);
  return { cwd, skills: [...new Set(skills.filter(s => s.enabled).map(s => s.name))].sort() };
}
