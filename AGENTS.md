# AGENTS.md

## v5 CLI 설정·확장

- `이 PC`의 공통 / Claude Code / Codex 탭을 사용한다. CLI별 설정 / 확장 / 스킬·연결로 책임을 나눈다. 기본은 공통이며 선택과 검색을 기억한다.
- `services/cli-settings/`는 공식 카탈로그·설정 검증·JSON/TOML 부분 편집·확장 옵션을 담당하는 순수 Node 모듈이다. 계약은 `docs/contracts/cli-settings.md`다.
- CLI별 명시적 set/remove와 확장 enabled true/false는 `home/cli-settings.v1.json`, PC 고유 경로는 `local/cli-settings.local.json`에 둔다. 배열은 정확히 교체하며 기존 배열 union과 구분한다. 관리 해제는 PC 값을 유지하고 기준에서 뺀다.
- 새 정의가 있으면 이동 파일 version 3이다. 기존 v1/v2를 자동 변경하지 않으며 모든 동기화 PC는 v5 이상이어야 한다. 조직 정책·인증·프로젝트·Codex profiles와 MCW 전용 파일은 수정하지 않는다. 설치·활성·hook 신뢰·세션 실행은 구별한다.
- 설정 변경은 기존 workbench 검토·저널을 통해 기준과 PC 파일을 함께 저장·복원한다. 외부 명령은 main이 만들며 실패·검증 실패 시 기준을 저장하지 않는다. 카탈로그 갱신은 `python scripts/update-settings-catalog.py`와 출처 문서를 함께 점검한다.

## v4 작업대 (현재 구현)

- 기본 탐색은 이 PC / 동기화 / 변경 기록 / 앱 설정이다. 프로필 선택·원본 파일 편집은 앱 설정 → 고급에서만 연다. 아래 v3의 첫 화면·읽기 전용 카탈로그 결정은 이 구조로 대체한다.
- 공통 스킬·지침은 `home/components.v2.json`에 저장한다. 앱의 `changes:prepare`는 기준 저장과 PC 적용을 한 번 검토하고 같은 저널에 기록한다. 첫 편집은 개인 사본도 같은 트랜잭션에서 준비하고 성공할 때 선택한다. 기존 프로필 ID와 doctor/install/capture·workbench CLI 계약은 유지한다. v2 이동 파일은 bundle version 2이며 version 1도 계속 읽는다.
- 목록은 36px 행과 가용 높이 기반 페이지로 보여 준다. 기본 화면의 바깥 스크롤은 막고 상세의 설정/진단/기록 탭, 본문과 diff만 내부 스크롤한다. 1100px 미만에서는 상세를 겹쳐 연다. 원격 수신은 `ProfileSync.prepareReceive`가 병합·원격 검증을 맡고 작업대가 기준 파일과 PC 파일을 함께 검토·적용한다. 외부 명령이 실패하면 기준 저장을 보류하고 결과를 기록한다.
- `services/workbench/`는 구성요소·GitHub 커밋 고정·변경 저널·복원·MCP 초기화 검사·hook/프로젝트 정적 진단을 담당한다. 모든 프로필/CLI 설정 쓰기는 기존 안전 경로를 유지한다. 프로젝트는 읽기 전용이다.
- 일반 문서 자동 적용은 전환한 개인 프로필 전체에 적용한다. 앱 실행 중 30초마다 로컬 정의 변경을 감지하고 30분마다 원격·업데이트를 확인한다. 실행 코드·권한·hook·MCP·패키지·충돌·알 수 없는 CLI 실행 상태는 보류한다. 수동 작업은 자동 확인을 취소·정리한 뒤 우선 실행한다.
- GitHub 프로필은 일반 문서 변경만 조건부 자동 수신한다. 새로운 출처·항목 추가/제거·개인 설정·충돌은 수동 수신이다. 원격 업로드는 항상 수동이다. 복원 후 다음 수동 적용 전까지 자동 쓰기를 보류한다.
- `hm components`, `hm updates`, `hm history`, `hm restore`가 앱과 같은 엔진을 사용한다. `--yes`가 없으면 변경 미리보기다.
- v4 E2E: `npm run test:e2e`. 임시 홈에서 실제 Electron·IPC·파일 저장을 검증한다. OS 프로세스 조회와 GitHub 설정을 격리하므로 테스트를 실행하는 Codex가 자동 적용을 막지 않고 실제 계정·모델을 호출하지 않는다.

