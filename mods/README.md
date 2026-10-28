# jinmin — Claude Code mod 실험장

Claude Code mods(hooks-module 플러그인) 실험을 모아 두는 곳. 마켓플레이스 `jinmin`은 이 레포 루트의 `.claude-plugin/marketplace.json`이고, mod는 이 폴더(`mods/`)에, 스킬 플러그인은 `plugins/`에 있다. 예전 jinmin-mods 레포에서 옮겨 왔다.

## 원칙

- **관찰 우선.** mod에는 샌드박스가 없고 내 권한으로 실행되며, mod가 `tool.call`에서 허락한 명령은 auto mode 분류기를 건너뛴다. jinmin의 mod는 기본적으로 `next(e)`를 그대로 넘기는 관찰형으로 만들고, 막거나 고치는(가드형) mod는 이름에 드러내고 `.catch` 가드를 붙인다.
- **`claude plugin validate`는 안전 보증이 아니다.** 무엇을 쓰는지(hooks·calls·env)만 알려 준다. mod마다 아래 표에 그 목록을 남긴다.
- **user scope로만 설치.** `--scope local/project`는 git 레포 맨 위 `.claude`에 기록된다.
- **훅은 짧게.** 훅에는 시간 제한이 있다. IO는 `session.start`에서 한 번 하고 `$.state`에 캐시, 렌더 훅에서는 IO 금지.
- 남의 mod는 일회용 폴더에서 validate와 소스 확인 후에만 설치.
- guard는 따옴표 안의 명령(`bash -c "rm -rf x"`, `echo "rm -rf"`)은 보지 않는다 — 오탐을 피하려는 선택이라 완전한 방벽은 아니다.

## mod 목록

Codex 대응 패키지는 [`jinmin-codex`](jinmin-codex/README.md)를 본다. Claude hook module과 별도의 Codex lifecycle hook을 사용하며, 선택 설치·hook 신뢰가 필요하다. 테스트는 `node --test mods/jinmin-codex/scripts/mod.test.mjs`, 격리된 실제 CLI 검증은 `node scripts/probe-codex-mod.mjs`다.

