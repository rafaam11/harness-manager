# AGENTS.md

이 저장소에서 작업하는 코딩 에이전트(Claude Code, Codex CLI 등)를 위한 지침이다. `CLAUDE.md`는 이 파일을 `@AGENTS.md`로 불러오는 래퍼일 뿐이다. 내용은 여기에만 쓴다.

> **v3.0.0 전환 중이다.** 아래 "v3 전환"이 현재 작업의 기준이다. "현재 코드"는 지금 트리에 있는 코드를 설명한다(M1에서 v2 제거 대상을 걷어낸 상태, package.json 버전은 아직 2.0.6).
> 설계 스펙은 `docs/superpowers/specs/v3-design.md`에 있다.

---

## v3 전환

### 목표
새 PC에서 이 레포를 clone하고 앱이나 스크립트를 실행하면 개인 CLI 개발환경 전체가 같게 세팅되게 한다. 그 상태는 **심플한 상태판 대시보드**로 보고 관리한다. 세팅 대상은 다음과 같다.
- 툴체인
- Claude Code·Codex CLI와 그 설정
- 플러그인·스킬
- MCP
- cua-driver
- 셸·git dotfiles

- **doctor**: 무엇이 되어 있고 무엇이 빠졌는지 검사해 카드 8개로 보여 준다. 카드는 툴체인, Claude Code, Codex, 플러그인, 스킬, MCP, cua-driver, dotfiles다. 상태는 초록·노랑·빨강 점과 글자 라벨로 함께 표시한다.
- **install**: manifest 기반 step 엔진이다. plan → dry-run → run → verify 순서로 돌고 멱등이다.
- **capture**: 현재 PC에서 바꾼 설정을 레포 템플릿으로 끌어온다. diff를 보여 준 뒤 쓴다.
- **위저드 두 겹**: 앱 Wizard 페이지 하나와 AI용 `jinmin-setup` 스킬 하나다. 둘 다 headless `hm-cli`를 사용한다.
- Claude와 Codex를 **같은 수준**으로 관리한다. 대상은 공통 AGENTS.md, 설정, 마켓플레이스·플러그인, MCP다.
- jinmin-mods 레포를 흡수한다. hook mod 5개는 `mods/`로, 마켓플레이스 `jinmin`은 레포 루트 `.claude-plugin/marketplace.json`으로 옮긴다.

### 비목표
- 폴더 구조와 작업 프로젝트 규약은 multi-cli-work가 맡는다. jk MCP와 Multi CLI Work hook은 그 앱이 주입하므로 이 앱은 관리하지 않는다.
- v2의 Timeline, Workspace·git, News, Glossary, GitHub stars, live sessions, recall, usage, translate는 제거한다.
- 회사 전용 스킬은 이 public 레포에 넣지 않는다. 별도 private 레포에서 관리하고, 접근 검사를 통과할 때만 조건부로 설치한다.
- 비밀값(토큰, OAuth, `auth.json`)은 레포에 넣지 않는다. 인증은 위저드 마지막에 안내만 한다.

