import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { metadataProcess } from "./metadata-process.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 3 }); });
async function options(source: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-metadata-")); roots.push(root);
  const script = path.join(root, "fixture.cjs"); await fs.writeFile(script, source);
  return { executable: process.execPath, args: [script], cwd: root, env: process.env, signal: new AbortController().signal };
}
it("handshakes over actual stdio and stops after receiving metadata", async () => {
  const spec = await options(String.raw`require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);process.stdout.write(JSON.stringify({id:m.id,result:{value:'한글'}})+'\n')})`);
  const received: unknown[] = [];
  await metadataProcess({ ...spec, initialMessage: { id: 1 }, onMessage: (message, _send, finish) => { received.push(message); finish(); } });
  expect(received).toEqual([{ id: 1, result: { value: "한글" } }]);
});
it("keeps shell syntax in stdin and bounds stalled, cancelled and oversized processes", async () => {
  const echo = await options(`process.stdin.pipe(process.stdout)`);
  expect(await metadataProcess({ ...echo, input: "$(private) & echo secret" })).toBe("$(private) & echo secret");
  const idle = await options(`setInterval(()=>{},1000)`);
  await expect(metadataProcess({ ...idle, timeoutMs: 50 })).rejects.toThrow("시간");
  const controller = new AbortController(); const pending = metadataProcess({ ...idle, signal: controller.signal }); controller.abort(); await expect(pending).rejects.toThrow("취소");
  const large = await options(`process.stdout.write('x'.repeat(5*1024*1024));setInterval(()=>{},1000)`);
  await expect(metadataProcess(large)).rejects.toThrow("크기");
});
