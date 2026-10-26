---
name: jinmin-setup
description: >-
  harness-manager로 이 PC의 Claude Code·Codex 개발환경(툴체인, 설정, 플러그인, MCP, 스킬)을 레포 manifest와
  같게 맞추는 대화형 셋업. 트리거: "설치해줘", "셋업해줘", "개발환경 맞춰줘", "jinmin-setup", "새 PC 세팅",
  "doctor 돌려줘", "뭐가 빠졌는지 봐줘". hm CLI(doctor → install)를 부르고, 무엇을 할지 먼저 보여 준 뒤
  사용자가 고른 것만 실행한다.
---

# jinmin-setup — AI 셋업 위저드

harness-manager 앱의 셋업 위저드와 같은 일을 대화로 한다. **직접 설정 파일을 고치거나 manifest에 없는 명령을
돌리지 않는다.** 모든 변경은 `hm` CLI를 거친다 — hm이 관리 키·마커 블록만 바꾸고, 바꾸기 전에 백업한다.

## 0. hm 찾기

차례대로 시도하고, 처음 되는 것을 `HM`이라 부른다.

1. 설치된 앱의 심: `~/.harness-manager/bin/hm.cmd` (PowerShell: `& "$HOME\.harness-manager\bin\hm.cmd" …`)
2. 레포 클론 안이면: `node out/main/cli.js …`. `out/main/cli.js`가 없으면 먼저
   `$env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"; npm ci; npm run build`
3. 둘 다 없으면 레포가 없는 것이다. `scripts/bootstrap.ps1`을 안내한다(레포 README·AGENTS.md 참고).

`HM doctor --json`이 레포를 못 찾으면 `HM … --repo <레포 경로>`를 붙이거나 `HM_REPO` 환경변수를 쓴다.

## 1. 진단

```
HM doctor --json
```

카드 8개(툴체인, Claude Code, Codex, 플러그인, 스킬, MCP, cua-driver, dotfiles)의 상태를 표로 요약한다.
정상이 아닌 검사(`state`가 missing·drift·error)만 이름과 `detail`을 함께 보여 준다. info·skipped는 한 줄로 묶는다.

## 2. 프로필과 마켓플레이스 소스 묻기

`HM settings --json`으로 지금 값을 읽고, 사용 중인 CLI의 질문 도구(선택지를 주는 도구가 있으면 그것)로 묻는다.

- 프로필: `core`(CLI와 git·gh·node·ripgrep) / `dev`(+uv·python·scoop 도구·cua-driver) / `full`(전부)
- jinmin 마켓플레이스 소스: `directory`(레포 폴더 — mod를 고치는 개발 PC) / `github`(그 밖의 PC)

답을 받으면 `HM settings --profile <p> --self-source <s>`.

## 3. 할 일 미리보기와 고르기

```
HM install --json
```

`steps` 중 `actionable: true`인 것을 섹션별로 보여 준다. 각 step의 `actions`(실행할 명령, 고칠 파일의 diff)를 함께 보여
준다 — 특히 다음은 따로 짚는다.

- 마켓플레이스를 다시 붙이는 step: 그 마켓플레이스의 플러그인을 내렸다 다시 설치한다.
- 설정 파일 step(`claude.settings`, `codex.config`, `*.claude-md`, `*.agents-md`): diff를 보여 준다.
- `manual: true` step: 자동으로 하지 않는다. `actions[0].summary`의 안내를 전한다.

어떤 step을 실행할지 묻는다(기본: 전부). **실행 전에 한 번 더 확인받는다.**

## 4. 실행

```
HM install --run --only <id,id,…> --yes
```

- 종료 코드 0: 모두 완료 또는 이미 맞음. 5: 실패한 step이 있음. 2: 사용법 오류.
- 실패하면 stderr 로그에서 원인을 찾아 설명하고 다음 중 하나를 제안한다. 사용자가 고르기 전에는 고치지 않는다.
  - 패키지 관리자 없음(winget·scoop): 먼저 설치하는 방법
  - 네트워크·인증: 7단계 로그인 뒤 다시 실행
  - 그 밖: 같은 step만 `--only <id>`로 다시 실행
- 로그에 비밀값이 보이면 그대로 옮기지 않는다(hm은 env 값을 `***`로 가린다).

## 5. 로그인 안내

hm은 로그인을 대신하지 않는다. 필요한 것만 안내한다.

| 대상 | 명령 |
|---|---|
| GitHub CLI | `gh auth login` |
| Claude Code | `claude` (처음 실행 시 브라우저 로그인) |
| Codex CLI | `codex login` |
| claude.ai 커넥터 | 웹 claude.ai → 설정 → 커넥터 |

## 6. 마무리

`HM doctor --json`을 다시 돌려 카드 상태를 처음과 비교해 보여 준다. 남은 노랑·빨강과 그 이유(직접 해야 하는 항목,
정리 화면에서 아카이브할 항목 등)를 한 줄씩 적는다. 새로 설치한 플러그인·MCP는 **새 세션부터** 보인다고 알린다.
