import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runRepairAgent } from "./agent.js";

let root: string;
let executable: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hm agent test "));
  const script = path.join(root, "fake.cjs");
  await fs.writeFile(script, `
    const send = m => process.stdout.write(JSON.stringify(m) + '\\n');
    if (process.argv.includes('exec')) {
      let prompt = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', text => prompt += text);
      process.stdin.on('end', () => {
        require('node:fs').writeFileSync(process.env.HM_FAKE_TRACE, JSON.stringify({prompt,args:process.argv.slice(2)}));
        send({type:'item.started',item:{type:'command_execution',command:'test command'}});
        if (process.env.HM_FAKE_WAIT) setInterval(() => {}, 1000);
        else send({type:'turn.completed'});
      });
    } else {
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const m = JSON.parse(line);
      if(m.type==='control_request') send({type:'control_response',response:{subtype:'success',request_id:m.request_id}});
      if(m.type==='user') {
        require('node:fs').writeFileSync(process.env.HM_FAKE_TRACE, JSON.stringify({message:m,args:process.argv.slice(2)}));
        send({type:'result',subtype:'success',is_error:false,result:'완료'});
      }
      if(m.type==='control_response') send({type:'result',subtype:'success',is_error:false,result:'완료'});
    });
    }
  `);
  executable = path.join(root, process.platform === "win32" ? "agent.cmd" : "agent");
  await fs.writeFile(executable, process.platform === "win32" ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o700 });
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it.each(["codex", "claude"] as const)("streams %s through an actual child process and keeps shell metacharacters in stdin", async (provider) => {
  const trace = path.join(root, "trace.json");
  const prompt = "한글 & | $(command) %PATH% \"quoted\"\nlog";
  await runRepairAgent({ provider, executable, cwd: root, stateDir: root, env: { ...process.env, HM_FAKE_TRACE: trace }, prompt, signal: new AbortController().signal, log: vi.fn() });
  const sent = JSON.parse(await fs.readFile(trace, "utf8"));
  expect(provider === "codex" ? sent.prompt : sent.message.message.content).toBe(prompt);
  expect(sent.args).toContain(provider === "codex" ? "--dangerously-bypass-approvals-and-sandbox" : "--dangerously-skip-permissions");
  if (provider === "claude") {
    expect(sent.args).not.toContain("--permission-prompt-tool");
    expect((await fs.readdir(root)).filter((entry) => entry.startsWith("claude-"))).toEqual([]);
  }
});

it("kills the CLI tree when cancelled during a command", async () => {
  const abort = new AbortController();
  const run = runRepairAgent({ provider: "codex", executable, cwd: root, stateDir: root, env: { ...process.env, HM_FAKE_TRACE: path.join(root, "trace.json"), HM_FAKE_WAIT: "1" }, prompt: "test", signal: abort.signal, log: () => abort.abort() });
  await expect(run).rejects.toThrow("취소");
});