### 확정 결정 (다시 묻지 않는다)
- 버전은 **v3.0.0**이다. v2.x 태그가 이미 있으므로 2.0.0을 다시 쓰면 updater가 다운그레이드로 판단한다.
- v2 기능 중 **정리/아카이브**와 **설정 편집기**만 남긴다. 카탈로그의 스킬·플러그인·MCP 조회 로직은 섹션 화면의 기반으로 재사용한다.
- 첫 화면은 **상태판 + 섹션 탭**이다. 위저드는 상단 버튼으로 연다.
- 레포는 **public을 유지**하고 민감한 내용만 걸러낸다. electron-updater 익명 업데이트 때문이다.
- Claude 마켓플레이스 이름은 **`jinmin`**을 유지한다. 플러그인 ID가 바뀌지 않게 하기 위해서다.
- 툴체인은 프로필 **core / dev / full**로 고르고, 항목별로 켜고 끈다.
- UI 코드와 main 기반 코드는 **multi-cli-work(mcw)에서 최대한 승계**한다.
- **브랜치: `dev`에 직접 작업한다.** v3 작업 브랜치나 `main`은 만들지 않는다. 원격의 기본 브랜치도 `dev`다.
- **IPC: mcw식 타입드 contextBridge로 바꾼다(M2).** 기준은 `src/shared/api-types.ts` 인터페이스 하나다. 채널 맵 타입 하나에서 preload 노출과 main 핸들러 등록을 함께 만들어 채널 문자열이 중복되지 않게 한다. main은 보낸 창을 검증하고, 입력은 `ipc-validation`(정확한 키 집합 검사)으로 검증한다.
- **jinmin-mods 이전은 단순 복사**로 한다(히스토리는 가져오지 않는다).
- **레포 일괄 최신화(repo-sync)는 역할을 나눈다(M3.5).** HM은 경로 목록을 받는 엔진과 `hm repos sync` CLI를 맡고, 업무 프로젝트→레포 해석·버튼·세션 시작 트리거는 mcw가 맡는다. HM에는 이 기능의 화면이 없다. 계약은 `docs/contracts/repo-sync.md`가 단일 출처이고, mcw의 대체 구현(HM이 없는 PC)도 그 판정 순서를 따른다.
- **jk-external-api를 흡수한다(M12, v3 릴리스 뒤).** 앱 기능 "외부 API" 섹션으로 다시 만들고 소스는 단순 복사한다. 공개 사이트, Worker, 주간 자동 PR은 폐기하고 원 레포는 archive한다.
- **statusLine은 jinmin-hud로 확정했다.** claude-hud 플러그인·마켓플레이스와 `statusLine` 키는 제거했으므로 capture 초기값에 넣지 않는다.
- **마켓플레이스 소스는 PC마다 고른다.** 개발 PC는 레포 폴더를 가리키는 `directory` 소스(수정 후 `/reload-plugins`로 즉시 반영), 새 PC는 GitHub 소스 `rafaam11/harness-manager`를 쓴다. manifest와 위저드에서 선택할 수 있게 한다.

### mod·플러그인 규약
- **`mods/*`의 `plugin.json`에는 version이 있다. mod를 고칠 때마다 version을 올린다.** GitHub 소스에서는 version이 그대로면 `claude plugin update`가 "already at the latest"로 건너뛴다. version을 빼서 커밋 SHA를 따라가게 할 수도 있지만, 지금은 version 범프 규약을 유지한다. `plugins/*`(스킬 플러그인)에는 version을 두지 않는다.
- 같은 이름(`jinmin`)의 마켓플레이스는 동시에 둘 수 없다. 소스를 바꿀 때는 `claude plugin marketplace remove jinmin` → `add` 순서로 한다.
- 이전 검증 기준선(Claude Code 2.1.310):
  - `claude plugin validate`는 마켓플레이스와 mod 5개가 모두 통과해야 한다.
  - `claude plugin test`는 112개가 모두 통과해야 한다(jinmin-hud 47, guard 7, codex-watch 3, mcw-companion 2, mcw-chips 53).
  - 이전한 뒤에도 같은 숫자가 나와야 한다.
- Codex도 같은 마켓플레이스를 읽는다(`codex plugin marketplace add <레포>`). hook mod는 Codex에 설치돼도 실행되지 않으므로 Codex에는 `plugins/*`만 enable한다(스펙 D20).
- `mods/`·`plugins/`는 앱 빌드와 무관하다. 앱의 tsconfig·vitest는 `src/`만 보고, electron-builder는 `out/**`만 담는다. mod 테스트는 `claude plugin test mods/<mod>`로 돌린다.

### 마일스톤
| M | 내용 | 상태 |
|---|---|---|
| M0 | 문서 정리: 이 파일, CLAUDE.md 래퍼, v3 설계 스펙 | 완료 |
| M1 | v2 제거 대상 걷어내기, 얽힌 4곳 끊기, 의존성 정리 | 완료 |
| M2 | mcw 기반 승계(Electron 43, 토큰·테마·toast·TitleBar·window-*·updater·json-store 등), 타입드 IPC 전환 | 완료 |
| M3 | jinmin-mods 흡수(`mods/`, 마켓플레이스, `plugins/jinmin-skills`) | 완료 |
| M3.5 | 업무 프로젝트 레포 일괄 최신화(repo-sync) 엔진과 `hm-cli` 골격. mcw가 CLI로 호출한다(`docs/contracts/repo-sync.md`) | 완료(확인 대기) |
| M4 | manifest 스키마와 capture 엔진 | 완료 |
| M5 | doctor와 Dashboard 카드, 섹션 페이지(읽기 전용) | 완료 |
| M6 | install step 엔진, merge(JSON/TOML/마커), LogTerminal | 엔진·화면 완료(확인 대기). PS 프로필·gitconfig·WT capture/install은 남음 |
| M7 | Wizard 페이지, `hm-cli`, `jinmin-setup` 스킬, `scripts/bootstrap.ps1` | |
| M8 | Cleanup 확장(깨진 symlink, loose 스킬 중복, Codex 대상) | |
| M9 | 회사 스킬을 private 레포로 이관(별도 레포 작업) | |
| M10 | v3.0.0 릴리스 | |
| M11 | jinmin-mods 폐기 | |
| M12 | jk-external-api 흡수("외부 API" 섹션)와 원 레포 폐기 | |

