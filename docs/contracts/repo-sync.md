# 레포 일괄 최신화 계약 (repo-sync)

harness-manager(HM)와 multi-cli-work(mcw)가 함께 지키는 규칙이다. 업무 프로젝트에 묶인 레포들을 fast-forward로만 최신화하고, 결과를 레포 단위로 보고한다.

- **HM**: 엔진(`src/main/services/repo-sync/`)과 CLI(`hm repos …`)를 맡는다. 이 문서와 공유 타입 `src/shared/repo-sync-types.ts`가 HM이 지키는 계약이다.
- **mcw**: 업무 프로젝트를 레포 경로 목록으로 푼다(셸 `repos:` → `<root>/dev/<repo>`, `external_paths:` 절대경로). 버튼과 세션 시작 트리거를 맡는다. HM은 프로젝트 레지스트리를 읽지 않는다(mcw `registry-contract.md` §0).
- 이 계약은 mcw의 `projects.json` 계약과 별개다. 새 공유 파일은 `~/.harness-manager/repo-sync/` 아래에만 둔다.

## 1. 호출 방법

### 1-1. CLI 찾기
1. `~/.harness-manager/bin/hm-cli.json`을 읽는다.
   ```json
   { "schemaVersion": 1, "command": "<앱 실행 파일>", "args": ["<…/app.asar/out/main/cli.js>"], "env": { "ELECTRON_RUN_AS_NODE": "1" } }
   ```
   `command`를 **셸 없이** spawn한다. 인자는 `args` 뒤에 붙이고, 환경은 현재 환경에 `env`를 더한다. 설치된 HM이 기동할 때마다 이 파일을 갱신한다.
2. 사람이 터미널에서 부를 때는 같은 폴더의 `hm.cmd`를 쓴다(PATH에는 없다).
3. 파일이 없거나 `command`가 없으면 HM이 설치되지 않은 것이다. mcw는 §6의 대체 구현을 쓴다.

### 1-2. 명령
```
repos sync --stdin --json            # 권장. stdin: {"paths":[…], "force"?:bool, "label"?:str, "waitMs"?:num, "concurrency"?:num}
repos sync --paths <p>… [--force] [--label 이름] [--wait-ms N] [--concurrency N] [--json]
repos summary --paths <p>… [--json]  # 네트워크 없이 state.json만 읽는다
```
- 경로에 공백이나 한글이 많으므로 **`--stdin` JSON을 권장**한다.
- `force`: 쿨다운(§4)을 무시한다. 수동 버튼에 쓴다. 중복 제거는 force여도 그대로 적용한다.
- `waitMs`: 그 시간이 지나면 그때까지의 보고서를 **stdout 첫 줄**로 출력한다. 남은 레포는 `pending`에 들어간다. 프로세스는 남은 레포를 끝까지 처리해 state.json에 기록한 뒤 종료한다.
  - 호출자는 첫 줄만 읽으면 되고 종료를 기다릴 필요가 없다.
  - 세션 시작에서는 `waitMs: 3000`을 쓴다. 호출자가 먼저 꺼지더라도 프로세스가 기록을 마칠 수 있게 detached로 spawn한다.
- `--json`이면 stdout은 **JSON 한 줄**이다. 진단은 stderr로만 나간다.

### 1-3. 종료 코드
| 코드 | 뜻 |
|---|---|
| 0 | 명령이 끝까지 돌았다. 레포 실패는 결과에 담긴다. **레포 실패는 0이다** |
| 2 | 사용법 오류(경로 없음, 알 수 없는 옵션, stdin JSON 오류). 결과 없음 |
| 1 | 예상하지 못한 내부 오류 |

