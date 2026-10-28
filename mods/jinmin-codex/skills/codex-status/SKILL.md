---
name: codex-status
description: Codex 작업 상태, 모델, 권한 모드, 실행 중인 외부 Claude·Codex CLI, 최근 hook 관측을 확인한다. "Codex 상태", "코덱스 HUD", "codex-status", "외부 CLI 작업 확인" 요청에 사용한다.
---

# Codex 상태 확인

1. 이 스킬 폴더에서 `../../scripts/status.mjs`의 절대경로를 구한다.
2. `node <status.mjs 절대경로> --data <SessionStart가 알려 준 데이터 폴더> --session <세션 ID>`를 실행한다. 데이터 폴더와 ID를 전달받지 못했다면 추측하지 말고 hook 신뢰 후 새 세션에서 다시 확인하도록 안내한다.
3. 모델, 권한 모드, 마지막으로 관측된 이벤트·시각, 실행 중인 외부 CLI와 도구 수를 요약한다. 결과는 실시간 사용량이나 현재 살아 있는 프로세스를 보증하지 않는 마지막 관측값이다. 토큰·비용·사용 한도는 Codex `/status`로 확인한다.
4. 오래된 작업·종료된 세션은 현재 실행 중이라고 표현하지 않는다. 임의로 transcript나 인증 파일을 읽지 않는다.

가드는 기본적으로 꺼져 있다. `HM_CODEX_GUARD=block`으로 시작한 세션에서만 감지한 위험 셸 명령을 차단한다. 현재 Codex는 hook에서 사용자 확인을 요청하는 결정을 지원하지 않는다. 차단된 명령을 확인 없이 우회하거나 자동 재실행하지 않는다. 가드는 명령 전체를 해석하는 보안 경계가 아니며, 기존 Claude guard와 같은 탐지 한계를 가진다.