이 저장소에서 작업하는 코딩 에이전트(Claude Code, Codex CLI 등)를 위한 지침이다. `CLAUDE.md`는 이 파일을 `@AGENTS.md`로 불러오는 래퍼일 뿐이다. 내용은 여기에만 쓴다.

> **v3.2.0까지 릴리스했다.** 남은 마일스톤은 M9(보류)뿐이다. 아래 "v3 전환"은 그 기준과 지금까지의 결정을 담는다. "현재 코드"는 지금 트리에 있는 코드를 설명한다.
> 설계 스펙은 `docs/superpowers/specs/v3-design.md`에 있다.

---

## "설치해줘" — 이 PC 개발환경 셋업

사용자가 이 레포에서 "설치해줘", "셋업해줘", "개발환경 맞춰줘"라고 하면 `plugins/jinmin-skills/skills/jinmin-setup/SKILL.md`를 읽고 그 절차를 그대로 따른다. 클론 직후에는 플러그인이 아직 설치되지 않았으므로 스킬로 뜨지 않는다. 그래서 이 파일이 길잡이다.
- 요약: `hm`을 찾거나 만든다(`npm ci && npm run build` → `node out/main/cli.js`) → `doctor --json` → 프로필·마켓플레이스 소스를 묻는다(`settings`) → `install --json`으로 할 일을 보여 주고 고르게 한다 → 확인받고 `install --run --only … --yes` → 로그인 안내 → `doctor` 다시 실행
- 설정 파일을 직접 고치거나 manifest에 없는 명령을 실행하지 않는다. 모든 변경은 hm을 거친다.
- 새 PC에 레포도 없으면 `scripts/bootstrap.ps1`(PowerShell)이 git·gh·node를 깔고 클론·빌드한 뒤 doctor와 install 미리보기까지 보여 준다.

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
- v2 기능 중 **정리/아카이브**만 남긴다(설정 편집기는 v3.3.0에서 뺐다. 설정은 install·capture가 관리 키 단위로 다룬다). 카탈로그의 스킬·플러그인·MCP 조회 로직은 섹션 화면의 기반으로 재사용한다.
- 첫 화면은 **상태판 + 섹션 탭**이다. 위저드는 상단 버튼으로 연다.
- 레포는 **public을 유지**하고 민감한 내용만 걸러낸다. electron-updater 익명 업데이트 때문이다.
- Claude 마켓플레이스 이름은 **`jinmin`**을 유지한다. 플러그인 ID가 바뀌지 않게 하기 위해서다.
- 사용자 프로필을 먼저 고르고 그 안의 설치 범위를 **core / dev / full**로 고른다. 공용 앱 기본값에는 개인 모델·권한·플러그인·dotfiles를 넣지 않는다.
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
- Codex도 같은 마켓플레이스를 읽는다(`codex plugin marketplace add <레포>`). Claude 전용 `hooks.json`의 `modules`는 Codex에서 실행되지 않는다. Codex 대응은 별도 `.codex-plugin/plugin.json`과 lifecycle hook으로 만든다. `mods/jinmin-codex`는 선택 설치이며 hook 신뢰가 필요하다. 기본 공통 프로필에는 자동 추가하지 않는다(스펙 D20).
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
| M6 | install step 엔진, merge(JSON/TOML/마커), LogTerminal | 완료(PS 프로필·gitconfig 포함. Windows Terminal은 보류 — 스펙 D25) |
| M7 | Wizard 페이지, `hm-cli`, `jinmin-setup` 스킬, `scripts/bootstrap.ps1` | 완료 |
| M8 | Cleanup 확장(깨진 symlink, loose 스킬 중복, Codex 대상) | 완료 |
| M9 | 회사 스킬을 private 레포로 이관(별도 레포 작업) | 보류(회사 레포 규칙에 맞춰 별도 세션에서) |
| M10 | v3.0.0 릴리스 | 완료(2026-10-27 발행. 설치한 2.0.6이 3.0.0으로 자동 업데이트되고 hm 심을 쓰는 것까지 실측) |
| M11 | jinmin-mods 폐기 | 완료(2026-10-27: jinmin을 이 레포로 옮기고 mod 재설치 → GitHub archive → 로컬 폴더 삭제) |
| M12 | jk-external-api 흡수("외부 API" 섹션)와 원 레포 폐기 | 완료(v3.1.0 발행 뒤 README 이전 안내 → Pages 끄기 → automation 브랜치 14개 삭제 → archive. Actions 시크릿은 설정된 것이 없었고, Worker는 배포 기록이 없어 지울 것이 없는 것으로 판단. 로컬 폴더는 사용자가 지운다) |
| M13 | UI 정리: 공통 컴포넌트(`components/ui.tsx`), v2 색 별칭·죽은 CSS 제거, 아이콘+글자 사이드바, provider 필터는 쓰는 화면 안으로·업데이트 배지는 타이틀바로, `style-contract.test.ts` | 완료(v3.2.0) |