## 2. 출력 스키마 (`RepoSyncReport`)
```ts
{
  schemaVersion: 1,
  label?: string,
  startedAt: string,            // ISO
  finishedAt: string,
  results: RepoResult[],        // 입력 순서. 같은 레포를 다른 표기로 여러 번 넣어도 한 번만 처리한다
  pending: string[],            // waitMs 안에 끝나지 않은 경로(summary 명령에서는 "기록 없음")
  summary: string               // 세션 컨텍스트에 그대로 넣는 한국어 블록
}
RepoResult = {
  path: string,                 // path.resolve한 원형
  status: "updated" | "up-to-date" | "skipped" | "failed",
  reason?: "missing" | "cloud-sync" | "not-a-repo" | "detached" | "no-upstream" | "in-progress-op" | "dirty" | "diverged",
  failKind?: "network" | "auth" | "timeout" | "overwrite" | "git",
  error?: string,               // git stderr 마지막 줄
  commits?: number,             // updated일 때 받아 온 커밋 수
  ahead?: number, behind?: number,
  branch?: string, upstream?: string,
  finishedAt: string,
  cached: boolean               // 이번 호출에서 git을 돌리지 않고 기록을 재사용했으면 true
}
```
summary 예:
```
레포 3개 중 1개 최신화, 1개 이미 최신, 1개 건너뜀
- 최신화: alpha(2커밋)
- 건너뜀: sample-app(로컬 변경)
```
화면 라벨은 `REPO_SKIP_LABELS`·`REPO_FAIL_LABELS`(공유 타입)와 같은 문구를 쓴다.

## 3. 안전 정책 (판정 순서가 곧 계약이다)
레포마다 아래 순서로 판정한다. 먼저 걸리는 사유 하나만 남긴다.

| 순서 | 검사 | 결과 |
|---|---|---|
| 1 | 경로가 폴더로 존재하지 않음 | `skipped/missing` |
| 2 | 클라우드 동기화 폴더 아래(§5). git을 부르기 전에 판정한다 | `skipped/cloud-sync` |
| 3 | `rev-parse --show-toplevel`이 실패하거나 경로와 다름(레포의 하위 폴더 포함) | `skipped/not-a-repo` |
| 4 | detached HEAD | `skipped/detached` |
| 5 | upstream 없음 | `skipped/no-upstream` |
| 6 | git-dir에 `MERGE_HEAD`·`rebase-merge`·`rebase-apply`·`CHERRY_PICK_HEAD`·`REVERT_HEAD`가 있음 | `skipped/in-progress-op` |
| 7 | 추적 파일에 커밋 안 된 변경·충돌이 있음. **untracked는 막지 않는다** | `skipped/dirty` |
| 8 | `git fetch --prune` 실패 | `failed/<분류>` |
| 9 | `rev-list --left-right --count HEAD...@{u}` 실패(prune으로 원격 브랜치가 사라짐) | `skipped/no-upstream` |
| 10 | behind = 0 | `up-to-date`(ahead 기록) |
| 11 | ahead > 0, behind > 0 | `skipped/diverged` |
| 12 | `git merge --ff-only @{u}` 실패 | `failed/<분류>`. untracked를 덮어써야 하는 경우는 `overwrite`이고 작업 트리는 그대로다 |
| 13 | 성공 | `updated`, `commits = behind` |

