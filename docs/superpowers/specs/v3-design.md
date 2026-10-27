# harness-manager v3.0.0 설계 — 개발환경 통합 관리 대시보드

- 상태: 승인된 방향(M0). 세부는 마일스톤마다 갱신한다.
- 기준: v2.0.6(`dev` `634f203`), 승계 원본 multi-cli-work v1.51.1(`be29875`)

## 1. 목표와 비목표

### 목표
1. **새 PC 원샷 셋업**: clone → 앱 또는 `scripts/bootstrap.ps1` → 셋업 위저드 → 끝. 실행 전에 doctor가 이미 된 것과 빠진 것을 먼저 보여 준다.
2. **상태판 대시보드**: 첫 화면은 카드 8개 그리드다. 카드는 툴체인, Claude Code, Codex, 플러그인, 스킬, MCP, cua-driver, dotfiles다. 카드를 누르면 섹션 화면으로 가서 설치·업데이트·동기화·되돌리기를 한다.
3. **Claude와 Codex를 같은 수준으로 관리**: 레포의 원본 하나에서 공통 AGENTS.md, 설정, 마켓플레이스·플러그인, MCP를 양쪽에 배포한다.
4. **jinmin-mods 흡수**: hook mod 5개와 마켓플레이스 `jinmin`을 이 레포가 호스팅한다.
5. **역방향 수집(capture)**: 현재 PC의 설정을 레포 템플릿으로 끌어온다. diff를 보여 준 뒤 쓴다.
6. **위저드 두 겹**: 앱 UI 위저드와, AI가 "설치해줘"를 받아 같은 엔진을 돌리는 스킬 및 AGENTS.md 절차.

### 비목표
- 폴더 구조와 작업 프로젝트 규약(multi-cli-work 담당)
- jk MCP와 Multi CLI Work hook: 앱이 세션마다 주입하므로 관리하지 않는다. mcw-* mod만 배포한다.
- v2의 Timeline, Workspace·git, News, Glossary, GitHub stars, live sessions, recall, usage, translate는 **제거**한다.
  - "외부 API" 카탈로그(D17)는 v2 기능을 되살리는 것이 아니다. M12에서 새로 추가하는 섹션이다.
- 회사 전용 스킬은 public 레포에 넣지 않는다. 회사 private 마켓플레이스에 두고, 접근 검사(`gh api orgs/<org>`)를 통과할 때만 조건부로 설치한다.
- 비밀값(토큰, OAuth, auth.json)과 개인 배경 지침은 레포에 넣지 않는다.

## 2. 결정 로그

