import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS, reduce } from './model.mjs';
import { updateState } from './store.mjs';
import { detect } from './guard-rules.mjs';

export function guardDecision(event, mode) {
  if (mode !== 'block' || event.hook_event_name !== 'PreToolUse' || event.tool_name !== 'Bash') return null;
  const command = event.tool_input?.command ?? event.tool_input?.cmd;
  if (typeof command !== 'string') return null;
  const dangers = detect(command);
  if (!dangers.length) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'jinmin-codex guard: ' + dangers.map((item) => item.summary).join(' · ') + '. 사용자 검토 후 직접 실행하세요. Hook 승인 질문은 지원되지 않습니다.' } };
}

export async function handle(event, env = process.env) {
  if (!event || !EVENTS.includes(event.hook_event_name) || typeof event.session_id !== 'string' || !event.session_id || event.session_id.length > 500) return {};
  const decision = guardDecision(event, env.HM_CODEX_GUARD);
  const data = env.PLUGIN_DATA ?? env.CLAUDE_PLUGIN_DATA;
  let completedCli = null;
  if (data && path.isAbsolute(data)) {
    try { await updateState(data, event.session_id, (state) => {
      const tool = state?.tools?.[event.tool_use_id];
      if (event.hook_event_name === 'PostToolUse' && tool?.cli && !tool.detached) completedCli = tool.cli;
      return reduce(state, { ...event, guardBlocked: Boolean(decision) });
    }); } catch { /* Observation failure must not change tool execution. */ }
  }
  if (decision) return decision;
  if (completedCli) return { systemMessage: `${completedCli} 외부 CLI의 도구 호출이 끝났습니다. 성공 여부와 결과는 해당 실행 로그를 확인하세요.` };
  if (event.hook_event_name === 'SessionStart' && data && path.isAbsolute(data)) {
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `jinmin-codex 상태 조회: data=${JSON.stringify(data)}, session=${JSON.stringify(event.session_id)}. codex-status 스킬로 마지막 관측값을 확인할 수 있습니다. 가드 설정=${env.HM_CODEX_GUARD === 'block' ? '위험 명령 차단' : '꺼짐'}.` } };
  }
  return {};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = '';
  try {
    for await (const chunk of process.stdin) {
      input += chunk.toString('utf8');
      if (input.length > 1024 * 1024) throw new Error('Hook input too large');
    }
    process.stdout.write(JSON.stringify(await handle(JSON.parse(input))));
  } catch {
    // Codex treats exit 2 as deny. An enabled guard must fail closed when it cannot inspect input.
    if (process.env.HM_CODEX_GUARD === 'block') { process.stderr.write('jinmin-codex guard: hook 입력을 검사하지 못했습니다.'); process.exitCode = 2; }
    else process.stdout.write('{}');
  }
}
