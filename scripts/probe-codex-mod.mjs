// Run the installed Codex CLI against a local, fixed-response test model. No paid API or user config.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hm-codex-probe-'));
const home = path.join(root, 'codex');
const market = path.join(root, 'market');
await fs.mkdir(path.join(market, '.claude-plugin'), { recursive: true });
await fs.mkdir(home, { recursive: true });
await fs.cp(fileURLToPath(new URL('../mods/jinmin-codex', import.meta.url)), path.join(market, 'mod'), { recursive: true });
await fs.writeFile(path.join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'probe', owner: { name: 'test' }, plugins: [{ name: 'jinmin-codex', source: './mod' }] }));

const env = { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: home, HM_CODEX_GUARD: 'block', MULTI_CLI_WORK_SESSION_ID: '', MULTI_CLI_WORK_STATUS_DIR: '' };
delete env.OPENAI_API_KEY;
delete env.CODEX_API_KEY;

function run(args, timeout = 30_000) {
  const shim = process.platform === 'win32';
  const safe = (value) => {
    if (/["%^&|<>()!\r\n]/.test(value)) throw new Error('Unsafe test argument');
    return `"${value}"`;
  };
  const child = spawn(shim ? process.env.ComSpec ?? 'cmd.exe' : 'codex', shim ? ['/d', '/s', '/c', `"codex ${args.map(safe).join(' ')}"`] : args, { cwd: root, env, windowsHide: true, windowsVerbatimArguments: shim, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = '';
  child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-2_000_000); });
  child.stderr.on('data', (chunk) => { error = (error + chunk.toString()).slice(-20_000); });
  const timer = setTimeout(() => {
    if (shim) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
  }, timeout);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`Codex probe failed (${code}): ${error.slice(-1500)}`)); });
  });
}

let requests = 0, guardObserved = false;
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body || '{}');
  guardObserved ||= body.includes('jinmin-codex guard');
  const shell = (input.tools ?? []).find((tool) => ['exec_command', 'shell_command', 'shell'].includes(tool.name));
  const index = requests++;
  const command = 'git reset --hard';
  const item = index === 0 && shell ? { type: 'function_call', id: 'fc_probe_' + index, call_id: 'call_probe_' + index, name: shell.name,
    arguments: JSON.stringify(shell.name === 'exec_command' ? { cmd: command, max_output_tokens: 100 } : shell.name === 'shell' ? { command: ['git', 'reset', '--hard'] } : { command }) }
    : { type: 'message', id: 'msg_probe', role: 'assistant', content: [{ type: 'output_text', text: 'HM_PROBE_DONE', annotations: [] }] };
  const response = { id: 'resp_' + requests, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
  res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
  for (const event of [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const port = server.address().port;
  await fs.writeFile(path.join(home, 'config.toml'), `model = "test-model"\nmodel_provider = "probe"\n[model_providers.probe]\nname = "Probe"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
  await run(['plugin', 'marketplace', 'add', market, '--json']);
  await run(['plugin', 'add', 'jinmin-codex@probe', '--json']);
  const prompt = JSON.parse(await run(['--no-daemon', 'debug', 'prompt-input']));
  assert.ok(JSON.stringify(prompt).includes('codex-status'), 'Packaged skill must be visible');
  // This bypass applies only to the vetted package in this temporary home; no trust is persisted.
  const output = await run(['--no-daemon', '--dangerously-bypass-hook-trust', 'exec', '--skip-git-repo-check', '--json', 'Run the one test command supplied by the local test model, then finish.'], 45_000);
  assert.ok(output.includes('HM_PROBE_DONE'), 'CLI must complete its test turn');
  const states = [];
  async function scan(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (/^[a-f0-9]{64}\.json$/.test(entry.name)) { try { const value = JSON.parse(await fs.readFile(file, 'utf8')); if (value.schemaVersion === 1 && value.sessionId) states.push(value); } catch {} }
    }
  }
  await scan(home);
  assert.ok(states.length, 'Real Codex must have run the package hook');
  assert.ok(guardObserved, 'Real Codex must receive the guard denial');
  console.log(JSON.stringify({ skillVisible: true, hookObserved: true, guardDenied: true, finalStates: states.map((state) => ({ event: state.event, status: state.status })) }));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
