---
name: agents-md-sync
description: >-
  현재 프로젝트의 CLAUDE.md와 AGENTS.md를 정비해서 Claude Code와 Codex CLI(및 다른
  Agent Skills 표준을 따르는 도구)가 같은 프로젝트 지식을 읽도록 만든다. 트리거:
  "AGENTS.md 동기화해줘", "agents-md-sync", "codex랑 호환되게 정리해줘",
  "CLAUDE.md를 AGENTS.md로 옮겨줘", "이 프로젝트도 codex에서 쓸 수 있게 해줘".
  CLAUDE.md만 있거나, AGENTS.md만 있거나, 둘 다 없거나, 둘 다 있어서 내용이 갈라진
  프로젝트 어디서나 실행 가능.
---

# AGENTS.md ↔ CLAUDE.md 동기화

## 원칙

Codex CLI는 `AGENTS.md`만 읽고 import 구문이 없다 — 실제 내용이 그 파일 안에 있어야 한다.
Claude Code는 `CLAUDE.md`만 읽지만 `@AGENTS.md` 한 줄로 AGENTS.md 전체를 가져올 수 있다
(공식 지원, Windows에서도 symlink 없이 동작). 따라서 **AGENTS.md를 원본(source of truth)
으로 두고, CLAUDE.md는 얇은 import 래퍼**로 만드는 것이 유일한 정답이다. 반대로
(CLAUDE.md를 원본으로 두는 것)는 Codex가 못 읽으므로 하지 않는다.

## 절차

1. 현재 작업 디렉터리(프로젝트 루트)에서 `CLAUDE.md`, `AGENTS.md` 각각 존재 여부를 확인한다.

2. **CLAUDE.md만 있음**:
   - CLAUDE.md 본문을 읽고 AGENTS.md로 이관할 초안을 만든다. 이때:
     - "Claude가 판단한다" 류의 Claude 전용 표현은 "에이전트가 판단한다"처럼 도구 중립적으로 바꾼다.
     - `.claude/`, `~/.claude/skills/` 등 Claude Code 전용 경로를 언급하는 문장은, 같은 의미의
       Codex/오픈 스킬 표준 경로(`~/.agents/skills/`)도 함께 언급하도록 일반화한다.
     - "This file provides guidance to Claude Code..." 같은 상투구 도입부는 "AI 코딩 에이전트를
       위한 이 저장소 가이드"처럼 도구 중립적으로 바꾼다.
     - 순수 기술 내용(빌드 명령, 아키텍처, 트러블슈팅, 정책 등)은 손대지 않고 그대로 옮긴다 —
       요약하거나 축약하지 않는다.
   - AGENTS.md를 새로 쓴다.
   - CLAUDE.md를 `@AGENTS.md` + (있다면) Claude 전용 섹션만 남기고 덮어쓴다. Claude 전용
     섹션에 넣을 것: 이 프로젝트에서만 쓰는 Claude Code 스킬 안내, plan mode 지침 등
     — 없으면 `@AGENTS.md` 한 줄만 남긴다.

3. **AGENTS.md만 있음**: CLAUDE.md를 `@AGENTS.md` 한 줄로 새로 만든다. AGENTS.md 내용은
   건드리지 않는다.

4. **둘 다 없음**: 사용자에게 먼저 `/init` 실행을 제안한다 (Claude Code가 코드베이스를 분석해
   기초 문서를 만들어줌). 그 결과로 CLAUDE.md가 생기면 2번 절차를 이어서 실행한다.

5. **둘 다 있음**: 자동으로 병합하지 않는다. 두 파일을 비교해서 겹치는 부분과 서로 다른 부분을
   사용자에게 보여주고, 어느 쪽을 원본으로 삼을지 확인한 뒤 그 결정에 따라 2번 절차를 적용한다.

6. **이관 후 항상**: 새로 쓴 AGENTS.md와 원래 CLAUDE.md를 diff 관점으로 다시 훑어서, 빌드
   플래그·트러블슈팅 항목·경로표처럼 구체적인 사실이 누락되지 않았는지 확인한다. 누락이
   있으면 즉시 보완한다.

7. **핸드오프 관행 한 줄 추가**: AGENTS.md 끝부분에 다음 문장이 없으면 추가한다 (없어도
   동작은 하지만 — `~/.codex/AGENTS.md`/`~/.claude/CLAUDE.md` 글로벌 레벨에 이미 있다면
   중복이니, 글로벌 레벨이 설정돼 있는지 먼저 확인하고 없을 때만 추가):

   ```
   ## 세션 인계
   - 저장소 루트에 `HANDOFF.md`가 있으면 세션 시작 시 최우선으로 읽고 그 브리핑을 신뢰한다.
   ```

8. **git 상태 확인**: `git status`로 이 저장소가 git 추적 중인지 확인한다. 만약 CLAUDE.md
   안에서 다른 사용자 계정명이나 다른 OS 경로(예: macOS `/Users/xxx/...`)처럼 팀원의 흔적이
   보이면, 이 파일이 **팀 공유 컨벤션 파일**일 가능성을 사용자에게 알린다. 이 경우
   커밋 메시지·브랜치명은 준비해도 되지만 **실제 커밋·푸시·PR 생성 여부와 타이밍은 항상
   사용자에게 확인한 뒤 진행한다** — 임의로 커밋/푸시하지 않는다. 팀 흔적이 없는 개인/단독
   프로젝트라면 사용자 확인 하에 단일 커밋으로 정리해도 된다.

9. 결과를 요약 보고한다: 무엇을 어디로 옮겼는지, 무엇이 그대로인지, 커밋이 필요한지 여부.