### v3 불변 원칙
- **사용자 설정 불가침.** CLI가 직접 쓰는 파일(`settings.json`, `~/.claude.json`, `config.toml`)은 통째로 덮어쓰지 않는다.
  - JSON은 레포가 정의한 **관리 키만** deep-merge한다.
  - TOML은 관리 테이블만 바꾼다. 주석이 보존되지 않으면 마커 블록 방식으로 전환한다.
  - 텍스트 파일(PS 프로필 등)은 `# >>> harness-manager >>>` … `# <<< harness-manager <<<` 마커 블록만 관리한다. 마크다운(AGENTS.md)은 `#`이 제목이라 `<!-- >>> harness-manager >>> -->` … `<!-- <<< harness-manager <<< -->`를 쓴다.
  - 쓰기는 반드시 `writeFileChecked`(`services/capture/capture.ts`, install도 같은 함수) 경로를 탄다.
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
- 화면 머리·탭·툴바·패널·상태 태그·상태 점·배너·빈 상태·체크박스는 `components/ui.tsx`의 공통 컴포넌트를 쓴다. 페이지 전용 스타일만 페이지 접두어(`ext-`, `wizard-` 등)를 붙인다.
- 색은 `theme-colors.css` 토큰으로만 쓴다(상태 배경 `--ok/warn/err-surface`, 분류색 `--kind-*`). `style-contract.test.ts`가 `index.css`의 색 리터럴, v2 별칭(`--border`·`--accent` 등), 코드에서 쓰지 않는 클래스를 막는다.
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
- **테스트**: vitest를 쓴다(`vitest.config.ts`). 기본은 node 환경과 forks pool이며 renderer 테스트 일부는 파일 주석으로 jsdom 환경을 쓴다. CI 릴리스 워크플로는 Windows·Linux에서 단위·계약 테스트, 빌드, 실제 Electron E2E가 통과한 뒤 패키징한다.
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
3. **낙관적 동시성과 백업**(`writeFileChecked`, `lib/safe-write.ts`의 `ConflictError`·`sha256`)
   - 쓰기는 다음 순서로 진행한다: 계획 때 읽은 원본과 지금 파일 대조 → `~/.harness-manager/backups`(`BACKUP_DIR`)에 원본 백업 → temp 파일 작성 → atomic rename.
   - 원본이 바뀌었으면 `ConflictError`(409)를 던진다.
   - v2의 `~/.claude/backups/harness-manager`는 더 이상 쓰지 않는다.
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
- **외부 API(M12)**: jk-external-api를 앱 화면으로 흡수했다.
  - `src/shared/external-api/`: zod 스키마, 손으로 관리하는 정보원·청사진·기술 데이터, 번들 k-skill 스냅샷(`generated/skills.json`). `buildCatalog(skills)`가 카탈로그를 만든다.
  - `services/external-api/`
    - `sync.ts`: k-skill을 GitHub 익명 API로 받는다. frontmatter는 gray-matter로 읽는다.
    - `store.ts`: `~/.harness-manager/external-api/skills.json`. 번들보다 우선하고, 깨졌으면 번들로 되돌린다.
    - `health.ts`: 공식 링크를 HEAD로 점검한다.
    - 네트워크는 main에서만 쓴다.
  - 채널: `external-api:catalog`·`refresh`·`check-links`
  - 화면 `pages/ExternalApi/`
    - 탭: 정보원(검색·필터·목록/관계도·비교함), k-skill, 청사진, 기술
    - 상세: 대화상자 하나로 보여 준다. 연결 항목은 같은 대화상자에서 열고 "뒤로"로 돌아간다.
    - 외부 링크: OS 브라우저로 연다.
  - 원 레포의 공개 사이트·미리보기 Worker·주간 자동 PR은 가져오지 않았다(Q13 기본값). 원 README와 설계 문서는 `docs/external-api/`에 보관하고, k-skill 귀속은 `THIRD_PARTY_NOTICES.md`에 적었다.
