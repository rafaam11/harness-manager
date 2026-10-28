import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { handle, guardDecision } from './hook.mjs';
import { reduce, sessionKey } from './model.mjs';
import { readState, updateState } from './store.mjs';

test('Codex uses the same generated danger detector as the Claude guard', async () => {
  const source = await fs.readFile(new URL('../../guard/hooks/rules.ts', import.meta.url), 'utf8');
  const generated = (await fs.readFile(new URL('./guard-rules.mjs', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(generated.slice(generated.indexOf('\n') + 1), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('\r\n', '\n'));
  const event = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git reset --hard' } };
  assert.equal(guardDecision(event, undefined), null);
  assert.equal(guardDecision(event, 'block').hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(guardDecision({ ...event, tool_input: { command: 'git status' } }, 'block'), null);
});

test('external CLI tool lifetime is observed without storing commands or prompts', () => {
  let state = reduce(null, { hook_event_name: 'PreToolUse', session_id: 'x', tool_use_id: 'tool-1', tool_name: 'Bash', tool_input: { command: 'codex exec - SECRET' } });
  assert.equal(state.tools['tool-1'].cli, 'codex');
  assert.equal(JSON.stringify(state).includes('SECRET'), false);
  assert.equal(reduce(null, { hook_event_name: 'PreToolUse', session_id: 'x', tool_use_id: 'echo', tool_input: { command: 'echo codex exec SECRET' } }).tools.echo.cli, null);
  state = reduce(state, { hook_event_name: 'PostToolUse', session_id: 'x', tool_use_id: 'tool-1' });
  assert.deepEqual(state.tools, {});
  state = reduce(state, { hook_event_name: 'Stop', session_id: 'x' });
  assert.equal(state.status, 'awaiting-input');
});

test('parallel hook updates preserve observations and session ids cannot escape the data folder', async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'hm-codex-mod-'));
  try {
    assert.match(sessionKey('../../outside'), /^[a-f0-9]{64}$/);
    await Promise.all(Array.from({ length: 8 }, (_, i) => updateState(data, 'session', (old) => reduce(old, { hook_event_name: 'PreToolUse', session_id: 'session', tool_use_id: String(i), tool_name: 'Bash' }))));
    assert.equal(Object.keys((await readState(data, 'session')).tools).length, 8);
    const output = await handle({ hook_event_name: 'SessionStart', session_id: 'session', model: 'test', cwd: data }, { PLUGIN_DATA: data });
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    const child = promisify(execFile)(process.execPath, [fileURLToPath(new URL('hook.mjs', import.meta.url))], { env: { ...process.env, PLUGIN_DATA: data, HM_CODEX_GUARD: '' } });
    child.child.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: 'session' }));
    assert.deepEqual(JSON.parse((await child).stdout), {});
    assert.equal((await readState(data, 'session')).status, 'awaiting-input');
    await handle({ hook_event_name: 'PreToolUse', session_id: 'session', tool_use_id: 'external', tool_name: 'Bash', tool_input: { command: 'claude -p HELLO' } }, { PLUGIN_DATA: data });
    assert.match((await handle({ hook_event_name: 'PostToolUse', session_id: 'session', tool_use_id: 'external' }, { PLUGIN_DATA: data })).systemMessage, /claude/);
  } finally { await fs.rm(data, { recursive: true, force: true }); }
});