### v3 불변 원칙
- **사용자 설정 불가침.** CLI가 직접 쓰는 파일(`settings.json`, `~/.claude.json`, `config.toml`)은 통째로 덮어쓰지 않는다.
  - JSON은 레포가 정의한 **관리 키만** deep-merge한다.
  - TOML은 관리 테이블만 바꾼다. 주석이 보존되지 않으면 마커 블록 방식으로 전환한다.
  - 텍스트 파일(PS 프로필 등)은 `# >>> harness-manager >>>` … `# <<< harness-manager <<<` 마커 블록만 관리한다. 마크다운(AGENTS.md)은 `#`이 제목이라 `<!-- >>> harness-manager >>> -->` … `<!-- <<< harness-manager <<< -->`를 쓴다.
  - 쓰기는 반드시 `lib/safe-write.ts` 경로를 탄다.
- **경로 allowlist는 경로 단위로 연다.** manifest에서 정확한 경로 목록을 파생하고, 폴더 전체를 열지 않는다.
- **렌더러는 step id만 보낸다.** 실행 파일과 인자는 main이 manifest에서 정한다. 렌더러가 보낸 임의 문자열은 실행하지 않는다.
- **엔진은 Electron에 의존하지 않는다.** doctor·install·capture는 순수 Node 모듈로 만들어 앱, `hm-cli`, vitest가 함께 쓴다. 테스트는 `HM_HOME`·`HM_CLAUDE_HOME`·`HM_CODEX_HOME` 같은 환경변수로 임시 홈을 써서 실제 홈을 건드리지 않는다.
- **public 노출 점검.** 다음은 커밋하지 않는다.
  - 개인 경로(사용자 홈의 절대경로). 템플릿에서는 `~`나 `%USERPROFILE%`로 쓴다.
  - 개인 배경 지침. 이것은 로컬 전용 `~/.harness-manager/profile/AGENTS.local.md`에 둔다.
  - 회사명이 들어간 스킬
  - 비밀값
- Codex의 profile toml과 `~/.codex/multi-cli-work.config.toml`은 읽기 전용이다.

### UI 규약 (mcw에서 이어받음)
- 글자 크기는 5단계 타입 토큰만 쓰고 11px 미만은 쓰지 않는다. contract 테스트로 강제한다.
- `transition: all`은 쓰지 않는다. 모션은 토큰으로만 정의하고 reduced-motion을 따른다.
- 의미를 색만으로 전달하지 않는다. 글자 라벨을 함께 쓰고, 상태색과 분류색을 섞지 않는다.
- UI 문구는 한국어로 쓴다. `window.confirm` 대신 앱 다이얼로그를 쓴다.
- `App.tsx`는 셸 역할만 하게 얇게 유지한다. 화면은 `pages` 레지스트리와 view 상태 하나로 전환한다.
- 주석은 "왜"를 설명한다.

---

## 현재 코드

Claude Code와 Codex의 로컬 환경(`~/.claude`, `~/.claude.json`, `~/.codex`)을 관리하는 로컬 전용 Electron 데스크톱 앱이다. 사용자 자신의 머신에서만 동작하고 외부로 노출되지 않는 것을 전제로 한다.

### 명령어
단일 electron-vite 프로젝트다(모노레포 아님). 모든 명령은 루트에서 실행한다.