| # | 결정 |
|---|---|
| D1 | 버전은 v3.0.0. v2.x 태그가 있으므로 2.0.0으로 내리면 태그가 충돌하고 updater가 다운그레이드로 판단한다 |
| D2 | 설치 로직까지 이 앱에 통합한다. jinmin-mods는 최종적으로 폐기한다 |
| D3 | v2 기능 중 정리/아카이브와 설정 편집기만 보존한다. 카탈로그 조회 로직은 섹션 화면의 기반으로 재사용한다 |
| D4 | 첫 화면은 상태판과 섹션 탭이다. 위저드는 상단 버튼으로 연다 |
| D5 | public 레포를 유지한다(electron-updater 익명 업데이트). 민감한 내용은 걸러낸다 |
| D6 | 마켓플레이스 이름 `jinmin`을 유지한다. source만 이 레포로 옮긴다 |
| D7 | Codex도 Claude와 같은 수준으로 관리한다 |
| D8 | 툴체인 프로필은 core/dev/full이고 항목별로 토글한다 |
| D9 | 위저드와 대시보드는 심플하게 만든다 |
| D10 | multi-cli-work의 UI·main 코드를 최대한 승계한다 |
| D11 | **브랜치: `dev`에 직접 작업한다.** v3 브랜치와 `main`은 만들지 않는다 |
| D12 | **IPC: mcw식 타입드 contextBridge를 쓴다(M2).** 상세는 §5-8 |
| D13 | **jinmin-mods는 단순 복사**한다(히스토리는 가져오지 않는다) |
| D14 | **statusLine은 jinmin-hud로 확정**했다(Q6 해결). claude-hud 플러그인·마켓플레이스와 `statusLine`은 이미 제거했다. capture 초기값에 넣지 않는다. 남은 마켓플레이스는 claude-plugins-official, 회사 마켓플레이스, jinmin이다 |
| D15 | **마켓플레이스 소스는 PC별로 고른다.** 개발 PC는 `directory`(레포 폴더), 새 PC는 GitHub(`rafaam11/harness-manager`)를 쓴다. `manifest/plugins.json`과 위저드에서 선택한다 |
| D18 | **Electron 43.2.0 + electron-builder 26 적용**(Q9 해결, M2). `sandbox:true`, 커스텀 타이틀바, mcw `installer.nsh`(WMI 정지 PC의 NSIS 무한 대기 회피) |
| D19 | **설정 백업은 `~/.harness-manager/backups` 한 곳**(M2). v2의 `~/.claude/backups/harness-manager`는 정리 화면의 `leftovers` 후보로 다룬다(D24) |
| D20 | **Codex는 같은 마켓플레이스를 공유하되 `plugins/*`만 enable한다**(M3, 옛 Q12). codex-cli 0.162.1 실측: `codex plugin marketplace add <레포>`가 `.claude-plugin/marketplace.json`을 그대로 읽어 6개를 모두 보여 주고, `jinmin-skills`의 스킬은 `jinmin-skills:<이름>`으로 모델 프롬프트에 들어간다. hook mod도 설치는 되지만(캐시에 복사) Codex는 `hooks.json`의 `modules`를 실행하지 않아 아무 효과가 없다. 오류는 없다. 그래서 `plugins.json`은 provider별 enable 목록을 둔다 |
| D21 | **레포 일괄 최신화(repo-sync)는 HM 엔진·CLI와 mcw 트리거로 나눈다**(M3.5). 업무 프로젝트→레포 매핑은 mcw만 가지므로 HM은 경로 목록만 받는다. 버튼과 세션 시작 트리거는 mcw가 맡고, 자동 실행은 mcw가 띄운 세션만 대상으로 한다. 세션 브리프에는 최대 3초를 기다린 요약을 넣는다. 명령은 `fetch --prune` + `merge --ff-only @{u}`, 기본값은 쿨다운 10분·동시 4개다. untracked만 있으면 진행한다. HM이 없는 PC는 mcw 대체 구현이 같은 계약을 따른다. 계약은 `docs/contracts/repo-sync.md` |
| D22 | **capture 정책**(M4, 옛 Q10). 공개·개인을 나눠 개인 값은 `~/.harness-manager/profile/`로 보낸다. 비공개 낱말은 로컬 `profile/private-terms.json`에 두고, 이 파일이 없으면 적용을 막는다. 공개 파일에 홈 경로·절대경로·이메일·비공개 낱말이 남으면 노출 경고로 막는다. 관리 키는 `home/managed-keys.json`에 둔다. plugins·mcp·skills는 더하기만 하고 MCP env 값은 자리표시로 적는다. AGENTS.md는 마커 블록(`<!-- >>> harness-manager >>> -->`)이 있으면 그 안이, 없으면 레포 템플릿에 제목이 있는 섹션만 공개다. PS 프로필·gitconfig·WT capture는 마커 merge가 생기는 M6로 미룬다 |
| D23 | **install은 doctor 검사에서 step을 만든다**(M6). 실행 전후로 같은 검사를 돌려 멱등과 결과 판정을 한다. 실행기는 셸 없이 돌리고 `.cmd` 심만 cmd.exe에 엄격히 인용해 넘긴다. self 마켓플레이스 소스가 다르면 remove → add 뒤 빠진 플러그인을 같은 step에서 다시 설치한다(M11의 1–3단계를 이 step이 한다). 소스는 `settings.json`의 `selfMarketplaceSource`(directory/github). PS 프로필·gitconfig·WT는 템플릿 capture가 먼저 필요해 M6 후속으로 남긴다 |
| D24 | **정리 확장**(M8, 옛 Q3 결론). v2 앱 데이터와 v2 백업은 지우지 않고 `leftovers` 후보로 보인다. 중복 스킬은 해당 provider에서 플러그인이 켜져 있을 때만 후보로 한다. Codex는 오래된 로그만 다루고 세션·DB는 다루지 않는다. doctor와 정리 화면은 같은 탐색 함수를 쓴다 |
| D25 | **dotfiles 범위**(M6 후속). PowerShell 5.1 프로필(마커 블록, BOM)과 git 전역 설정(관리 키, `git config`로만 읽기·쓰기)을 다룬다. Windows Terminal은 settings.json이 주석 있는 JSON(JSONC)이라 안전한 부분 merge가 없어 보류한다. pwsh 7 프로필은 pwsh를 쓰기 시작하면 같은 방식으로 더한다 |
| D26 | **외부 API 흡수 형태**(M12, 옛 Q13). 카탈로그는 main이 만들어 렌더러에 넘긴다(zod는 main에만). 상세 페이지는 대화상자 하나로 합치고 라우트를 두지 않는다. 실시간 미리보기(Worker)는 넣지 않는다. 사용자 API 키를 앱에 저장하지 않기 위해서다. yaml 대신 gray-matter를 쓴다 |
| D17 | **jk-external-api 흡수**: 공개 색인 사이트였던 jk-external-api(한국 생활·지역 외부 정보원, k-skill 스냅샷, 청사진)를 앱 기능 **"외부 API"** 섹션으로 다시 만든다(M12, v3.0.0 릴리스 뒤). 소스는 단순 복사한다. GitHub Pages 사이트, Cloudflare Worker 미리보기, 주간 자동 PR은 폐기하고 원 레포는 archive한다 |
| D16 | **mod version 규약**: `mods/*`는 고칠 때마다 `plugin.json` version을 올린다. GitHub 소스에서 version이 그대로면 update를 건너뛰기 때문이다. `plugins/*`에는 version을 두지 않고 커밋 SHA를 따라가게 한다 |