- 실행하는 명령은 위의 `rev-parse`·`status`·`fetch --prune`·`rev-list`·`merge --ff-only @{u}`뿐이다. **reset, push, force, clean, stash, rebase, checkout은 쓰지 않는다.** 현재 브랜치만 다룬다.
- 셸을 거치지 않고 고정된 인자 목록으로 실행한다. 환경에 `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, ssh `BatchMode=yes`를 넣는다. 인증이 필요하면 창을 띄우지 않고 `auth`로 실패한다.
- 제한 시간: 조회 10초, fetch 60초, merge 30초. 시간을 넘기면 `timeout`이다.
- 실패 분류는 stderr로 한다. 인증을 네트워크보다 먼저 본다.
  - `auth`: authentication failed, could not read Username, Permission denied (publickey), terminal prompts disabled, HTTP 401/403
  - `network`: could not resolve host, unable to access, failed to connect, could not read from remote repository, does not appear to be a git repository
  - 그 밖은 `git`이다.
- 어떤 실패도 예외로 올라가지 않는다. 세션 시작을 막지 않는다.

## 4. 동시성, 중복 제거, 쿨다운
- **경로 키**: `path.resolve` → 구분자 통일 → 후행 구분자 제거 → Windows에서는 소문자(`toLocaleLowerCase("en-US")`). mcw `workspacePathKey`와 같은 규칙이다.
- **동시 실행**: 기본 4개다.
- **프로세스 안**: 같은 키의 실행이 진행 중이면 새로 돌리지 않고 그 결과를 함께 기다린다.
- **프로세스 사이**: 레포마다 잠금을 하나 둔다.
  - 잠금 위치: `~/.harness-manager/repo-sync/locks/<sha1(경로 키) hex>`
  - 라이브러리: `proper-lockfile`. 옵션은 `realpath:false`, `lockfilePath = <대상>.lock`, stale 10초, 갱신 5초.
  - 잠금을 기다리는 한도는 120초다. 넘기면 `failed/timeout`이다.
  - 잠금을 얻은 뒤 state.json의 그 레포 결과가 **기다리기 시작한 시각 이후**에 끝난 것이면, git을 돌리지 않고 그 결과를 `cached:true`로 쓴다.
- **쿨다운**: `force`가 아니고, 마지막 결과가 `updated`나 `up-to-date`이며 10분 안이면 그 결과를 `cached:true`로 돌려준다. 건너뜀과 실패에는 쿨다운이 없다.

## 5. 클라우드 동기화 폴더 제외
- Google Drive: 경로 세그먼트에 `My Drive`·`내 드라이브`·`Google Drive`·`Shared drives`·`공유 드라이브`가 있다(대소문자 무시).
- OneDrive: 환경변수 `OneDrive`·`OneDriveCommercial`·`OneDriveConsumer`의 경로 아래다.
- Teams·SharePoint: 레지스트리 `HKCU\Software\SyncEngines\Providers\OneDrive\*`의 `MountPoint` 아래다. `reg query` 출력은 코드 페이지 때문에 한글이 깨지므로 UTF-8 출력으로 읽는다.
- 사용자 제외: `~/.harness-manager/repo-sync/config.json`의 `{"excludePaths": ["…"]}` 아래다. 사용자가 손으로 쓰는 파일이고, 엔진은 읽기만 한다.

## 6. 공유 파일과 mcw 대체 구현
- `~/.harness-manager/repo-sync/state.json`
  - 형태: `{ schemaVersion: 1, updatedAt, repos: { <경로 키>: RepoResult } }`. 저장된 `cached`는 늘 false다.
  - **쓰는 쪽**: HM 엔진과 mcw 대체 구현. 둘 다 이 파일의 잠금(`state.json.lock`), 원자적 rename, 파싱되는 파일만 `.bak`으로 남기는 규칙을 따른다(mcw `json-store`와 같은 프로토콜).
  - **읽는 쪽은 모르는 키를 무시한다**(exact-keys 금지). 필드는 optional로만 늘린다. registry-contract §8의 다운그레이드 함정을 피하기 위해서다.
- **mcw 대체 구현**(HM이 없는 PC)
  - §3의 판정 순서, 사유 코드, 명령 목록을 그대로 따른다.
  - §4의 잠금 파일과 state.json을 같은 경로에서 쓴다. 그래야 나중에 HM이 설치돼도 중복 제거와 쿨다운이 이어진다.
  - 결과 형태와 summary 문구도 같게 만든다. 공유 타입 파일을 복사해 쓰고 출처를 주석으로 남긴다.

## 7. 세션 시작 연동 (mcw)
1. 세션을 띄우기 직전에 그 세션 폴더가 속한 업무 프로젝트의 레포 경로 목록을 만든다.
2. `repos sync --stdin --json`을 detached로 spawn한다(`{paths, label: <프로젝트명>, waitMs: 3000}`).
3. 첫 줄 JSON을 최대 약 3.5초 기다린다(spawn 비용 포함). 받으면 `summary`를 브리프(`MULTI_CLI_WORK_PROJECT_BRIEF`) 끝에 한 블록으로 붙인다. 받지 못하면 붙이지 않는다.
4. 세션은 결과와 상관없이 띄운다. SessionStart hook 안에서는 최신화를 돌리지 않는다. Codex hook은 5초 제한이 있고, 동시에 뜬 세션들의 pull이 겹치기 때문이다.

## 8. 버전
- 이 문서는 `schemaVersion: 1`이다. 호환되지 않는 변경은 `schemaVersion`을 올리고, CLI는 한 릴리스 동안 옛 형태를 함께 받는다.
