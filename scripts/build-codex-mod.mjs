import fs from 'node:fs';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const code = fs.readFileSync(new URL('mods/guard/hooks/rules.ts', root), 'utf8');
fs.writeFileSync(new URL('mods/jinmin-codex/scripts/guard-rules.mjs', root), '// Generated from mods/guard/hooks/rules.ts; regenerate with scripts/build-codex-mod.mjs.\n' + ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd'];
const hooks = Object.fromEntries(events.map((event) => [event, [{ hooks: [{ type: 'command', command: 'node "${PLUGIN_ROOT}/scripts/hook.mjs"', timeout: event === 'Interrupt' ? 3 : 5 }] }]]));
fs.mkdirSync(new URL('mods/jinmin-codex/hooks/', root), { recursive: true });
fs.writeFileSync(new URL('mods/jinmin-codex/hooks/codex.json', root), JSON.stringify({ hooks }, null, 2) + '\n');