### 미결 (해당 마일스톤에서 결정)
- Q4 같은 스킬의 사본 두 개(`~/.claude/skills` vs `~/.agents/skills`)가 다를 때 어느 쪽이 최신인지 확인(M9)
- Q7 cua-driver의 공식 설치 명령, 릴리스 URL, 텔레메트리를 끄는 키(M6에서 `--help`와 문서로 확인)
- Q8 대화형 로그인: node-pty를 쓸지 외부 터미널을 쓸지. 외부 터미널 쪽이 단순하다
- Q11 Linux 지원 범위: 설치 엔진은 Windows를 먼저 지원한다. Linux는 doctor와 설정만 지원할지 정한다

## 3. 레포 레이아웃(목표)

```
harness-manager/
  AGENTS.md  CLAUDE.md(@AGENTS.md)  README.md
  package.json          # 3.0.0, appId com.digitrack.claudeharnessmanager 유지
  src/
    main/
      services/
        doctor/         # 검사기 레지스트리 → 카드 상태
        install/        # step 엔진(plan → dry-run → run → verify), 로그 스트림
        capture/        # 현재 PC → 레포 템플릿 diff/쓰기
        merge/          # JSON deep-merge(관리 키), TOML 관리 블록, 텍스트 마커 블록
        catalog/ mcp/ plugins/ cleanup/   # v2 보존
      providers/        # claude/codex 어댑터(정리 후) + 실행 파일 감지(mcw provider-launch)
      lib/              # path-guard, safe-write, lock, archive … + mcw json-store, utf8, platform-env
      cli.ts            # hm-cli 진입점(electron-vite main 진입점 추가)
    preload/  renderer/src/  shared/
  manifest/
    packages.json       # winget/scoop/cargo/npm/uv. 항목: id, source, profiles, check
    tools.json          # claude, codex, cua-driver 같은 단독 설치기(버전 고정, 설치·검증·텔레메트리)
    plugins.json        # 마켓플레이스와 Claude/Codex별 enable 목록. 회사 마켓플레이스는 조건부
    mcp.json            # 공통 MCP 정의 → Claude(user scope)와 Codex(config.toml) 양쪽
    skills.json         # externalSkills(예: find-skills, `npx skills`로 설치)
  home/                 # 배포 템플릿(관리 키만)
    agents/AGENTS.md  claude/CLAUDE.md  claude/settings.managed.json
    codex/config.managed.toml  codex/rules/default.rules
    powershell/profile.ps1  git/gitconfig.managed  wt/fragment.json
  mods/                 # jinmin-mods hook mod 5개(Claude 전용) + README.md
  plugins/jinmin-skills/  # agents-md-sync, handoff-to-codex, ship-release, jinmin-setup
  .claude-plugin/marketplace.json   # name "jinmin": mods/* + plugins/*
  scripts/bootstrap.ps1
```

- `mods/`와 `plugins/`는 앱 패키지에 들어가지 않는다(electron-builder `files`가 `out/**`만 포함). 마켓플레이스는 GitHub 소스로 제공한다.
- 전역 AGENTS.md는 두 파일을 합쳐 만든다.
  - `home/agents/AGENTS.md`: public. 프로젝트 문서 컨벤션과 세션 인계만 담는다.
  - `~/.harness-manager/profile/AGENTS.local.md`: 로컬 전용. 개인 배경을 담는다.
  - 배포할 때 마커 블록으로 합쳐 `~/.codex/AGENTS.md`를 만든다. capture도 두 부분을 나눠 저장한다.
- `home/claude/CLAUDE.md`는 `@~/.codex/AGENTS.md` 래퍼다.

## 4. 이전 매핑

