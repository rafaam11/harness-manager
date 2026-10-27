# Harness Manager

Claude Code와 Codex의 개발환경을 진단하고 **선택한 사용자 프로필**에 맞춰 구축하는 Electron 데스크톱 앱입니다. Windows와 Linux에서 실행하며, 패키지 자동 설치는 현재 Windows 중심입니다.

## 시작하기

1. [릴리스](https://github.com/rafaam11/harness-manager/releases)에서 Windows 설치 파일 또는 Linux AppImage를 받습니다.
2. 앱의 **셋업 위저드**를 열고 HM 앱 레포를 연결합니다. 레포가 없으면 화면에서 받을 수 있습니다.
3. **사용자 프로필**을 고릅니다. 새 사용자는 `공통 기본`으로 시작합니다.
4. 진단 → 설치 범위(core/dev/full) → 항목 선택 → 미리보기 → 실행 → 로그인 → 재진단 순으로 진행합니다.

앱 실행에는 별도 Node.js가 필요 없습니다. 설치 대상 CLI가 Node를 필요로 하면 엔진이 검사합니다. 정상 Node 22.12 이상과 npm은 보존하며 MSI/NVM 혼재를 자동 정리하지 않습니다. 설치 뒤 기존 터미널은 새로 열어야 변경된 PATH가 반영됩니다.

## 사용자 프로필

앱 소스와 사용자 설치 정의를 나눕니다. `core / dev / full`은 사용자 이름이 아니라 **선택한 프로필 안의 설치 범위**입니다.

| 종류 | 동작 |
|---|---|
| 공통 기본 | Git·Node·Claude Code·Codex를 다룹니다. 개인 모델, 권한, 플러그인, MCP, dotfiles는 지정하지 않습니다. |
| 개인 프로필 | 위저드에서 이름을 입력하고 현재 프로필을 복사합니다. 패키지·설정·플러그인을 본인 필요에 맞게 관리합니다. |
| 외부 폴더 | `manifest/`와 `home/`을 가진 프로필 폴더를 연결합니다. 별도로 클론한 비공개 Git 저장소도 사용할 수 있습니다. |
| 기존 jinmin | 이전 버전의 개인 설정 예시입니다. 명시적으로 선택할 때만 적용됩니다. 개인 사본으로 복사할 수 있습니다. |

로컬 개인 프로필은 `~/.harness-manager/profiles/<id>/definition/`에 저장됩니다. PC 전용 값은 그 옆 `local/`에 따로 두며 토큰·OAuth·로그인 파일은 복사하지 않습니다. 기존 프로필을 복사할 때 관리 중인 로컬 보완 설정도 새 `local/`로 복사합니다.

**가져오기(capture)**는 현재 PC의 변경을 선택한 프로필로 저장합니다. 공개할 수 없는 값은 로컬 보완 설정으로 분리합니다. 공통 기본은 읽기 전용이므로 개인 사본을 먼저 만듭니다. 프로필을 바꿔도 이전 프로필로 설치한 패키지나 관리 대상 밖 설정을 자동 삭제하지 않습니다.

업데이트 후 기본은 `공통 기본`입니다. 이전 jinmin 구성을 계속 관리하려면 위저드에서 해당 프로필을 선택하거나 복사하세요. 이미 설치된 PC 설정은 프로필 선택만으로 변경되지 않습니다.

## AI 설치 복구

실패한 항목에서 **Codex에게 해결 요청** 또는 **Claude Code에게 해결 요청**을 누릅니다. 여러 항목은 최대 3개까지 병렬 처리하며, 같은 설정이나 런타임을 수정하는 작업은 대기합니다. 작업별 로그와 중단 버튼을 제공합니다.

실행 전 안내에 동의하면 기존 CLI 로그인 계정으로 오류·설치 계획·최근 로그를 전달하고 **YOLO 모드**로 실행합니다. Codex는 `--dangerously-bypass-approvals-and-sandbox`, Claude Code는 `--dangerously-skip-permissions`를 사용합니다. 명령마다 확인받지 않으며 각 AI 프로세스는 사용자 계정 권한으로 동작합니다. 최대 3회 복구하고 매번 실제 상태를 재검사합니다.

공통 앱 버그는 별도 HM 소스 사본에서 수정하고 테스트·타입 검사·빌드를 통과한 뒤 dev에 커밋·푸시합니다. 원격 저장소 쓰기 권한이 필요합니다. 충돌이나 권한 부족이 생기면 수정 사본과 로그를 남깁니다. 개인 프로필은 공개 HM 소스 반영 대상에서 제외합니다. 커밋·푸시는 새 앱 릴리스를 발행하지 않으므로 앱 코드 개선은 후속 릴리스에 포함됩니다.

## 주요 기능

- **상태판·doctor**: 툴체인, Claude, Codex, 플러그인, 스킬, MCP, cua-driver, dotfiles 진단
- **설치·위저드**: manifest 기반 계획, 파일 diff, 실행 로그, 재검증
- **가져오기**: 관리 키·마커 블록만 프로필로 저장, 개인 값 분리
- **정리**: 후보 확인 후 아카이브, 복원 지원
- **외부 API**: 정보원·기술·청사진·k-skill 카탈로그
- **자동 업데이트**: 공개 GitHub 릴리스에서 업데이트 수신

일반 설정 쓰기는 원본 대조·백업·atomic rename을 거칩니다. JSON/TOML/프로필 전체를 덮어쓰지 않습니다. AI 복구는 별도 CLI 프로세스에서 동작하므로 이 파일 쓰기 경로로 강제 격리되지는 않습니다.

## CLI

설치된 앱은 `~/.harness-manager/bin/hm.cmd`를 제공합니다. 개발 빌드는 `node out/main/cli.js`로 실행합니다.

```text
hm profiles list --json
hm profiles create personal --from default
hm profiles connect work <별도로-클론한-프로필-폴더>
hm profiles use <프로필-ID>
hm settings --profile core --self-source github
hm doctor --json
hm install --json
hm install --run --only <step-id,...> --yes
hm capture --dry-run
```

프로필의 `manifest/{packages,tools,plugins,mcp,skills}.json`이 설치 대상을, `home/managed-keys.json`과 `home/` 템플릿이 관리할 설정을 정의합니다. `hm manifest validate --repo <HM-레포>`는 레포의 manifest 형식을 검사합니다. 비공개 Git 저장소 생성·인증·push는 프로필 폴더에서 사용자가 관리합니다.

## 개발과 검증

```text
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

단일 electron-vite 프로젝트입니다. 엔진은 Electron 없이 CLI와 vitest에서 실행됩니다. 테스트는 임시 홈과 모의 실행기를 사용하며 실제 개발환경을 설치·제거하지 않습니다. `npm run dist`는 Windows 설치 파일을 만듭니다. `v*` 태그를 푸시하면 CI가 Windows·Linux x64·Linux arm64의 draft 릴리스를 만들고, 검증 후 발행합니다.

개발 규약은 [AGENTS.md](AGENTS.md), 설계 기록은 [v3 설계](docs/superpowers/specs/v3-design.md)를 참고하세요.