```
npm install          # 의존성 설치
npm run dev          # electron-vite dev (main/preload/renderer HMR + Electron 창)
npm test             # vitest run
npm run typecheck    # tsc --noEmit (node 패스 + web 패스 2회)
npm run build        # typecheck + electron-vite build → out/
npm run icon         # scripts/generate-icon.mjs → build/icon.ico·icon.png
npm run dist         # build + electron-builder --win --publish never (로컬 검증·수동 업로드 fallback)
npm run dist:linux   # build + electron-builder --linux --publish never (Linux/WSL/Docker 필요)
```
- **검증 순서**: `npm test` → `npm run typecheck` → `npm run build`(→ `npm run dist`). 린트 도구는 없다.
- **테스트**: vitest를 쓴다(`vitest.config.ts`). 대상은 `src/**/*.test.ts`이고 node 환경, forks pool에서 돈다. `src/renderer/src/markdown.test.ts`만 파일 주석으로 jsdom 환경을 쓴다. CI 릴리스 워크플로는 아직 테스트를 돌리지 않는다.
- **포트·로컬 서버가 없다.** renderer ↔ main 통신은 전부 IPC다.
- `npm install` 뒤 `npm run dev`가 "Electron uninstall"로 실패하면 Electron 바이너리 다운로드가 빠진 것이다. `node node_modules/electron/install.js`로 받는다.
- 화면 확인이 필요하면 `npx electron-vite dev --remoteDebuggingPort 9333`으로 띄우고 CDP(`/json/list` → `Runtime.evaluate`)로 DOM을 읽는다. 백그라운드 창 캡처는 갱신이 늦을 수 있다.
- electron-builder 첫 빌드에서 winCodeSign 캐시 추출이 실패할 수 있다. 원인은 Windows에서 개발자 모드나 관리자 권한이 없어 darwin 심볼릭 링크를 만들지 못하는 것이다. `~/AppData/Local/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/`에 `7za x ... '-x!darwin'`으로 darwin 폴더만 빼고 수동 추출하면 된다.

### 안전 모델 (v3에서도 유지)
사용자의 살아 있는 환경을 건드리므로 모든 파일 변경은 아래 경로를 통과한다. 새 기능도 이 경로를 우회하지 않는다.

1. **경로 allowlist**(`src/main/lib/path-guard.ts`)
   - `guardPath()`가 경로를 resolve한 뒤 prefix를 검사한다. 실패하면 `PathViolationError`(403)를 던진다.
   - 허용 루트는 `config.ts`의 `ALLOWED_ROOTS`에 등록된 provider들의 home·configFiles·appData를 더한 것이다. `ALLOWED_ROOTS`는 `~/.claude`, `~/.claude.json`, `CODEX_HOME`(`~/.codex`), `~/.harness-manager`다.
   - 조회 핸들러도 경로 인자를 받으면 반드시 이 검사를 통과해야 한다.
2. **쓰기 직렬화**(`lib/lock.ts`)
   - 모든 변경 연산은 `withLock()` in-process 뮤텍스로 직렬화한다.
   - 이 방식은 앱이 하나만 떠 있어야 성립한다. 그래서 `app.requestSingleInstanceLock()`으로 단일 인스턴스를 강제한다.
3. **낙관적 동시성과 백업**(`lib/safe-write.ts`)
   - 쓰기는 다음 순서로 진행한다: `baseHash`(sha256) 대조 → `validateConfig` 구조 검증 → `.bak` 백업(20개 순환) → temp 파일 작성 → atomic rename.
   - `baseHash`가 맞지 않으면 `ConflictError`(409)를 던진다.
   - 백업은 `~/.harness-manager/backups`(`BACKUP_DIR`) 한 곳이다. 목록·복원은 설정 파일 basename으로 소속을 판단하고, 다른 파일의 백업으로는 복원하지 않는다. v2의 `~/.claude/backups/harness-manager`는 더 이상 쓰지 않는다.
4. **사용자 레포의 git 작업(repo-sync)**
   - 대상 레포는 path-guard 밖이다. 대신 다음 규칙으로 지킨다.
     - 셸 없이 고정된 인자 목록만 실행한다: `rev-parse`·`status`·`fetch --prune`·`rev-list`·`merge --ff-only @{u}`.
     - reset·force·clean·stash·rebase·push는 쓰지 않는다.
     - 호출자가 준 경로는 레포 최상위일 때만 다룬다.
     - 커밋 안 된 추적 변경, 갈라짐, 진행 중인 merge·rebase, 클라우드 동기화 폴더는 건너뛴다.
   - 인증 프롬프트는 끈다(`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`). 실패는 결과에만 남기고 throw하지 않는다.
