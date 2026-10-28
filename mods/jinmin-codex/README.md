# jinmin-codex 0.1.0

Codex CLI용 hook 패키지다. Node 22.12 이상과 플러그인 hook을 지원하는 Codex가 필요하다. Codex CLI 0.162.1에서 격리된 실제 CLI 실행으로 검증했다.

```powershell
codex plugin add jinmin-codex@jinmin
```

설치 후 새 세션에서 hook을 검토·신뢰한다. 설치·활성만으로 hook 신뢰를 대신하지 않는다. 기본 공통 프로필에는 자동 설치하지 않는다. 개인 프로필에서 사용할 경우 Codex 활성 플러그인 목록에 `jinmin-codex@jinmin`을 추가한다.

| Claude 기능 | Codex 대응 |
| --- | --- |
| jinmin-hud | `codex-status` 스킬과 `scripts/status.mjs`로 모델·권한·세션·도구·에이전트의 마지막 관측값 조회. 입력창 위 임의 카드 렌더링은 제공하지 않음 |
| mcw-companion | MCW 소유 SessionStart hook으로 프로젝트 브리프와 세션 연결. 이 패키지가 MCW 설정 파일을 고치지 않음 |
| mcw-chips | MCW 앱에서 모델·권한 모드·도구 칩을 표시. 별도 MCW 변경 필요. 컨텍스트 비율·비용은 추정하지 않음 |
| guard | 기본 꺼짐. `HM_CODEX_GUARD=block`인 세션에서 Claude guard와 같은 위험 명령 탐지기로 `PreToolUse`를 차단. hook 승인 질문은 미지원 |
| codex-watch | 셸 도구에서 직접 실행한 `codex exec/review`·`claude -p/--print`의 시작과 도구 반환 관측, 종료 시 systemMessage. 분리 실행한 프로세스의 생존·성공은 보증하지 않음 |

## 상태와 가드

SessionStart는 상태 조회에 필요한 데이터 폴더와 세션 ID를 Codex에 전달한다. 상태 조회 명령은 다음과 같다.

```text
node <설치된 플러그인>/scripts/status.mjs --data <데이터 폴더> --session <Codex 세션 ID>
```

정보는 `PLUGIN_DATA/sessions/<세션 ID의 SHA-256>.json`에 저장한다. 명령 원문·프롬프트·응답·인증 정보는 저장하지 않는다. 조회는 마지막 관측 시각과 함께 해석한다. 실행 중 종료되거나 hook이 꺼진 경우 오래된 관측값이 남을 수 있다. 기록을 자동 삭제하지 않으므로 필요하면 플러그인 데이터 폴더를 별도로 정리한다.

가드를 선택해 켜려면 해당 셸에서 `HM_CODEX_GUARD=block`을 설정한 뒤 Codex를 시작한다. 차단된 명령은 사용자가 영향을 검토하고 직접 실행한다. 승인 질문을 흉내 내거나 `allow`로 권한 정책을 우회하지 않는다. 기존 탐지기는 인용 문자열 속 명령과 셸 간접 호출을 완전히 해석하지 않는다. 샌드박스나 완전한 보안 경계로 사용하지 않는다.

## 개발 검증

```text
node scripts/build-codex-mod.mjs
node --test mods/jinmin-codex/scripts/mod.test.mjs
node scripts/probe-codex-mod.mjs
```

마지막 명령은 임시 홈과 로컬 고정 응답 서버를 사용한다. 사용자 설정·로그인·유료 API를 사용하지 않으며, 검토한 테스트 패키지에 한해 hook 신뢰를 해당 실행에서 우회한다. 스킬 인식, 실제 hook 실행, 위험 명령 차단, 종료 상태 저장을 검증한다.

외부 CLI 종료 메시지는 모의 hook 이벤트로 검증한다. 현재 실행 환경의 정책이 중첩 `claude -p` 실행을 거부하므로 실제 중첩 CLI 완료 메시지는 검증하지 않았다.

공식 계약: [플러그인 hook](https://developers.openai.com/plugins/build/plugins), [hook 이벤트와 현재 제한](https://learn.chatgpt.com/docs/hooks).
