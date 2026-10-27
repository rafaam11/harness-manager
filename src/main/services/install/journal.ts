import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function redactInstallText(text: string, env: NodeJS.ProcessEnv): string {
  const secrets = Object.entries(env).filter(([key, value]) => /TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION/i.test(key) && value && value.length >= 4);
  let safe = text;
  for (const [, value] of secrets) safe = safe.split(value!).join("***");
  return safe.replace(/(Bearer\s+)[\w.+/=-]+/gi, "$1***")
    .replace(/((?:token|secret|password|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1***");
}

/** 새 실행마다 전용 파일을 만들고 직렬로 쓴다. renderer의 최근 2천 줄 제한과 무관하게 진단에 남긴다. */
export async function createInstallJournal(directory: string, env: NodeJS.ProcessEnv) {
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.jsonl`);
  const file = await fs.open(filePath, "wx", 0o600);
  let pending = Promise.resolve();
  let size = 0;
  let failure: unknown;
  return {
    filePath,
    record(event: unknown) {
      const line = JSON.stringify({ time: new Date().toISOString(), event }, (_key, value: unknown) =>
        typeof value === "string" ? redactInstallText(value, env) : value) + "\n";
      if (size >= 2 * 1024 * 1024) return;
      size += Buffer.byteLength(line);
      pending = pending.then(async () => { await file.write(line); }).catch((error: unknown) => { failure = error; });
    },
    async close() {
      await pending;
      await file.close();
      if (failure) throw failure;
    },
  };
}