| 원본 | 목적지 | 비고 |
|---|---|---|
| jinmin-mods `mods/*` 5개 | `mods/*` | 단순 복사(D13) |
| jinmin-mods `.claude-plugin/marketplace.json` | 루트 `.claude-plugin/marketplace.json` | name `jinmin` 유지. `plugins/*` 항목 추가 |
| jinmin-mods `README.md` | `mods/README.md` | 로컬 경로 오류(C:→D:)를 고친다. 설치 섹션은 앱·위저드 안내로 바꾼다. `--marketplace rafaam11/jinmin-mods` 안내는 옮기지 않는다(그 레포는 private로 바뀌어 동작하지 않는다) |
| `~/.claude/skills/agents-md-sync`, `handoff-to-codex` | `plugins/jinmin-skills/skills/*` | 범용 스킬 |
| 회사 마켓플레이스의 `ship-release` | `plugins/jinmin-skills/skills/ship-release` | 개인판으로 분기. git·gh만 쓴다 |
| (신규) `jinmin-setup` | `plugins/jinmin-skills/skills/jinmin-setup` | AI 위저드 |
| 외부 스킬 find-skills | `manifest/skills.json` | 복사하지 않는다. 설치 단계에서 받는다 |
| 회사 도메인 스킬 | 회사 private 마켓플레이스 | 이 레포에는 넣지 않는다(M9) |
| 깨진 스킬 symlink | 제거 | doctor가 "깨진 링크"로 잡고 Cleanup이 아카이브한다 |
| 전역 AGENTS.md, CLAUDE.md, settings.json, config.toml, rules, PS 프로필, gitconfig, WT | `home/**` 템플릿과 관리 키 | §5-4 |
| cua-driver | `manifest/tools.json`, `manifest/mcp.json` | §5-5 |
| jk-external-api `packages/catalog`(schema, data, `catalog.ts`, `generated/skills.json`) | `src/shared/external-api/` | M12. 단순 복사하고 `.js` import 규약을 적용한다. skills.json은 앱에 번들하는 기준 스냅샷이다 |
| jk-external-api `catalog/sync`, `scripts/check-external-health.ts` | `src/main/services/external-api/{sync,health}.ts` | GitHub 익명 API로 받아 `~/.harness-manager/external-api/skills.json`에 저장한다(번들보다 우선). 화면의 "스냅샷 새로고침"과 "공식 링크 점검" 버튼에서 실행한다 |
| jk-external-api `apps/site` lib(registry, discovery, labels)와 컴포넌트(RegistryTable/Dialog, CompareTable, HomeExplorer 관계도, StatusMark, CopyCode) | `src/renderer/src/external-api/`, `pages/ExternalApi/*` | Preact를 React로 옮긴다. Astro 라우트는 탭 4개(정보원, k-skill, 청사진, 기술)와 비교 다이얼로그로 바꾼다. 테스트도 vitest로 옮긴다 |
| jk-external-api `apps/preview-worker`, Pages/Worker/catalog-watch CI, Astro, Playwright e2e, eslint | 폐기 | 로컬 전용 앱이고 비밀값을 레포에 두지 않는다는 원칙에 따른다(Q13) |
| jk-external-api README, docs, LICENSE, THIRD_PARTY_NOTICES | `docs/external-api/`, 루트 NOTICES | k-skill(MIT) 귀속 고지는 반드시 남긴다 |

## 5. 아키텍처

### 5-1. 엔진과 UI 분리
doctor·install·capture는 **Electron에 의존하지 않는 순수 Node 모듈**로 만든다. 이렇게 분리하는 이유는 세 가지다.
- 앱 UI가 쓴다.
- headless `hm-cli`로도 돌린다. 앱을 설치하기 전이거나 원격 셸일 때 필요하다.
- vitest로 테스트한다.

`hm-cli`의 진입점과 배포 방식:
- 진입점: electron-vite main의 두 번째 입력 `cli`(`out/main/cli.js`). M3.5에서 `repos sync|summary`로 골격을 세웠다. doctor·install·capture는 같은 파일에 하위 명령으로 붙인다.
- PATH 등록: 전역 PATH에는 넣지 않는다. 설치본은 기동 때 `~/.harness-manager/bin/hm.cmd`와 `hm-cli.json`(다른 앱이 셸 없이 spawn할 `{command,args,env}`)을 적는다. 실행 파일을 `ELECTRON_RUN_AS_NODE=1`로 띄워 asar 안의 cli.js를 돌린다.
- 플래그: `--profile core|dev|full`, `--only <ids>`, `--yes`, `--dry-run`, `--json`

