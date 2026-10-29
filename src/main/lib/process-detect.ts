import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function detectProcess(names: string[], strict = false): Promise<boolean> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("tasklist", [], { windowsHide: true, timeout: 5000 }).catch(error => { if (strict) throw error; return { stdout: "" }; });
    const lower = stdout.toLowerCase();
    return names.some((name) => lower.includes(name.toLowerCase()));
  }
  for (const name of names) {
    const result = await execFileAsync("pgrep", ["-x", name], { timeout: 5000 }).catch(error => { if (strict && error.code !== 1) throw error; return null; });
    if (result) return true;
  }
  return false;
}