5. **삭제하지 않고 아카이브만 한다**(`lib/archive.ts`)
   - 정리 대상은 `~/.claude/archive/<날짜>/<category>/`로 이동하고 `manifest.json`에 기록한다.
   - `journal.json`으로 중단된 작업을 복구할 수 있게 하고, 원위치 복원(`restoreItem`)을 지원한다.
   - 삭제 핸들러는 일부러 만들지 않았다.
   - `cleanup/execute`는 `warn-only` 항목의 이동을 거부한다.

### Main 프로세스 (`src/main/`)
- `index.ts`(mcw 구조 승계)
  - 단일 인스턴스, `Menu.setApplicationMenu(null)`, 기본 캡션 없는 창(`window-chrome.ts`: Windows `titleBarStyle:"hidden"`, Linux `frame:false`)
  - `sandbox: true`, `window-security.ts`가 팝업·외부 이동을 막고 http(s)만 OS 브라우저로 넘긴다. CSP는 `index.html` meta와 `RENDERER_CONTENT_SECURITY_POLICY`가 같아야 한다(테스트가 강제).
  - 종료·업데이트 재시작은 `QuitCoordinator` 한 관문을 지난다. 설치 엔진(M6)의 "실행 중 작업" 확인이 여기에 붙는다.
  - `HARNESS_MANAGER_USER_DATA`가 있으면 userData를 바꿔 끼운다(테스트 격리).
  - GUI 실행의 PATH 문제는 기동 시 `platform-env.ts`가 고친다.
- **IPC**(타입드, 단일 출처 `src/shared/api-types.ts`)
  - `ApiChannels` 맵의 키가 곧 채널 이름("영역:동작")이다. `API_CHANNELS` 목록이 맵과 어긋나면 컴파일 에러가 난다.
  - `preload/index.ts`는 목록에 있는 채널만 통과시키는 `window.hm.invoke/on`을 노출한다. 채널별 코드를 손으로 쓰지 않는다.
  - `main/api-handlers.ts`의 `createApiHandlers(deps)`가 채널마다 핸들러를 정의한다. 인자는 `unknown`으로 받아 `ipc-validation.ts`로 좁힌다(400). 창·업데이트 같은 Electron 의존은 `deps`로 주입한다.
  - `main/ipc.ts`의 `registerMainIpc`가 전부 등록하고, 메인 창이 아닌 sender는 403으로 거절한다. throw 대신 `ApiResult` 봉투(`{ok,data}`/`{ok:false,statusCode,error}`)를 돌려 403/404/409/422가 renderer까지 간다.
  - 렌더러는 `call("채널", ...args)`(`api/client.ts`)로 부르고, 실패는 `ApiError(status)`로 받는다.
  - **새 기능 = `ApiChannels`에 항목 추가 → `API_CHANNELS`에 추가 → 핸들러 구현.** 렌더러는 식별자만 보내고 경로·명령은 main이 정한다(예: `cleanup:execute`는 경로 목록만 받고 main이 다시 스캔해 후보와 맞는 것만 옮긴다).
- `updater.ts`(+`updater-platform.ts`, `updater-log.ts`): electron-updater 배선. packaged에서만 동작하고, 상태는 `updater:event`로 push하며 `updater:status`로 현재 상태를 읽는다. 무음 설치 로그는 `userData/logs/updater.log`(512KB 순환). electron-updater는 CJS라 default import 후 구조분해한다.
- 기반 모듈(이후 마일스톤용): `storage/json-store.ts`(앱 상태 파일 — 교차 프로세스 잠금·atomic rename·검증된 `.bak`), `providers/provider-launch.ts`(`findOnPath`·`detectExecutables`), `window-progress.ts`(작업표시줄 진행), `utf8.ts`.
- **hm-cli**(`cli.ts`, electron-vite main의 두 번째 진입점 → `out/main/cli.js`): Electron을 import하지 않는다.
  - 개발: `npm run build` 뒤 `npm run hm -- repos sync --paths <경로>`
  - 설치본: 앱이 기동할 때 `~/.harness-manager/bin/hm.cmd`(사람용)와 `hm-cli.json`(다른 앱이 셸 없이 spawn)을 적는다(`cli-shim.ts`). 실행 파일을 `ELECTRON_RUN_AS_NODE=1`로 띄워 asar 안의 cli.js를 돌린다. 개발 빌드와 `HARNESS_MANAGER_USER_DATA` 실행은 심을 쓰지 않는다.
  - `HM_HOME`을 주면 `~/.harness-manager` 대신 `<HM_HOME>/.harness-manager`를 쓴다(테스트·시험 실행 격리).
