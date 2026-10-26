import { describe, expect, it } from "vitest";
import { displayCommand, processRunner, quoteForCmd } from "./exec.js";

async function run(command: string, args: string[], timeoutMs = 15_000) {
  const lines: string[] = [];
  const result = await processRunner.run({ command, args, timeoutMs }, (stream, line) => lines.push(`${stream}:${line}`), new AbortController().signal);
  return { ...result, lines };
}

describe("명령 실행기", () => {
  it("stdout·stderr를 줄 단위로 흘리고 종료 코드를 돌려준다", async () => {
    const result = await run("node", ["-e", "console.log('a\\nb'); console.error('c'); process.exit(3)"]);
    expect(result).toMatchObject({ code: 3, timedOut: false, notFound: false });
    expect(result.lines).toEqual(expect.arrayContaining(["stdout:a", "stdout:b", "stderr:c"]));
  });

  it("시간을 넘기면 끝내고 timedOut을 알린다", async () => {
    const result = await run("node", ["-e", "setTimeout(() => {}, 60000)"], 500);
    expect(result.timedOut).toBe(true);
  });

  it("PATH에 없으면 notFound", async () => {
    expect((await run("definitely-not-a-command-xyz", [])).notFound).toBe(true);
  });

  it.runIf(process.platform === "win32")("npm 같은 .cmd 심은 cmd.exe로 돌린다", async () => {
    const result = await run("npm", ["--version"]);
    expect(result.code).toBe(0);
    expect(result.lines.some((line) => /^stdout:\d+\.\d+\.\d+/.test(line))).toBe(true);
  });

  it("cmd.exe가 다르게 읽는 문자는 거절하고, 공백은 따옴표로 감싼다", () => {
    expect(quoteForCmd("@openai/codex")).toBe("@openai/codex");
    expect(quoteForCmd("D:\\my dir\\x")).toBe('"D:\\my dir\\x"');
    for (const bad of ["a&b", "a|b", "%PATH%", 'a"b', "a^b", "a>b"]) expect(() => quoteForCmd(bad)).toThrow();
    expect(displayCommand({ command: "claude", args: ["mcp", "add", "D:\\a b"] })).toBe('claude mcp add "D:\\a b"');
  });
});