- **dotfiles(M6 후속)**: `services/dotfiles.ts`
  - PowerShell 5.1 프로필(문서 폴더는 OS에 물어 정한다)
    - 템플릿: `home/powershell/profile.ps1`
    - 마커 블록(`# >>> harness-manager >>>`) 안만 관리한다. 블록이 없으면 capture는 파일 전체를 공개 후보로 본다.
    - install은 BOM을 붙여 쓴다(5.1이 BOM 없는 한글을 깨뜨린다).
  - git 전역 설정: `home/git/gitconfig.json`(평평한 키), 개인 값(이메일)은 `profile/gitconfig.local.json`
    - 읽기·쓰기 모두 `git config`로만 한다.
    - 관리 키는 `managed-keys.json`의 `gitconfig`다.
  - capture 대상 `powershell-profile`·`gitconfig`, doctor 카드 dotfiles, install step `dotfiles.powershell-profile`·`dotfiles.git`.
  - 테스트는 `gitScope.file`(`git config --file`)과 임시 문서 폴더를 써서 실제 `~/.gitconfig`를 건드리지 않는다.
- **정리 확장(M8)**: `services/cleanup-targets.ts`가 v3 후보를 찾는다. doctor도 같은 함수를 쓴다(상태판의 노랑 = 정리 화면의 후보).
  - `broken-links`: `~/.claude/skills`·`~/.agents/skills`·`~/.codex/skills`에서 대상이 없는 링크
  - `duplicate-skills`: 이 레포 플러그인으로 옮긴 스킬의 loose 사본. **그 provider에서 플러그인이 켜져 있을 때만** 후보다(아니면 유일한 사본이다).
  - `leftovers`: claude-hud 캐시·폴더, v2 앱 데이터(`~/.harness-manager/board.json`·`projects.json`, `~/.claude/harness-manager`, `~/.claude/backups/harness-manager`)
  - `codex-logs`: `~/.codex`의 `sandbox*.log`와 `log/` 중 30일 넘은 것. 세션 기록·DB는 건드리지 않는다.
  - 아카이브는 기존과 같은 `~/.claude/archive/<날짜>/<분류>/`이다. 링크는 링크 자체만 옮긴다(복사로 넘어가지 않는다). `~/.agents/skills`를 allowlist에 더했다.
- **셋업 위저드(M7)**
  - `pages/Wizard.tsx`는 8단계다: 환영(레포 위치) → 진단(카드) → 프로필·마켓플레이스 소스 → 항목 고르기 → 미리보기(dry-run 선택) → 실행(LogTerminal) → 로그인 안내 → 최종 카드.
  - 내비게이션에 없고 타이틀바의 "셋업 위저드" 버튼으로 연다(`PageContext.navigate`).
  - 앱 설정 `~/.harness-manager/settings.json`(`profile`, `selfMarketplaceSource`)은 `services/settings.ts`가 읽고 쓴다(모르는 키 보존). 채널은 `settings:get`·`settings:set`, CLI는 `hm settings`.
  - AI 위저드: `plugins/jinmin-skills/skills/jinmin-setup/SKILL.md`. 위의 "설치해줘" 절차와 같다.
  - `scripts/bootstrap.ps1`: 새 PC의 첫 진입점. PowerShell 5.1이 읽도록 **UTF-8 BOM으로 저장한다**(BOM이 없으면 한글이 깨진다).
    - 순서: winget으로 git·gh 설치 → 클론 또는 ff-only pull → 기존 Node 보호 검사(없는 환경만 NVM/Node 22) → `npm ci`(Electron 바이너리는 받지 않음) + 빌드 → settings → doctor → install 미리보기
    - 옵션: `-Run`은 전부 실행, `-InstallApp`은 최신 릴리스 설치 파일 실행, `-DryRun`은 출력만 한다.
