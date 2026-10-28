import { processRunner, type CommandRunner } from "./install/exec.js";

/** Only metadata from the generated developer prompt is returned; prompt text stays in main. */
export async function getVisibleCodexSkills(runner: CommandRunner = processRunner): Promise<{ cwd: string; skills: string[] }> {
  const cwd = process.cwd();
  const lines: string[] = [];
  let size = 0;
  const result = await runner.run({ command: "codex", args: ["debug", "prompt-input"], cwd, timeoutMs: 20_000 }, (stream, line) => {
    if (stream !== "stdout") return;
    size += line.length;
    if (size <= 4 * 1024 * 1024) lines.push(line);
  }, new AbortController().signal);
  if (result.notFound || result.timedOut || result.code !== 0 || size > 4 * 1024 * 1024) throw new Error("Codex 세션의 스킬 목록을 확인하지 못했습니다.");
  const messages: unknown = JSON.parse(lines.join("\n"));
  if (!Array.isArray(messages)) throw new Error("Codex 진단 응답 형식이 다릅니다.");
  const texts = messages.filter((message) => message?.role === "developer" && Array.isArray(message.content))
    .flatMap((message) => message.content.map((item: { text?: unknown }) => typeof item?.text === "string" ? item.text : ""));
  const section = texts.map((text: string) => text.match(/^### Available skills\s*$([\s\S]*?)(?=^##\s|^###\s|(?![\s\S]))/m)).find(Boolean);
  if (!section) throw new Error("Codex 진단 응답에서 스킬 목록을 찾지 못했습니다.");
  const skills = [...section[1]!.matchAll(/^- (.+?): (?=\S)/gm)].map((match) => match[1]!);
  return { cwd, skills: [...new Set(skills)].sort((a, b) => a.localeCompare(b)) };
}