- `services/repo-sync/`: 레포 일괄 최신화 엔진. `sync-repo.ts`(레포 하나의 판정과 ff-only), `runner.ts`(동시 실행 상한, 프로세스 안·사이 중복 제거, 쿨다운, `waitMs` 중간 보고), `state.ts`(`repo-sync/state.json`, json-store), `cloud.ts`, `summary.ts`. 테스트는 `test-fixtures.ts`가 임시 bare 원격과 클론 두 개로 실제 git을 돌린다.
- **install(M6)**: `services/install/`
  - step은 doctor 검사에서 만든다(`engine.ts`). id 체계가 같아서, 실행 뒤 같은 검사로 다시 확인한다. 이미 정상이면 건너뛰므로 멱등이다.
  - 실행 순서: 패키지 → 도구 → 전역 CLAUDE.md·AGENTS.md → Claude 설정·마켓플레이스·플러그인 → Codex → MCP → 외부 스킬.
  - 렌더러·CLI는 step id만 보낸다. 명령과 인자는 manifest에서 main이 만든다.
  - 실행기(`exec.ts`)는 셸을 쓰지 않는다. `.cmd` 심만 cmd.exe로 돌리고, cmd 특수문자가 든 인자는 거절한다. 시간 제한을 넘기거나 취소하면 프로세스 트리를 끝낸다.
  - 파일 merge(`merge.ts`)
    - JSON: 관리 키만 바꾸고, 문자열 배열은 합친다.
    - TOML: 관리 키 줄만 바꾸거나 넣는다. 주석·순서는 보존하고, 결과를 다시 파싱해 확인한다. 스칼라만 다룬다.
    - 마크다운: `<!-- >>> harness-manager >>> -->` 블록만 바꾼다. 마커 없던 AGENTS.md는 관리 섹션을 블록으로 옮긴다.
    - 쓰기는 capture와 같은 `writeFileChecked`로 한다(원본 대조, 백업, temp → rename).
  - 같은 이름 마켓플레이스의 소스가 다르면 remove → add 하고, 그 마켓플레이스에서 빠진 플러그인을 같은 step에서 다시 설치한다.
  - MCP env 자리표시는 실행 환경에서 채운다. 값은 미리보기와 로그에서 가린다.
  - 한 step이 실패해도 다음 step은 계속한다.
  - 앱 연결
    - 실행은 한 번에 하나만 한다(`InstallSession`, 409).
    - 진행은 `install:event`와 작업표시줄 막대로 보인다.
    - 설치 중 종료는 QuitCoordinator가 묻고 취소한 뒤 끝나기를 기다린다.
  - 화면: "설치" 페이지(`pages/Install.tsx`)는 할 일 목록, 명령, 파일 diff, `LogTerminal`로 되어 있다.
  - CLI: `hm install`(미리보기), `hm install --run --only <id,…|all> --yes`(실패 step이 있으면 종료 코드 5)
  - self 마켓플레이스 소스는 `~/.harness-manager/settings.json`의 `selfMarketplaceSource`(directory 기본 / github)이고, CLI는 `--self-source`로 바꾼다.
- **doctor(M5)**: `services/doctor/doctor.ts`가 manifest·템플릿·로컬 오버레이를 현재 PC와 비교해 카드 8개(`src/shared/doctor-types.ts`)를 만든다.
  - 검사 상태: ok / drift(다름, 노랑) / missing·error(빨강) / info / skipped(프로필 밖). 카드는 빨강 > 노랑 > 초록 > 회색 순으로 정한다.
  - 프로필은 `~/.harness-manager/settings.json`의 `profile`(없으면 full). CLI는 `hm doctor [--profile p] [--all] [--json]`.
  - 섹션별로 보는 것:
    - 툴체인: PATH
    - Claude: CLAUDE.md, 관리 키
    - Codex: AGENTS.md 공개 섹션, 관리 키
    - 플러그인: 마켓플레이스 소스(self는 레포 폴더나 GitHub), provider별 활성, mod 의존성, claude-hud 잔여 폴더
    - 스킬: 외부 스킬, 깨진 링크, 플러그인으로 옮긴 스킬의 낡은 사본
    - MCP: provider별 등록과 명령
    - cua-driver: 설치 위치
    - dotfiles: M6
  - 화면: 첫 화면 "상태판"(`pages/Dashboard.tsx`)은 카드 그리드와 섹션 탭(상태 / 이름 / 상세 표)으로 되어 있고 읽기 전용이다.