### 5-2. Step 계약
```ts
interface Step {
  id: string                 // 'packages.winget.ripgrep', 'claude.plugin.guard', 'mcp.cua-driver.codex'
  section: 'toolchain'|'claude'|'codex'|'plugins'|'skills'|'mcp'|'cua'|'dotfiles'
  profiles: ('core'|'dev'|'full')[]
  check(): Promise<{ state: 'ok'|'missing'|'drift'|'error'; detail: string }>
  plan(): Promise<Change[]>  // dry-run 미리보기
  apply(log): Promise<void>  // 멱등. 이미 ok면 skip
  interactive?: boolean      // 로그인 등 대화형
}
```
- **실행 순서**
  1. packages: winget → scoop → rustup → nvm/node 22 → npm global → uv
  2. ai-cli: Claude native, codex
  3. dotfiles
  4. claude: marketplace, plugin, settings merge
  5. codex
  6. mcp
  7. cua
  8. verify: doctor 재실행
- 렌더러는 **step id만** 보낸다. 실행 파일과 인자는 main이 manifest에서 정한다.
- **로그와 진행률**
  - 로그: child_process의 stdout/stderr를 로그 이벤트로 흘려 보낸다.
  - 진행률: 작업표시줄 진행 막대(`window-progress`)와 `osc-progress`로 표시한다.
  - 실행기 원형: mcw `worktree-script-runner.ts`(숨긴 spawn, 타임아웃, 출력 끝 4KB 보관)
- 설치 중 앱을 끄려 하면 `quit-coordinator`로 막고 확인을 받는다.

### 5-3. doctor
- 검사기 레지스트리 = 각 Step의 `check()`이고, 결과를 섹션별로 집계해 카드 상태를 정한다.
  - 모두 ok면 초록 "정상"이다.
  - drift가 있으면 노랑 "주의"다.
  - missing이나 error가 있으면 빨강 "누락"이다.
- 그 밖의 검사: 깨진 symlink, loose 스킬 중복, Codex에 MCP가 등록되지 않았는지
- mod 의존성 검사
  - codex-watch는 openai-codex 플러그인의 `codex-companion.mjs`가 없으면 동작하지 않는다. 이 경우 "주의"로 표시한다.
  - mcw-companion과 mcw-chips는 multi-cli-work 세션에서만 동작한다. 정보로만 표시한다.
  - jinmin-hud와 mcw-chips의 userConfig가 설정돼 있지 않으면 기본값으로 동작한다고 표시한다.
- Cleanup 후보: 제거한 claude-hud가 남긴 폴더(`~/.claude/plugins/cache/claude-hud`, `~/.claude/plugins/claude-hud`)

### 5-4. 설정 merge (사용자 설정 불가침)
- 파일을 통째로 덮어쓰지 않는다. 레포는 **관리 키 목록**만 갖고 그 키들만 deep-merge한다.
- 쓰기는 `lib/safe-write.ts` 경로를 탄다: baseHash 비교 → 검증 → `.bak`(20개 순환) → temp → atomic rename. 백업 위치는 `~/.harness-manager/backups` 하나로 합친다.
- TOML은 smol-toml로 읽고 관리 테이블만 바꾼다. 주석과 순서가 보존되지 않으면 마커 블록 방식으로 바꾼다.
- 텍스트 파일(PS 프로필 등)은 `# >>> harness-manager >>>` … `# <<< harness-manager <<<` 마커 블록. 마크다운은 `#`이 제목이라 `<!-- >>> harness-manager >>> -->` 짝을 쓴다. 이 마커 블록만 관리한다.
- Codex의 profile toml과 `multi-cli-work.config.toml`은 읽기 전용이다.
- PC마다 다른 값(예: 특정 도구 경로가 들어간 permission)은 로컬 오버레이로 분리한다.

### 5-5. cua-driver
- **설치**: manifest에 버전을 고정한다(현재 0.37.0, Windows x64). 설치 위치는 `~/.cua-driver/packages/current`이고, 공식 설치 명령은 Q7에서 확인한다.
- **검증**: `cua-driver doctor`의 모든 항목이 정상이어야 한다.
- **텔레메트리**: 기본으로 켜져 있으므로 끈다. 끄는 키는 Q7에서 확인한다.
- **등록**
  - Claude: `claude mcp add -s user cua-driver -- <exe> mcp`
  - Codex: `config.toml`의 `[mcp_servers.cua-driver]`(`command=<exe>`, `args=["mcp"]`) 또는 `codex mcp add`
- 사용가이드 스킬은 선택 항목이고 기본은 off다. MCP `get_guide`로 대체할 수 있다.
- 끝나면 "새 세션부터 cua 도구가 노출됩니다"라고 안내한다.

