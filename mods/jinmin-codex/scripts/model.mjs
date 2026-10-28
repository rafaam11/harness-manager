import { createHash } from 'node:crypto';

export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd'];
export const sessionKey = (id) => createHash('sha256').update(id).digest('hex');
const short = (value) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) : null;
function externalCli(command) {
  if (typeof command !== 'string') return null;
  for (const segment of command.split(/[;&|\r\n]/)) {
    const words = segment.trim().match(/^(?:"([^"]+)"|'([^']+)'|(\S+))\s+(\S+)/);
    if (!words) continue;
    const executable = (words[1] ?? words[2] ?? words[3]).split(/[\\/]/).pop().replace(/\.(?:cmd|exe)$/i, '').toLowerCase();
    if (['codex', 'claude'].includes(executable) && ['exec', 'review', '-p', '--print'].includes(words[4])) return executable;
  }
  return null;
}

export function reduce(previous, event, now = new Date().toISOString()) {
  const state = previous ?? { schemaVersion: 1, tools: {}, agents: {}, toolCount: 0 };
  const next = { ...state, tools: { ...state.tools }, agents: { ...state.agents }, sessionId: event.session_id, observedAt: now, event: event.hook_event_name };
  if (typeof event.cwd === 'string') next.cwd = event.cwd;
  if (short(event.model)) next.model = short(event.model);
  if (short(event.permission_mode)) next.permissionMode = short(event.permission_mode);
  const id = short(event.tool_use_id);
  const agent = short(event.agent_id);
  switch (event.hook_event_name) {
    case 'SessionStart': next.status = 'ready'; break;
    case 'UserPromptSubmit': next.status = 'working'; next.turnStartedAt = now; next.tools = {}; break;
    case 'PreToolUse': {
      next.status = 'working';
      const command = event.tool_input?.command ?? event.tool_input?.cmd;
      // Store the provider label only. Commands and prompts can contain credentials.
      const cli = externalCli(command);
      const detached = typeof command === 'string' && /\b(?:Start-Process|nohup)\b|&\s*$/i.test(command);
      if (id && !event.guardBlocked && Object.keys(next.tools).length < 100) next.tools[id] = { name: short(event.tool_name), cli, detached, startedAt: now };
      next.lastTool = short(event.tool_name);
      next.toolCount = Math.min(1_000_000, (next.toolCount ?? 0) + 1);
      break;
    }
    case 'PostToolUse': if (id) delete next.tools[id]; break;
    case 'SubagentStart': if (agent && Object.keys(next.agents).length < 100) next.agents[agent] = { startedAt: now }; break;
    case 'SubagentStop': if (agent) delete next.agents[agent]; break;
    case 'Stop': next.status = 'awaiting-input'; next.tools = {}; next.agents = {}; break;
    case 'Interrupt': next.status = 'interrupted'; next.tools = {}; next.agents = {}; break;
    case 'SessionEnd': next.status = 'ended'; next.tools = {}; next.agents = {}; break;
  }
  return next;
}