| mod | 하는 일 | hooks | calls / env | 관찰 전용 |
|---|---|---|---|---|
| [jinmin-hud](jinmin-hud) | claude-hud 대체 상황판: 입력창 아래(옵션으로 위) 테두리 카드 — 모델·effort·권한 모드·프로젝트·세션 시간 / 컨텍스트 막대(자동 압축 지점 ┊)·토큰·자동 압축까지 남은 양·압축 횟수 / 5시간·7일 한도 막대(시간 위치 │)·속도 편차·초기화까지 / git 브랜치·워크트리·저장소·올릴·받을 커밋·변경 상태·수정·커밋 시각·PR(CI·리뷰). `/hud` 사이드 패널 | session.start, command.run(hud·rename), classic.PostToolUse·UserPromptSubmit, turn.start, tool.call, agent.spawn, turn.complete, session.compact, session.measure, session.end, ui.render(PromptHint·AbovePrompt·Pane) | session.model/root/id/turns/usage/version, process.run(`git status`·`log`·`rev-parse`·`remote` 3초, `gh pr view` 8초·3분 간격), fs.read/exists/list/stat, tool.list, settings.read, agent.list, clock, state, ui.open/close / env 읽기 `MULTI_CLI_WORK_{SESSION_ID,PROJECT_BRIEF}`·`USERPROFILE`·`HOME` · 네트워크는 gh만 | ✔ |
| [codex-watch](codex-watch) | codex 플러그인(`/codex:review`·`adversarial-review`·rescue 작업)이 도는 동안 입력창 위에 `⠹ Codex 리뷰 진행 중 · 2분 13초 · 단계` 한 줄(jinmin-hud가 위에 있어도 그 위에 쌓음), 끝나면 토스트 + 알림 `Codex 리뷰 끝 · 시간 · 요약 — /codex:result`. `/codex-watch`로 진행 중·최근 작업 | session.start, command.run(codex-watch), tool.call(Bash·PowerShell — companion 명령 감지만), turn.complete, session.end, ui.render(AbovePrompt) | process.run(`node codex-companion.mjs status --json` 10초, 도는 동안 5초마다·멈추면 중단), fs.list(companion 위치), clock, state, ui.toast/notify / env 읽기 `USERPROFILE`·`HOME` · 네트워크 없음 | ✔ |
| [guard](guard) | 되돌리기 어려운 셸 명령(`rm -r`·`Remove-Item -Recurse`·`rmdir /s`, `git push --force`/`+ref`/`--delete`, `reset --hard`, `clean -f`, `checkout --`·`restore`, `branch -D`, `stash drop/clear`)을 실행 전에 붙잡아 사라질 것(파일·폴더 수, 커밋 안 된 변경, `git clean -n` 미리보기, 덮어써질 원격 커밋, 다른 곳에 없는 커밋)을 보여 주고 엔진 질문 창으로 확인. 권한 모드(bypass 포함)와 무관하게 묻고, 물을 사람이 없으면(`-p`) 보류. `/guard on|off|status` | session.start, command.run(guard), tool.call(Bash·PowerShell, **가드 — `.catch`로 실패 시 보류**) | ui.ask, session.cwd, fs.stat/list, process.run(`git status`·`clean -n`·`rev-list`·`stash list` 3초), state · 네트워크 없음 | ✘ (가드) |
| [mcw-companion](mcw-companion) | multi-cli-work 세션일 때만: `/mcw`(세션·브리프), 60초 넘는 턴·한도 90% 토스트 | session.start, command.run(mcw), turn.complete, session.measure | command.register, fs.read(브리프 1회), ui.toast, state / env 읽기 `MULTI_CLI_WORK_{SESSION_ID,GENERATION,CLAUDE_SETTINGS,PROJECT_BRIEF}` · 네트워크·process 없음 | ✔ |
| [mcw-chips](mcw-chips) | multi-cli-work 세션 + jk 경로가 있을 때만: 패인 머리줄 칩(할 일·ctx·에이전트·테스트·bg·끝난 bg)과 진행선을 `jk status`/`jk progress`로 자동 표시, `/chips`(원하는 값·보낸 값·전송·지연) | session.start, command.run(chips), tool.call, agent.spawn, turn.start, turn.complete, session.measure, prompt.submit, session.receive, classic.Stop(조직 관리 환경에선 안 돎), session.end | command.register, process.run(`powershell.exe -EncodedCommand` 배치 1회/750ms 창·4초 제한, 폴백 `jk-coding-cli(.ps1)`), fs.exists(cli 위치)·fs.read(테스트 출력 파일), agent.list, clock, state, ui.log(debug) / env 읽기 `MULTI_CLI_WORK_{SESSION_ID,STATUS_DIR}`·`JK_CODING_CLI_{PIPE,ENDPOINT}`·`OS`·`SystemRoot`·`PATH`·`Path` — 토큰은 읽지 않음(자식이 상속) · 네트워크 없음(로컬 named pipe) | ✔ |

## 설치

마켓플레이스 소스는 PC마다 고른다. 같은 이름(`jinmin`)의 마켓플레이스는 하나만 둘 수 있으므로 소스를 바꿀 때는 `claude plugin marketplace remove jinmin` 뒤에 다시 `add`한다. 앱의 위저드와 `hm-cli`가 이 단계를 대신 해 준다.

**새 PC (GitHub 소스)**

```
claude plugin marketplace add rafaam11/harness-manager
claude plugin install jinmin-hud@jinmin --scope user
claude plugin install guard@jinmin --scope user
claude plugin install codex-watch@jinmin --scope user
claude plugin install mcw-companion@jinmin --scope user
claude plugin install mcw-chips@jinmin --scope user
```

**개발 PC (directory 소스)**

```
claude plugin marketplace add <harness-manager 클론 경로>
```

폴더 마켓플레이스 + 상대 경로 source라서 설치 사본이 아니라 **이 폴더를 직접 읽는다.** 수정 후 실행 중인 세션에서 `/reload-plugins`만 하면 반영된다(`claude plugin list`의 `Read from:`으로 확인).

mod는 샌드박스 없이 내 권한으로 돈다. 설치 전에 위 표의 hooks·calls를 보고, 필요하면 소스를 읽을 것.

## version 규약

