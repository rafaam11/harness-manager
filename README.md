<p align="center">
  <img src="docs/banner.svg" alt="하네스 매니저" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-43-2b2a28?logo=electron&logoColor=9feaf9" alt="Electron 43">
  <img src="https://img.shields.io/badge/React-18-221f1e?logo=react&logoColor=61dafb" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-221f1e?logo=typescript&logoColor=3178c6" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Ubuntu-221f1e" alt="Windows and Ubuntu">
  <img src="https://img.shields.io/github/v/release/rafaam11/harness-manager?label=version&color=e8825f" alt="latest release">
  <img src="https://img.shields.io/badge/local--only-no%20telemetry-3fb950" alt="local only">
</p>

**하네스 매니저**는 새 PC에서도 **같은 Claude Code · Codex 개발환경**을 만드는 **로컬 전용 Windows · Ubuntu 데스크톱 앱**(Electron)이다. 이 레포를 클론하고 앱을 켜면 툴체인, Claude Code · Codex와 그 설정, 플러그인 · 스킬, MCP, cua-driver, 셸 · git dotfiles가 레포의 manifest대로 맞춰진다.

- 첫 화면 **상태판**이 카드 8장으로 무엇이 되어 있고 무엇이 빠졌는지 보여 준다. 상태는 초록 · 노랑 · 빨강 점과 글자 라벨로 함께 표시한다.
- **설치**는 manifest 기반 step 엔진이다. plan → dry-run → run → verify 순서로 돌고, 이미 정상인 것은 건너뛰므로 몇 번을 돌려도 같다.
- **가져오기**는 반대 방향이다. 이 PC에서 바꾼 설정을 diff로 보고 레포 템플릿으로 끌어온다. 개인 값은 로컬 프로필로 나눈다.
- **셋업 위저드**는 두 겹이다. 앱의 8단계 위저드, 그리고 Claude에게 **"설치해줘"** 라고 하면 따르는 `jinmin-setup` 스킬. 둘 다 같은 `hm` CLI를 부른다.
- 사용자 설정은 통째로 덮어쓰지 않는다. JSON은 관리 키만, TOML은 관리 줄만, 텍스트 파일은 마커 블록만 고치고, 쓰기 전에 백업한다. 정리는 지우지 않고 아카이브로 옮긴다.

모든 동작은 이 PC 안에서 일어난다. 네트워크 포트를 열지 않고(렌더러 ↔ main은 Electron IPC), 텔레메트리도 없다. 외부 통신은 앱 업데이트 확인 · 다운로드(GitHub 릴리스), 레포 연결 카드의 클론, 외부 API 화면에서 누른 동기화 · 링크 점검, 그리고 설치 step이 manifest대로 부르는 `winget` · `npm` · `claude` · `codex` 명령에서만 생긴다. 로그인 · 토큰은 다루지 않는다.

## 미리보기

<!-- 60초 소개 영상: HarnessManager_홍보_60s_github.mp4를 GitHub 웹에 올려 받은 user-attachments 주소를 이 자리에 한 줄로 둔다. -->

<p align="center"><img src="docs/mockup-dashboard.svg" alt="상태판 — 카드 8장, 섹션 탭, 펼친 플러그인 섹션" width="100%"></p>

<p align="center"><em>상태판. 노랑 하나, 빨강 둘 — 카드를 누르거나 섹션 탭을 고르면 상태 · 이름 · 상세 표가 펼쳐진다.</em></p>

<p align="center"><img src="docs/mockup-install.svg" alt="설치 — 할 일 목록, 파일 diff와 명령, 로그" width="100%"></p>

<p align="center"><em>설치. 고친 파일의 diff와 실행할 명령을 먼저 보여 주고, 고른 step만 실행한다. 실행 뒤에는 같은 검사로 다시 확인한다.</em></p>

## 빠른 시작

**설치본으로**