### 5-6. 위저드 두 겹
- **앱 Wizard 흐름**
  1. 환영
  2. doctor 결과
  3. 프로필 선택
  4. 섹션·항목 체크리스트
  5. 변경 미리보기(plan)
  6. 실행(LogTerminal과 진행 막대)
  7. 인증 안내(`gh auth login`, Claude 로그인, `codex login`, 커넥터)
  8. 최종 doctor 표
- **AI 위저드**: `jinmin-setup` 스킬. 흐름은 `hm-cli doctor --json` → 질문 → `hm-cli install --only <ids> --yes`이고, 실패하면 로그를 읽고 대응한다. 질문 도구의 이름은 중립적으로 적는다.
- 클론 직후 플러그인이 아직 없는 상태를 위해, 레포 AGENTS.md에도 "설치해줘" 절차를 같은 내용으로 적는다.
- `scripts/bootstrap.ps1`: 앱이 아직 없을 때의 진입점이다. winget으로 git, gh, node를 설치한 뒤 clone하고, 앱을 설치하거나 headless CLI를 실행한다.

### 5-7. 보안 가드
- `ALLOWED_ROOTS`에 manifest에서 파생한 **정확한 경로**를 추가한다. 대상은 `~/.agents`, PS 프로필, `~/.gitconfig`, WT settings, `~/.cua-driver`다. 폴더 전체를 열지 않는다.
- 패키지 설치 명령은 manifest에 있는 id만 실행한다.
- 테스트 격리 환경변수 `HARNESS_MANAGER_USER_DATA`, `HM_HOME`, `HM_CLAUDE_HOME`, `HM_CODEX_HOME`을 둔다. 엔진 테스트는 실제 홈을 건드리지 않는다.

### 5-8. IPC (D12)
- **계약**: `src/shared/api-types.ts` 인터페이스 하나가 기준이다. 채널 맵 타입 하나에서 다음을 같이 만든다.
  - preload의 `contextBridge` 노출
  - main의 핸들러 등록
- **구독**: preload의 `onX` 구독 함수는 해제 함수를 반환한다.
- **main 쪽 검증**: `registerMainIpc(registrar, deps)`로 의존성을 주입하고, 보낸 창을 검증한다. 입력은 `ipc-validation`(exactObject, nonEmptyString 등 정확한 키 집합)으로 검증한다.
- **에러**: v2 `ApiResult` 봉투의 statusCode 의미(403/409/422)는 에러 타입으로 보존한다. renderer는 `ipc-error.ts`로 해석한다.
- **전환 방식**: v2 `router.ts`·`api:invoke`는 M2에서 한 번에 교체하고 병행 운영하지 않는다.

### 5-9. 화면 (심플)
- **TitleBar**(mcw): 앱 이름, 위저드 버튼, 업데이트 배지, 테마 토글
- **Dashboard**
  - 카드 8개. 각 카드는 상태 점, 글자 라벨, 요약 한 줄(예: "패키지 18/20"), 주 동작 버튼 하나를 갖는다.
  - 상단에 doctor 재실행 버튼과 마지막 검사 시각을 둔다.
- **섹션 페이지**: 표 형태(상태 / 이름 / 설치 버전 vs manifest / 동작)이고, 아래에 접히는 LogTerminal을 둔다.
- **Config**: v2 설정 편집기. **Cleanup**: v2 기능에 "깨진 symlink", "loose 스킬 중복", Codex 대상을 추가한다.
- 사이드바는 아이콘 열 하나다. `App.tsx`는 셸만 맡고 화면은 `pages` 레지스트리와 view 상태로 전환한다.

## 6. v2 정리 목록 (K=보존, R=제거, K\*=보존·정리)

### main
- 최상위
  - `index.ts` K
  - `ipc.ts`·`router.ts`: M2에서 교체
  - `updater.ts`: mcw판으로 교체
  - `config.ts` K\*: 경로·정리 상수만 남긴다
- lib K: path-guard, path-scope, lock, safe-write, archive, json-validate, toml-validate, config-write, cc-detect, process-detect, open-external, time(K\*)
- lib R: board, project-registry, path-normalize, process-liveness, test-fixtures/, news-cache, news-item-state, favorites, rss, http, github-stars-*, translation-cache, deepl-client, secrets, mask, glossary-custom
- providers
  - types K\*: listProjects·listSessions·listPlans를 제거한다
  - registry K
  - claude K\*: recall import를 끊는다
  - codex K\*: 세션 파싱을 제거하고 listConfigFiles·readMcpServers·listCatalog·detectRunning만 남긴다
  - codex-state R