- **install(M6)**: `services/install/`
  - Node 보호 정책: 기존 정상 Node ≥22.12와 npm은 설치 방식·활성 버전을 유지한다. `packages.winget.nvm`은 이제 NVM 유무가 아닌 Node 실행 환경을 검사한다. MSI/NVM 혼재, 중복 실체, 깨진 설치는 자동 이관·제거하지 않는다.
  - Windows Node 검사·설치는 `scripts/node-runtime.ps1`을 앱과 bootstrap이 함께 사용한다(UTF-8 BOM). 신규 환경만 NVM → `nvm install 22` → 설치된 정확한 버전 `nvm use` → node/npm 검증 순서로 진행한다. 실패하면 npm·npx·Codex 후속 명령을 막는다. 정상 활성 버전을 다른 버전으로 강제 전환하지 않는다.
  - 설치 후 PATH와 NVM 환경변수를 함께 다시 읽고, 기존 터미널·호스트 앱 재시작을 안내한다. 실행 로그는 `~/.harness-manager/logs/install/*.jsonl`에 시각·결과와 함께 기록하며 비밀값을 가린다(실행별 2 MiB 상한).
  - 앱은 Node 보호 스크립트를 빌드 산출물에 포함하고 asar 밖에 unpack한다. 오래된 레포를 연결한 PC도 앱에 포함된 검사부터 사용한다.
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
  - self 마켓플레이스 소스는 `~/.harness-manager/settings.json`의 `selfMarketplaceSource`(github 기본 / directory는 개발자 선택)이고, CLI는 `--self-source`로 바꾼다.
- **AI 설치 복구**: `services/repair/`, 공통 화면 `components/RepairPanel.tsx`.
  - 위저드 실행 결과·설치 페이지의 실패 항목에서 설치된 Codex/Claude Code에 해결을 요청한다. 렌더러는 step id와 provider만 전달하고 main이 계획·최근 오류·로그를 구성한다.
  - 사용자 요청에 따라 Codex `exec --json --dangerously-bypass-approvals-and-sandbox`, Claude Code `--dangerously-skip-permissions`(stream-json)를 쓴다. 실행 전 앱 대화상자에 자동 실행·문맥 전달·소스 커밋/푸시 범위를 표시한다. 기존 로그인·모델 설정은 유지한다.
  - AI 종료 후 doctor/plan을 확인하고 해당 항목만 자동 재실행한다. 최대 3회, 회당 15분, Claude는 20턴 상한이다. 시스템 패키지 제거·MSI/NVM 이관은 프롬프트에서 수동 조치로 제한한다. YOLO는 OS 격리 장치가 아니다.
  - `RepairCoordinator`가 최대 3개를 병렬 실행한다. 같은 provider 설정과 공용 플러그인/MCP·런타임 자원은 순서를 지킨다. `InstallSession`은 일반 설치와 복구를 서로 배제하며 앱 종료 시 대기·실행 중 작업을 모두 취소하고 프로세스 트리 종료를 기다린다.
  - 작업별 상태·로그·취소를 제공한다. 복구 로그는 `~/.harness-manager/repair/logs/`에 비밀값을 가려 보관한다.
  - 요청별 기여 동의가 있는 경우에만 공통 버그를 `repair/workspaces/`의 별도 dev 클론에서 수정한다. 일반 사용자는 fork·작업 브랜치·PR을 사용하며, 명시적인 관리자 모드와 쓰기 권한을 확인한 경우에만 dev 직접 push를 허용한다. 호스트가 공개할 파일 범위·홈 경로·비공개 낱말·비밀값을 검사하고 npm test → typecheck → build 후 커밋한다. fetch/merge/재검증/push는 직렬화한다. 충돌·권한 부족·실패는 사본을 남기고 보고한다. force/reset/stash/자동 태그·배포는 하지 않는다. 개인 프로필은 HM 공개 소스 반영 대상이 아니다.
