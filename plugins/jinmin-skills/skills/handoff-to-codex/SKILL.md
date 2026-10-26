---
name: handoff-to-codex
description: >-
  Claude Code 세션의 컨텍스트/토큰이 부족해지거나, 사용자가 현재 작업을 Codex CLI로
  넘기고 싶을 때 사용한다. 트리거: "codex로 넘겨줘", "핸드오프", "handoff to codex",
  "토큰 부족", "컨텍스트 부족", "codex한테 인계해줘". 현재까지의 진행상황·결정사항·
  다음 단계를 구조화된 브리핑으로 정리해 HANDOFF.md와 감사 로그로 저장하고, 바로
  실행할 수 있는 `codex --cd ... "..."` 명령을 제시한다. Codex CLI 자체 기능만으로
  동작한다.
---

# Codex로 핸드오프

## 절차

1. **정보 수집** (프로젝트 루트에서):
   ```
   git branch --show-current
   git status --short
   git diff --stat
   git log --oneline -10
   ```
   프로젝트 루트에 `AGENTS.md`가 있는지도 확인한다 (`ls AGENTS.md`). 없다면 브리핑 끝에
   `agents-md-sync` 스킬로 먼저 정비하길 권하는 메모를 남긴다.

2. **브리핑 작성** — 이번 세션에서 사용자와 나눈 대화를 바탕으로 아래 템플릿을 채운다.
   결정사항은 "무엇을 왜 그렇게 했는지"까지 써야 다음 에이전트가 재추론하지 않는다.

   ```markdown
   # Handoff: <작업 제목> (Claude Code → Codex)

   ## 목표
   <1~2문장>

   ## 현재 상태
   - 브랜치: <branch>
   - 변경 파일: <git diff --stat 요약>
   - 최근 커밋: <git log --oneline -5>

   ## 결정사항과 근거
   - <결정 1> — 이유: ...

   ## 막힌 부분 / 미해결
   - <있으면 나열, 없으면 "없음">

   ## 다음 단계
   1. ...

   ## 참고
   - 이 저장소는 AGENTS.md가 source of truth다. (있는 경우만 포함)
   - 그 외 참고 파일: <경로 목록>
   ```

3. **두 곳에 저장**:
   - **프로젝트 루트 `HANDOFF.md`** (덮어쓰기) — Codex가 세션 시작 시 최우선으로 읽는
     "활성 인계 노트"다. 이 관행은 글로벌 `~/.codex/AGENTS.md`에 이미 등록돼 있어야
     하지만, 프로젝트에 아직 반영 안 됐을 수 있으니 없으면 프로젝트 AGENTS.md에도
     "저장소 루트에 HANDOFF.md가 있으면 최우선으로 읽는다"를 한 줄 추가한다.
   - `.gitignore`에 `HANDOFF.md` 항목이 없으면 추가를 제안한다 (커밋 대상이 아닌
     세션 상태 파일이므로).
   - **`~/.claude/handoffs/<project-slug>-<YYYYMMDD-HHMMSS>.md`** — 저장소 밖 감사
     로그. `project-slug`는 현재 디렉터리 이름(소문자, 예: `my-app`,
     `harness-manager`). `mkdir`은 필요시 먼저 수행.

4. **실행 커맨드 제시**. 초기 프롬프트는 짧게 유지한다 — 실제 맥락은 이미 HANDOFF.md에
   있으므로 긴 텍스트를 셸 인자로 넘기며 따옴표/개행을 다툴 필요가 없다:

   ```
   codex --cd "<project-root>" "HANDOFF.md 파일을 먼저 읽고 이어서 진행해줘"
   ```

   **기본 동작은 이 명령을 사용자에게 그대로 출력**해서 원하는 터미널에 복사해 실행하게
   하는 것이다. Claude가 먼저 나서서 새 프로세스나 터미널 창을 띄우지 않는다.

   사용자가 "지금 바로 열어줘"처럼 즉시 실행을 명시적으로 요청한 경우에만, Windows에서
   새 터미널 창으로 띄운다:
   ```
   Start-Process powershell -ArgumentList "-NoExit","-Command","codex --cd `"<project-root>`" `"HANDOFF.md 파일을 먼저 읽고 이어서 진행해줘`""
   ```

5. **결과 보고 후 종료**. HANDOFF.md와 감사 로그 경로, 실행 커맨드를 요약해서 한두 문장으로
   보고하고 멈춘다 — 지켜보거나 Codex 세션을 대기하지 않는다.

## 작업을 마친 뒤 (Codex 쪽에서)

`~/.codex/AGENTS.md`에 "작업을 마치면 HANDOFF.md 상단에 처리완료를 표시하거나 파일을
삭제한다"는 지침이 있어야 다음 세션에서 낡은 브리핑을 재사용하지 않는다. 없다면
`agents-md-sync` 스킬 실행 시 글로벌 레벨도 함께 점검하도록 안내한다.