- **manifest와 capture(M4)**
  - 레포 `manifest/{packages,tools,plugins,mcp,skills}.json`: 형태는 `src/shared/manifest-types.ts`, 검사는 `services/manifest/validate.ts`(모르는 키는 경고, 절대경로·directory 소스는 오류). `validate.test.ts`가 커밋된 manifest를 검사한다.
  - 레포 `home/`: 배포 템플릿. `home/managed-keys.json`이 settings.json·config.toml에서 관리할 키 목록이다. 템플릿 값은 capture가 채운다.
  - `services/capture/`: 현재 PC → 레포 템플릿. 대상은 agents, claude-md, claude-settings, codex-config, plugins, mcp, skills.
    - 공개·개인 분리: 개인 값은 `~/.harness-manager/profile/`(AGENTS.local.md, `*.local.json`, `manifest.local.json`)로 보낸다.
    - 비공개 낱말 목록은 `profile/private-terms.json`(`{"terms":[…]}`)이다. **이 파일이 없으면 미리보기만 되고 적용은 막힌다.**
    - 공개 파일에 홈 경로·절대경로·이메일·비공개 낱말이 남으면 노출 경고로 적용을 막는다.
    - plugins·mcp·skills는 더하기만 한다(빼기는 사람이 manifest를 직접 고친다). MCP env 값은 옮기지 않고 `${이름}` 자리표시로 적는다.
    - 적용: 렌더러는 대상 id와 미리보기 지문만 보내고, main이 다시 계획해 지문이 같을 때만 계획한 파일을 쓴다(파일 단위 allowlist, 원본 백업, temp → rename). 다르면 409다.
  - 레포 위치: `HM_REPO` → `~/.harness-manager/repo.json`(화면의 "레포 폴더 선택") → 개발 빌드는 앱 경로. CLI는 `--repo`도 받는다.
  - CLI: `hm capture [--dry-run]`, `hm capture --apply --only <id,…> --yes`, `hm manifest validate`(실패 시 종료 코드 3).
  - 화면: "가져오기" 페이지(`pages/Capture.tsx`)가 항목별 diff·노트·노출 경고를 보여 주고 고른 항목만 적용한다.
- `config.ts`: 경로 상수와 정책 값의 단일 출처다(`ALLOWED_ROOTS`, `CONFIG_FILES`, `STALE_DAYS`, `BACKUP_KEEP`, `APP_STATE_DIR=~/.harness-manager` 등).
- `providers/`: `ProviderAdapter`(claude, codex)와 `registry`. provider별 home·설정 파일·카탈로그·MCP·실행 감지를 맡는다.
  - 인터페이스는 `listConfigFiles`·`readMcpServers`·`listCatalog`·`detectRunning`만 갖는다(세션·프로젝트·계획 조회는 M1에서 제거).
- `services/`: `catalog`, `plugins`, `mcp`, `scan`, `projects`(stale 계산 `getProjects`·`guessOriginalPath`).
- v2가 사용자 PC에 남긴 앱 데이터(`~/.harness-manager/board.json`·`projects.json`, `~/.claude/harness-manager/*`)는 더 이상 읽지 않는다. 처리 방식은 설계 스펙 Q3을 따른다.