- services K: catalog, mcp, plugins, scan, projects(파일 열람은 R), hooks(K\*)
- services R: recall, plans, tasks, provider-workspace, repo-group, git/**, live-sessions, claude-live-tracking, news*, github-stars*, translate, usage

### renderer
- K
  - `App.tsx`(다시 짠다), `main.tsx`, `api/client.ts`(`fmtStars` R)
  - `UpdateBadge`, `markdown.ts`, `provider-ui.ts`
  - Catalog, Cleanup, ConfigEditor
- `workspace-shared.ts`: 두 함수만 `provider-ui.ts`로 옮기고 파일은 삭제한다.
- R: Timeline, Workspace, SessionTranscriptModal, Usage, News, GitHubStars, Glossary, GlossaryGraph, `pages/git/**`, `git/**`, `data/glossary*`

### shared
- K: `types.ts`, `provider-types.ts`(K\*: Session·Timeline·Transcript 타입은 R)
- R: git-types, news-types, github-stars-types, translate-types, glossary-types, item-state-types, usage-types, project-registry

### 먼저 끊어야 할 얽힌 곳
1. `providers/claude.ts` → `services/recall.ts` import
2. `providers/codex.ts`의 세션 파싱 덩어리
3. `ProviderAdapter`의 projects·sessions·plans 메서드
4. Catalog·ConfigEditor가 쓰는 `workspace-shared.ts` 함수
   - CSS를 지울 때 공유 여부를 확인한다. `.cat-split`·`.cat-master-item`은 News·GitHubStars와, `.tl-filter*`는 News와 같이 쓴다.

### 의존성
- 제거: `parse-diff`, `proper-lockfile`. 단 mcw `json-store` 승계 시 다시 필요하다.
- 유지: gray-matter, smol-toml, marked, dompurify, vanilla-jsoneditor, electron-updater, lucide-react, jsdom(dev)
- 추가 후보: `motion`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`

## 7. multi-cli-work 승계 (`src/` 기준)

mcw의 스택은 Electron 43.2.0, Node ≥22.12다. v3에서 Electron을 43으로 올린다(Q9).

### A. 그대로 복사
- **renderer**
  - 테마·토큰: `theme-colors.css`, `index.css` `:root` 토큰(폰트, `--type-*`, 모션), `theme.ts`(저장 키 변경), `motion-tokens.ts`, `renderer-typography.ts`, `terminal-themes.ts`
  - contract 테스트: `typography-contract.test.ts`, `motion-contract.test.ts`
  - 컴포넌트: `toast.tsx`(info·warning 톤 추가), `confirm-dialog.tsx`, `TerminalSearchBar.tsx`
  - 유틸: `use-dismissable.ts`, `context-menu-position.ts`, `use-transient-set.ts`, `ipc-error.ts`
- **main**
  - 저장: `storage/json-store.ts`, `settings/settings-store.ts`(패턴만)
  - 업데이트: `updater.ts`·`updater-platform.ts`·`updater-log.ts`
  - 창: `quit-coordinator.ts`, `window-chrome.ts`, `window-security.ts`, `main-window.ts`, `window-progress.ts`
  - 기타: `providers/provider-launch.ts`, `platform-env.ts`, `utf8.ts`, `terminal/osc-progress.ts`
- **빌드**
  - `build/installer.nsh`: WMI가 멈춘 PC에서 NSIS 설치가 무한 대기하는 문제를 피한다.
  - `.github/workflows/release.yml`: 태그와 버전 일치 검사, OS별 test·e2e를 돌린다. android 잡은 제외한다.
  - `.github/dependabot.yml`
  - 테스트 설정: `vitest.config.ts`, `renderer/src/test/setup.ts`, `playwright.config.ts`, `e2e/desktop.spec.ts`

### B. 조금 손봐서
- `TitleBar.tsx`·`title-bar-menu.ts`: UsageGauge와 SessionAttention을 뺀다.
- `QuickOpenPalette.tsx`·`quick-open.ts`: kind를 제네릭으로 바꾼다.
- `UpdateBadge.tsx`: v2판과 합친다.
- `SessionChips`/`TagChips`는 상태 칩으로, `brand-icons.tsx`는 Claude·Codex 아이콘으로 쓴다.
- `main/index.ts`: 단일 인스턴스, 트레이, `Menu.setApplicationMenu(null)`
- IPC 구조: `shared/api-types.ts`, `preload/index.ts`, `main/ipc.ts`, `ipc-validation.ts`
- `projects/worktree-script-runner.ts`: step 실행기의 원형
- `terminal-worker.ts`, `terminal/*`: 대화형 단계 PTY. 필요할 때만 쓴다(Q8).
- `TerminalPane.tsx`: 일부를 떼어 `LogTerminal({write, clear, readOnly})`로 만든다.
- `control/control-cli-installer.ts`: hm-cli 심
- `agents/builtin-agents.ts`, `agent-launch.ts`: 실행 파일 후보와 인자 템플릿

### C. 참고만
- `SettingsDialog.tsx`의 구조
- `HomeDashboard.tsx`의 "CLI & 업데이트" 카드: 상태 카드의 원형
- `claude-integration.ts`·`codex-integration.ts`: 설정 불가침 사례
- `index.css`: 필요한 구간만 가져오고, `--space-*`·`--radius-*`는 새로 정의한다.
- `App.tsx`(2,816줄): 반면교사

## 8. 마일스톤

| M | 내용 | 완료 기준 |
|---|---|---|
| M0 | AGENTS.md 재작성, CLAUDE.md 래퍼, 이 문서 | 사용자 확인 |
| M1 | §6 R 제거, 얽힌 4곳 끊기, 의존성 정리 | `npm test && npm run typecheck && npm run build`, dev에서 Catalog·Config·Cleanup 동작 |
| M2 | Electron 43, mcw 기반 승계, 타입드 IPC, contract 테스트 | 위 검증 + 테마 전환·업데이트 배지 |
| M3 | `mods/`, 마켓플레이스, `mods/README.md`, `plugins/jinmin-skills`(agents-md-sync, handoff-to-codex, ship-release. `jinmin-setup`은 M7) | validate는 마켓플레이스와 mod 5개 모두 통과, `claude plugin test`는 112개 통과(이전 전 기준선과 같아야 한다). Codex 마켓플레이스 add를 실측한다(→ D20) |
| M3.5 | repo-sync 엔진, `hm-cli` 골격과 심, mcw 계약 문서(D21) | 임시 git 픽스처로 fast-forward·dirty·untracked·diverged·no-upstream·detached·네트워크 실패·쿨다운·중복 제거·동시 상한을 검증한다 |
| M4 | manifest 스키마·검증기, capture 엔진 | capture diff 화면, `hm-cli capture --dry-run` |
| M5 | doctor, Dashboard, 섹션 페이지(읽기 전용) | 현재 PC에서 알려진 노랑·빨강이 정확히 잡힘 |
| M6 | install 엔진, merge, LogTerminal, 진행 막대 | 임시 HOME에서 vitest 통합 테스트, 두 번째 install은 전부 skip |
| M7 | Wizard, `hm-cli`, `jinmin-setup`, AGENTS.md 절차, bootstrap | dry-run으로 위저드 완주, 새 세션에서 "설치해줘" 흐름 동작 |
| M8 | Cleanup 확장 | 아카이브·복구 왕복 |
| M9 | 회사 스킬을 private 마켓플레이스로 이관 | 사용자 확인 후 push |
| M10 | v3.0.0 릴리스 | 2.0.6 → 3.0.0 자동 업데이트 실측 |
| M11 | jinmin-mods 폐기. **순서를 지킨다.** 지금 PC의 `jinmin`은 `directory` 소스로 jinmin-mods 폴더를 직접 읽기 때문이다. 순서: `marketplace remove jinmin` → `marketplace add <harness-manager>` → mod 5개 재설치 → 검증 → jinmin-mods archive와 폴더 삭제 | `claude plugin list`에서 mod 5개 정상 |

| M12 | jk-external-api 흡수(D17). "외부 API" 섹션을 만든다. 정보원·k-skill·청사진·기술 탭, 검색·필터(fuse.js), 비교, 관계도, 스냅샷 새로고침, 링크 점검을 넣는다. 의존성은 `zod`·`yaml`을 main `dependencies`에 둔다(yaml은 가능하면 gray-matter로 대체). 네트워크 호출은 main에서만 한다. 이 기능을 앱 릴리스로 검증한 뒤 원 레포를 폐기한다. 외부에 공개되는 작업이라 단계마다 확인받는다: README 이전 안내 → Pages 끄기 → `wrangler delete` → 시크릿과 `automation/*` 브랜치 정리 → archive | `npm test`(옮겨 온 테스트 포함), typecheck, build 통과. 항목 수가 원 사이트와 같아야 한다(정보원 14, 청사진 6, k-skill 스냅샷 전체) |

새 PC 시뮬레이션(M7 이후): Windows Home이라 Windows Sandbox를 쓸 수 없다. 새 로컬 계정이나 VM에서 bootstrap을 실행하고 `core` 프로필로 시험한다.