mod를 고칠 때마다 `.claude-plugin/plugin.json`의 `version`을 올린다. GitHub 소스에서는 version이 그대로면 `claude plugin update`가 "already at the latest"로 건너뛴다.

## 개발 루프

```
claude plugin validate mods/<mod>     # 무엇을 hook하고 call하는지
claude plugin test mods/<mod>         # *.test.tsx
claude --debug                        # 훅이 건너뛰어진 이유는 debug 로그의 "<mod>:" 줄
```

새 실험: `mods/<name>/`(`.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, `$.state`를 쓰면 `types/index.d.ts`)을 만들고 레포 루트 `.claude-plugin/marketplace.json`의 `plugins`에 한 줄 추가.

## 끄는 법

- 그 세션만: `claude --safe-mode`
- 개별: `/plugin`에서 비활성, 또는 `claude plugin uninstall <mod>@jinmin`

## jinmin-hud 메모

- 기본은 입력창 바로 아래 안내 줄 자리(PromptHint)에 그리고, 엔진 안내 줄(`? for shortcuts`, `esc to interrupt`)은 그 밑에 그대로 둔다. `placement=above` 옵션이면 입력창 위 밴드(AbovePrompt). 셀 단위로 정확히 맞춘 테두리 카드이고 한글은 2칸으로 계산한다.
- **크기 대응(multi-cli-work 분할 화면)**: 줄 수는 터미널 높이로 정한다 — 40행↑ 10줄, 30↑ 8, 22↑ 6, 16↑ 4, 11↑ 2, 그 아래 1줄 요약. 줄마다 우선순위(컨텍스트 > 사용 한도 > git)가 있어 빈 줄부터 빠진다. 100칸↑ 두 열, 64칸↑ 한 열, 그 아래 짧은 라벨, 6줄 미만이나 50칸 미만은 테두리 없음. 넘치는 줄은 낮은 우선순위 조각부터 버린다.
- 스피너는 턴이 도는 동안만 250ms, 한가할 때는 5초마다 시간만 갱신. 도구·에이전트·할 일·캐시 줄은 0.4.0에서 사용자 요청으로 뺐다(할 일·에이전트는 `/hud` 패널에만).
- 추론 강도는 세션 시작 때 설정의 `effortLevel`로 먼저 보여 주고, 첫 도구 호출 뒤 실제 턴 값으로 바뀐다.
- 입력창 위에 둘 때는 엔진이 그리는 `[-]`로 접는다. 전체 정보는 `/hud`(사이드 패널), 닫기는 `/hud close`.
- 권한 모드·effort는 클래식 훅 입력에서만 오므로 조직 관리 환경에선 비어 있을 수 있다.
- 세션 이름은 엔진 API가 없어 이 세션의 `/rename`만 잡는다.
- 옵션: `/plugin configure jinmin-hud@jinmin` — 위치(below/above), 캐시 TTL(기본 300초, Max는 3600), 7일 표시 기준, 밴드 최대 줄 수.
- claude-hud에서 전환을 마쳤다: `statusLine` 키와 claude-hud 플러그인·마켓플레이스는 쓰지 않는다. 남은 claude-hud 폴더는 정리(Cleanup) 대상이다.

## 백로그

1. 앱 ↔ mod 브리지 — `session.measure`의 세션별 컨텍스트 %를 `MULTI_CLI_WORK_STATUS_DIR`에 기록해 multi-cli-work 탭에 게이지로 (앱 변경 필요). 칩 경로는 mcw-chips로 해결(앱 변경 없이 `jk status`/`jk progress`), 상태 파일 전환은 남음. 후속: 앱 `control-commands.ts`에 `batch` 명령.
2. 모델 라우터 — 짧은 질문은 하위 모델로. 하향을 금지하는 레포 규칙과 충돌할 수 있으므로 cwd 판정 필수.
3. 참고 mod 차용 검토: deepskyblue86/claude-markdown-mod, sezaakgun/cc-arcade, halluton/Mindful-Claude, Charlie0113-T/claude-agent-flow, devbrother2024/devbrothers-mods.

참고: Solostack 「클로드 코드 모드, 어디까지 되고 어디서 막힐까」(2026-10-16) — 안전·한계 정리.