- **사용자 프로필**: `services/setup-profiles.ts`, `profile-document.ts`, `profile-sync.ts`, 프로필 화면, `hm profiles`.
  - 일반 사용은 Git·HM 소스 레포 없이 동작한다. 번들 공통 기본은 읽기 전용이며 개인 사본을 만들어 편집한다. 설치 정의는 `profiles/<id>/definition/`, 개인 오버레이와 비공개 낱말·이동 선택은 `<id>/local/`이다.
  - `repoRoot`는 선택적인 개발 소스 경로(null 허용), `templateRoot`는 선택한 프로필이다. Node 보호 스크립트는 앱 번들을 사용하며 self 마켓플레이스는 일반 사용자에게 GitHub 소스를 사용한다.
  - 프로필 편집은 구조화된 입력 → main 검증·미리보기 토큰 → 지문 재확인·백업 후 저장이다. 저장·동기화와 실제 설치는 별도이다. 프로필 보관·복원은 파일을 지우지 않는다. 외부 폴더는 연결만 해제한다.
  - 파일 이동은 버전 1 `.hmprofile.json`이다. 정의와 선택한 개인 설정만 포함하고 인증 정보·PC 절대경로는 제외한다. 지원하지 않는 형식·파일·링크는 거부한다.
  - GitHub 동기화는 프로필별 선택 기능이며 git/gh와 비공개 저장소를 쓴다. 전용 클론에서 작업하며 원격 변경·로컬 지문·공개 전환을 재확인한다. 충돌은 파일별 선택한다. force push·reset·원격 자동 적용은 하지 않는다.
  - 기존 `legacy` 선택은 원본을 보존하여 개인 사본으로 이전한다. 기존 local/linked ID와 선택은 유지한다. 비공개 낱말 파일이 없으면 빈 목록을 자동 생성하며 가져오기 화면에서 편집한다.
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
    - 비공개 낱말 목록은 `profile/private-terms.json`(`{"terms":[…]}`)이다. 파일이 없으면 빈 목록을 초기화하며 UI에서 수정한다. 인증 정보 검사는 목록과 독립적으로 유지한다.
    - 공개 파일에 홈 경로·절대경로·이메일·비공개 낱말이 남으면 노출 경고로 적용을 막는다.
    - plugins·mcp·skills는 더하기만 한다(빼기는 사람이 manifest를 직접 고친다). MCP env 값은 옮기지 않고 `${이름}` 자리표시로 적는다.
    - 적용: 렌더러는 대상 id와 미리보기 지문만 보내고, main이 다시 계획해 지문이 같을 때만 계획한 파일을 쓴다(파일 단위 allowlist, 원본 백업, temp → rename). 다르면 409다.
  - 레포 위치: `HM_REPO` → `~/.harness-manager/repo.json` → 개발 빌드는 앱 경로 → 자동 탐색(`jinmin` 마켓플레이스의 directory 소스, `~/dev` 등 흔한 폴더의 `harness-manager`, 찾으면 repo.json에 기억). CLI는 `--repo`도 받는다.
  - 일반 화면에는 레포 연결을 요구하지 않는다. 프로필 화면의 개발자 설정에서만 연결 카드(`components/RepoConnect.tsx`)를 제공한다. "레포 받기"(`repo:clone`)는 공개 레포를 `~/dev/harness-manager`에 클론한다. 주소와 위치는 main이 정하고, 다른 파일이 든 폴더에는 받지 않는다(409).
  - CLI: `hm capture [--dry-run]`, `hm capture --apply --only <id,…> --yes`, `hm manifest validate`(실패 시 종료 코드 3).
  - 화면: "가져오기" 페이지(`pages/Capture.tsx`)가 항목별 diff·노트·노출 경고를 보여 주고 고른 항목만 적용한다.