1. [최신 릴리스](https://github.com/rafaam11/harness-manager/releases/latest)에서 받는다.
   - Windows: `Harness-Manager-Setup-x.y.z.exe`. 서명하지 않은 빌드라 SmartScreen에서 **추가 정보 → 실행**으로 진행한다.
   - Ubuntu: x64는 `…-x64.AppImage`, aarch64는 `…-arm64.AppImage`. `chmod +x` 뒤 실행한다.
2. 처음 켜면 이 레포의 클론을 찾는다. 없으면 상태판의 **레포 받기** 한 번으로 `~/dev/harness-manager`에 클론한다.
3. 타이틀바의 **셋업 위저드**를 따라가거나, 상태판에서 빨강 · 노랑을 보고 **설치** 화면에서 고른다.

**새 PC에서 처음부터**(Windows PowerShell)

```powershell
# git · gh · node 설치 → 클론 → 빌드 → doctor → install 미리보기
.\scripts\bootstrap.ps1          # -Run: 전부 실행 · -InstallApp: 최신 설치본 실행 · -DryRun: 출력만
```

**AI에게** — 이 레포를 연 Claude Code에서 **"설치해줘"** 라고 하면 `jinmin-setup` 절차대로 `hm doctor` → 프로필 묻기 → `hm install` 미리보기 → 확인받고 실행 → 로그인 안내 순서로 진행한다. 설정 파일을 직접 고치지 않고 모든 변경은 `hm`을 거친다.

**Node.js 설치는 필요 없다**(Electron에 런타임이 내장됨). 단, 설치 step이 Node · npm을 쓰는 항목(외부 스킬 등)은 툴체인에서 nvm으로 Node를 먼저 깐다.

**업데이트는 자동이다.** 시작할 때 GitHub 릴리스를 조회해 새 버전이 있으면 배경에서 차등 다운로드(blockmap)하고, 끝나면 타이틀바 배지가 **재시작**으로 바뀐다. 누르면 무음 설치하고 다시 뜬다. 자동 확인이 실패하면 같은 자리에 **릴리스** 링크가 뜬다.

## 화면

### 상태판

manifest · 레포 템플릿 · 로컬 오버레이를 이 PC와 비교해 카드 8장을 만든다.

| 카드 | 보는 것 |
|---|---|
| 툴체인 | 프로필에 든 패키지가 PATH에 있는지(git · gh · nvm · ripgrep · uv · python · rustup · scoop …) |
| Claude Code | 전역 `CLAUDE.md`, `settings.json` 관리 키 |
| Codex | 전역 `AGENTS.md` 공개 섹션, `config.toml` 관리 키 |
| 플러그인 | 마켓플레이스 소스, provider별 활성, mod 의존성, claude-hud 잔여 폴더 |
| 스킬 | 외부 스킬, 깨진 링크, 플러그인으로 옮긴 스킬의 낡은 사본 |
| MCP | provider별 등록과 명령 |
| cua-driver | 설치 위치 |
| dotfiles | PowerShell 프로필 마커 블록, git 전역 설정 |

검사 상태는 **정상**(초록) · **다름**(노랑) · **없음 · 오류**(빨강) · **정보**(회색) · **건너뜀**(프로필 밖) 다섯이다. 카드 색은 빨강 > 노랑 > 초록 > 회색 순으로 가장 급한 것을 따른다. 프로필(core · dev · full)은 위저드나 `hm settings`로 고른다.

### 설치

step은 doctor 검사에서 만든다. id 체계가 같아서 실행 뒤 같은 검사로 다시 확인한다. 실행 순서는 패키지 → 도구 → 전역 CLAUDE.md · AGENTS.md → Claude 설정 · 마켓플레이스 · 플러그인 → Codex → MCP → 외부 스킬이다.

- 각 step은 실행할 명령이나 고칠 파일의 diff를 미리 보여 준다. 렌더러는 step id만 보내고, 명령과 인자는 main이 manifest에서 만든다. 셸을 쓰지 않는다.
- 파일 merge — JSON은 관리 키만 deep-merge(문자열 배열은 합침), TOML은 관리 키 줄만 바꾸고 주석 · 순서를 보존, 마크다운 · PS 프로필은 `>>> harness-manager >>>` 마커 블록만.
- 같은 이름 마켓플레이스의 소스가 다르면 remove → add 하고, 빠진 플러그인을 같은 step에서 다시 설치한다.
- MCP env 자리표시는 실행 환경에서 채우고, 값은 미리보기와 로그에서 가린다.
- 한 step이 실패해도 다음 step은 계속한다. 진행은 로그 터미널과 작업표시줄 막대로 보이고, 설치 중 종료는 먼저 묻는다.

### 가져오기

이 PC → 레포 템플릿. 대상은 전역 AGENTS.md · CLAUDE.md, Claude · Codex 관리 키, 마켓플레이스 · 플러그인, MCP, 외부 스킬, PowerShell 프로필, git 전역 설정이다.

- 항목마다 diff를 보고 고른 것만 쓴다. 렌더러는 대상 id와 미리보기 지문만 보내고, main이 다시 계획해 지문이 같을 때만 쓴다.
- 개인 값(이메일 등)은 `~/.harness-manager/profile/`로 보낸다. 공개 파일에 홈 경로 · 절대경로 · 이메일 · 비공개 낱말이 남으면 **노출 경고**로 적용을 막는다. 비공개 낱말 목록(`profile/private-terms.json`)이 없으면 미리보기만 된다.
- 플러그인 · MCP · 스킬은 더하기만 한다. 빼는 것은 사람이 manifest를 직접 고친다. MCP env 값은 옮기지 않고 `${이름}` 자리표시로 적는다.

### 셋업 위저드

타이틀바의 **셋업 위저드**로 연다. 환영(레포 위치) → 진단 → 프로필 · 마켓플레이스 소스 → 항목 고르기 → 미리보기(dry-run) → 실행 → 로그인 안내 → 최종 카드의 8단계다. 비밀값(토큰 · OAuth · `auth.json`)은 다루지 않고, 로그인은 마지막에 안내만 한다.

### 카탈로그 · 정리 · 외부 API

- **카탈로그** — 스킬 · 에이전트 · 명령 · 지침 · 메모리 · MCP · 플러그인을 provider별로. 항목을 누르면 프론트매터와 본문을 펼친다. MCP의 env · headers는 가린다.
- **정리** — 깨진 스킬 링크, 플러그인으로 옮겨진 스킬의 중복 사본(그 플러그인이 켜져 있을 때만), claude-hud · v2 흔적, 30일 넘은 Codex 로그를 찾는다. dry-run으로 먼저 보고, 실행하면 지우지 않고 `~/.claude/archive/<날짜>/`로 옮긴다. 아카이브 기록에서 원위치로 복구한다.
- **외부 API** — 공공 · 민간 API 정보원, k-skill, 청사진, 기술 카탈로그. 목록 · 관계도 · 비교함으로 보고, 공식 링크를 점검한다.

## `hm` CLI

앱과 같은 엔진을 쓰는 headless CLI다. 설치본은 기동할 때 `~/.harness-manager/bin/hm.cmd`를 만든다. 개발 중에는 `npm run build` 뒤 `node out/main/cli.js`로 부른다.

| 명령 | 하는 일 |
|---|---|
| `hm doctor [--profile p] [--all] [--json]` | 카드 8장 검사 |
| `hm install [--json]` | 할 일 미리보기(명령 · 파일 diff) |
| `hm install --run --only <id,…\|all> --yes` | 고른 step 실행. 실패 step이 있으면 종료 코드 5 |
| `hm capture [--dry-run]` | 이 PC → 레포 미리보기 |
| `hm capture --apply --only <id,…> --yes` | 고른 항목만 레포에 쓴다 |
| `hm settings` | 프로필 · 마켓플레이스 소스(`--self-source directory\|github`) |
| `hm manifest validate` | manifest 검사. 실패하면 종료 코드 3 |
| `hm repos sync --paths <경로…>` | 업무 레포 일괄 ff-only 최신화([계약](docs/contracts/repo-sync.md)) |

레포 위치는 `--repo` → `HM_REPO` → `~/.harness-manager/repo.json` → 자동 탐색(`jinmin` 마켓플레이스의 폴더 소스, `~/dev` 등 흔한 폴더의 `harness-manager`) 순서로 찾는다.

## 레포 구성

| 경로 | 내용 |
|---|---|
| `manifest/` | packages · tools · plugins · mcp · skills. 무엇을 설치할지의 정본 |
| `home/` | 배포 템플릿(전역 AGENTS.md · CLAUDE.md, Claude · Codex 관리 값, PS 프로필, git). `home/managed-keys.json`이 관리할 키 목록 |
| `mods/` | Claude Code hook mod 5개 — jinmin-hud · guard · codex-watch · mcw-companion · mcw-chips |
| `plugins/jinmin-skills/` | 스킬 플러그인 — jinmin-setup · ship-release · handoff-to-codex · agents-md-sync |
| `.claude-plugin/marketplace.json` | 마켓플레이스 `jinmin`. Claude와 Codex가 함께 읽는다 |
| `scripts/bootstrap.ps1` | 새 PC의 첫 진입점 |

마켓플레이스 소스는 PC마다 고른다. 개발 PC는 레포 폴더를 가리키는 directory 소스(고친 즉시 `/reload-plugins`로 반영), 새 PC는 GitHub 소스 `rafaam11/harness-manager`다. hook mod는 Codex에서 돌지 않으므로 Codex에는 스킬 플러그인만 켠다.

레포는 public이다. 개인 경로 · 개인 배경 지침 · 회사 스킬 · 비밀값은 커밋하지 않고 `~/.harness-manager/profile/`의 로컬 오버레이(`AGENTS.local.md`, `*.local.json`, `manifest.local.json`)에 둔다.

## 구조와 안전장치

<p align="center"><img src="docs/architecture.svg" alt="구조 — renderer, 타입드 IPC, main, 엔진, 레포와 사용자 홈" width="100%"></p>

- **렌더러는 id만 보낸다.** 경로와 명령은 main이 manifest에서 정한다. IPC는 채널 맵 타입 하나(`src/shared/api-types.ts`)에서 노출과 핸들러를 함께 만들고, main이 보낸 창과 입력의 정확한 키를 검증한다.
- **엔진은 Electron에 의존하지 않는다.** doctor · install · capture는 순수 Node 모듈이라 앱 · `hm` CLI · 테스트가 같은 코드를 쓴다. 테스트는 `HM_HOME` 등으로 임시 홈을 써서 실제 홈을 건드리지 않는다.
- **경로 allowlist** — manifest에서 정확한 경로를 파생한다. 위반은 403.
- **쓰기 한 길** — 모든 쓰기는 `writeFileChecked`를 지난다: 계획 때 읽은 원본과 대조(바뀌었으면 409) → `~/.harness-manager/backups`에 백업 → temp → atomic rename. 변경 연산은 in-process 락으로 직렬화하고 단일 인스턴스를 강제한다.
- **삭제하지 않는다** — 정리는 아카이브로 이동 + `manifest.json` · `journal.json` 기록, 원위치 복구.
- **사용자 레포의 git 작업**(repo-sync)은 셸 없이 고정 인자(`fetch --prune`, `merge --ff-only @{u}` 등)만 쓰고, 커밋 안 된 변경 · 갈라짐 · 진행 중인 merge는 건너뛴다.
- `~/.claude.json`은 Claude Code가 상시 재작성하므로 읽기 전용이다.

## 개발

단일 electron-vite 프로젝트다. 모든 명령은 루트에서 실행한다.

```bash
git clone https://github.com/rafaam11/harness-manager.git
cd harness-manager
npm install
npm run dev        # main/preload/renderer HMR + Electron 창
```

| 스크립트 | 설명 |
|---|---|
| `npm test` | vitest |
| `npm run typecheck` | TypeScript 검사(node + web 2패스) |
| `npm run build` | typecheck + 번들(`out/`) |
| `npm run dist` | Windows 설치본(`release/`) |
| `npm run dist:linux` | Linux AppImage(Linux · WSL 필요) |
| `npm run hm -- <명령>` | 빌드된 `hm` CLI 실행 |

- 검증 순서는 `npm test` → `npm run typecheck` → `npm run build`다.
- 릴리스는 `v*` 태그를 푸시하면 CI(`.github/workflows/release.yml`)가 Windows · Ubuntu x64 · Ubuntu arm64로 빌드해 draft 릴리스에 모으고, 확인한 뒤 발행한다. 릴리스 노트는 [`docs/release/`](docs/release)에 있다.
- 코드 구조와 규약은 [AGENTS.md](AGENTS.md)에 있다.