### Renderer (`src/renderer/src/`, React 18)
- 라우터와 상태관리 라이브러리를 쓰지 않는다. 화면 목록은 `pages/registry.tsx` 하나이고, `App.tsx`는 타이틀바·내비·본문을 그리는 셸만 맡는다.
- 프레임: `components/TitleBar.tsx`(메뉴는 `title-bar-menu.ts`의 데이터, 창 버튼·테마 토글), `components/toast.tsx`(`showToast`), `components/confirm-dialog.tsx`(`useConfirmDialog` — `window.confirm` 대신), `components/UpdateBadge.tsx`.
- 테마: `theme.ts`(`applyTheme`·`applyStoredTheme`·`useResolvedTheme`, 저장 키 `harness-manager.theme.v1`). 색은 `theme-colors.css`(mcw와 같은 값), 타입·모션 토큰은 `index.css` `:root`. v2 변수 이름(`--panel`·`--card`·`--accent` 등)은 새 토큰을 가리키는 별칭으로 남아 있다(M5에서 정리).
- 계약 테스트: `typography-contract.test.ts`(글자 크기 11/12/13/14/16px, 굵기 400/600/700만), `motion-contract.test.ts`(CSS와 `motion-tokens.ts` 일치, `transition: all` 금지, reduced-motion 블록마다 `:root[data-reduce-motion]` 짝).
- 보존 대상 페이지:
  - `Catalog`: 읽기 전용 카탈로그
  - `Cleanup`: 스캔 → 선택 → dry-run → 실행 → 복구
  - `ConfigEditor`: `vanilla-jsoneditor`, 409 충돌 처리
  - `UpdateBadge`
- `provider-ui.ts`: provider 필터 옵션, `providerLabel`·`providerBadgeClass`·`providerToneClass`.

### 공유 타입 (`src/shared/`)
`api-types.ts`(IPC 계약 + DTO)와 `provider-types.ts`. `types.ts`는 둘을 다시 내보내는 진입점일 뿐이다.

### 설정 파일 정책
- `settings.json`과 `settings.local.json`은 편집할 수 있다. `~/.claude.json`은 Claude Code가 상시 재작성하므로 **읽기 전용**이다. 쓰기 핸들러는 `writable:false`이면 403을 낸다. MCP 정의도 조회만 한다.
- 검증은 `lib/json-validate.ts`(TOML은 `toml-validate.ts`)의 수동 구조 검사다. 공개 schemastore 스키마는 쓰지 않는다. 목적은 CC 기동을 깨뜨리는 저장을 막는 것뿐이다.

### 코드 규약
- **ESM 상대 import는 `.js` 확장자를 유지한다**(`from "./config.js"`). `moduleResolution: Bundler`로 타입체크하고 esbuild가 resolve한다. 확장자를 임의로 떼지 않는다.
- **main에서 쓰는 패키지는 `dependencies`에 넣는다.** `externalizeDepsPlugin`이 이 패키지들을 external로 처리해 asar의 node_modules에서 require하기 때문이다. devDependencies에 두면 패키징에서 빠진다.
- 플랫폼 분기:
  - `cc-detect.ts`는 Windows에서 `tasklist`를, 그 외에서 `pgrep -x claude`를 쓴다.
  - `guessOriginalPath`는 flatten된 디렉토리명을 원래 경로로 역추정한다. 추정값일 뿐이다.
- MCP 시크릿(env/headers)은 renderer에서 마스킹한다. 로그나 터미널에 값을 노출하지 않는다.
- 코드 주석과 식별자는 한국어 도메인 용어를 쓰는 기존 스타일을 유지한다.
- **커밋은 사용자가 요청할 때만 한다.** 메시지는 영어 소문자 conventional 형식(`feat:`/`fix:`/`chore: release vX.Y.Z`)을 쓴다.

### 배포
- **배포 산출물**
  - Windows NSIS: `Harness-Manager-Setup-x.y.z.exe`
  - Linux AppImage: x64와 arm64
  - 파일명에 공백이 있으면 updater가 404를 만난다. 그래서 `artifactName`을 하이픈과 `${arch}`로 고정한다.
- 바꾸면 안 되는 값: appId `com.digitrack.claudeharnessmanager`(updater 연속성), publish 대상 github `rafaam11/harness-manager`.
- **릴리스 절차**
  - `v*` 태그를 푸시하면 CI(`.github/workflows/release.yml`)가 ubuntu, ubuntu-arm, windows 매트릭스로 빌드한다.
  - 산출물은 같은 태그의 **draft 릴리스**에 모인다. 사람이 검토한 뒤 수동으로 publish한다.
  - 버전 범프는 `chore: release vX.Y.Z` 커밋 하나로 한다. 릴리스 노트는 `docs/release/vX.Y.Z.md`에 둔다.
- Windows는 코드서명을 하지 않는다. 그래서 설치할 때 SmartScreen 경고가 뜬다.