- `config.ts`: 경로 상수와 정책 값의 단일 출처다(`ALLOWED_ROOTS`, `STALE_DAYS`, `BACKUP_DIR`, `APP_STATE_DIR=~/.harness-manager` 등).
- `providers/`: `ProviderAdapter`(claude, codex)와 `registry`. provider별 home·설정 파일·카탈로그·MCP·실행 감지를 맡는다.
  - 인터페이스는 `readMcpServers`·`listCatalog`·`detectRunning`만 갖는다(세션·프로젝트·계획 조회는 M1에서, 설정 파일 목록은 v3.3.0에서 제거).
- `services/`: `catalog`, `plugins`, `mcp`, `scan`, `projects`(stale 계산 `getProjects`·`guessOriginalPath`).
- v2가 사용자 PC에 남긴 앱 데이터(`~/.harness-manager/board.json`·`projects.json`, `~/.claude/harness-manager/*`)는 더 이상 읽지 않는다. 지우지 않고 정리 화면의 `leftovers` 후보로 보인다(스펙 D24).

### Renderer (`src/renderer/src/`, React 18)
- 라우터와 상태관리 라이브러리를 쓰지 않는다. 화면 목록은 `pages/registry.tsx` 하나이고, `App.tsx`는 타이틀바·내비·본문을 그리는 셸만 맡는다.
- 프레임: `components/TitleBar.tsx`(메뉴는 `title-bar-menu.ts`의 데이터, 창 버튼·테마 토글), `components/toast.tsx`(`showToast`), `components/confirm-dialog.tsx`(`useConfirmDialog` — `window.confirm` 대신), `components/UpdateBadge.tsx`(타이틀바 안에 그린다), `components/ui.tsx`(공통 컴포넌트).
- 사이드바는 `nav.rail` 아이콘+짧은 글자 열이다. 페이지 정의(`registry.tsx`)가 `icon`(lucide)·`short`를 갖는다. 전역 provider 필터는 없고, 카탈로그가 `Tabs`로 provider를 고르며 선택을 localStorage에 기억한다(`useStoredProviderFilter`).
- 테마: `theme.ts`(`applyTheme`·`applyStoredTheme`·`useResolvedTheme`, 저장 키 `harness-manager.theme.v1`). 색은 `theme-colors.css`(구조는 mcw와 같고, 주색은 주황 `--primary`·바탕은 따뜻한 회색. v3.4.0), 타입·모션 토큰은 `index.css` `:root`.
- 계약 테스트: `typography-contract.test.ts`(글자 크기 11/12/13/14/16px, 굵기 400/600/700만), `motion-contract.test.ts`(CSS와 `motion-tokens.ts` 일치, `transition: all` 금지, reduced-motion 블록마다 `:root[data-reduce-motion]` 짝), `style-contract.test.ts`(색 리터럴·v2 별칭·죽은 클래스 금지).
- 보존 대상 페이지:
  - `Catalog`: 읽기 전용 카탈로그
  - `Cleanup`: 스캔 → 선택 → dry-run → 실행 → 복구
  - `UpdateBadge`
- `provider-ui.ts`: provider 탭 옵션(`useStoredProviderFilter`), `providerLabel`·`providerBadgeClass`·`providerToneClass`.

### 공유 타입 (`src/shared/`)
`api-types.ts`(IPC 계약 + DTO)와 `provider-types.ts`. `types.ts`는 둘을 다시 내보내는 진입점일 뿐이다.

### 설정 파일 정책
- 프로필 화면은 설치 정의와 관리 템플릿을 편집한다. 살아 있는 CLI 설정 파일을 직접 편집하는 화면은 없다. `settings.json`·`config.toml`은 install이 관리 키만 merge하고, capture가 레포 템플릿으로 끌어온다.
- `~/.claude.json`은 Claude Code가 상시 재작성하므로 **읽기 전용**이다. MCP 정의도 조회만 한다.

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
