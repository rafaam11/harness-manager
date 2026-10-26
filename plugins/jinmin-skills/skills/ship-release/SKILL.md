---
name: ship-release
description: 저장소 릴리스를 끝까지 자동 수행 — 릴리스 규약 파악, 검증, 버전 범프, 릴리스 노트, 커밋, 태그 푸시, CI 감시, GitHub 릴리스 발행. "배포해줘", "릴리스해줘", "publish까지 해줘", "ship it" 요청 시 사용한다.
---

# Ship Release

"배포해줘" 한마디를 **commit → push → CI 통과 확인 → 릴리스 발행**까지의 전 과정으로 해석하고
중간에 되묻지 않고 끝까지 수행하는 스킬.

## 원칙

- **한 번의 "배포해줘"는 publish까지의 승인이다.** 단계마다 확인을 구하지 않는다.
  단, 아래 "멈춰야 하는 경우"에 해당하면 즉시 멈추고 보고한다.
- **레포의 릴리스 규약을 추측하지 않는다.** 매번 0단계로 실측한다. 레포마다 버전 파일,
  노트 위치, 태그 형식, CI 트리거, draft 여부가 다르다.
- **검증이 통과하기 전에는 커밋하지 않는다.** 릴리스 커밋은 되돌리기 번거롭다.
- **거짓 검증 기록 금지.** 릴리스 노트의 "검증" 항목에는 실제로 실행한 것만 적는다.
  GUI 실측을 하지 않았다면 했다고 쓰지 않는다.
- `--amend`, force-push, 이미 푸시된 태그의 이동은 하지 않는다. 잘못 나갔으면 다음 패치로 고친다.

## 멈춰야 하는 경우 (보고 후 대기)

| 상황 | 조치 |
| --- | --- |
| 테스트·타입체크 실패 | 릴리스 중단. 실패 내용 보고. 고칠지 물어본다 |
| 작업 트리에 릴리스와 무관한 변경이 섞여 있음 | 무엇을 포함할지 확인 |
| 기본 브랜치가 아니거나 원격과 갈라져 있음 | 확인 후 진행 |
| `.env`, `credentials*` 등 시크릿 후보 파일이 스테이징 대상 | 제외하고 보고 |
| CI 실패 | 릴리스 발행하지 않음. 로그 요약 보고 |
| 버전 결정이 major(호환성 파괴)로 보임 | 근거 제시 후 확인 |

## 0단계 — 릴리스 규약 실측

다음을 한 번에 조회하고, "이 레포의 릴리스 절차"를 3~6줄로 요약한 뒤 진행한다.

```bash
git remote -v && git status --short && git log --oneline -10
git show --stat <최근 release 커밋 sha>      # 릴리스마다 함께 바뀌는 파일 목록이 여기서 나온다
git tag --sort=-creatordate | head -5
git cat-file -t <최신 태그>                   # tag=annotated, commit=lightweight
git tag -l --format='%(contents:subject)' <최신 태그>
ls .github/workflows && cat .github/workflows/release.yml
gh auth status
```

확인해야 할 것:

1. **버전 파일** — `package.json` / `pyproject.toml` / `Cargo.toml` / `*.csproj` 중 무엇인지,
   lock 파일도 함께 갱신되는지
2. **릴리스 노트 위치** — `docs/release/vX.Y.Z.md`, `CHANGELOG.md`, 없음 중 무엇인지.
   최신 릴리스를 가리키는 README 링크처럼 **함께 갱신되는 파일**이 있는지 (0단계 `git show --stat`이 알려준다)
3. **CI 트리거** — `on: push: tags: ["v*"]`인지, `workflow_dispatch`인지
4. **CI가 무엇을 검증하는지** — E2E·패키징을 CI가 한다면 로컬에서 중복 실행하지 않는다
5. **릴리스 생성 방식** — `softprops/action-gh-release`의 `draft: true`면 CI가 draft를 만들고
   **발행은 수동**이다. `--publish always`(electron-builder) 같은 자동 발행이면 태그 푸시로 끝난다
6. **태그·커밋 메시지 컨벤션** — 기존 것과 똑같이 맞춘다 (예: `chore: release v1.24.3`, 태그 메시지 `v1.24.3`)

## 1단계 — 사전 조건

- `git fetch` 후 기본 브랜치인지, 원격보다 뒤처져 있지 않은지 확인
- `git status --short` / `git diff --stat`으로 릴리스에 포함될 변경을 확정
- 시크릿 후보 파일은 스테이징에서 제외

## 2단계 — 검증

`package.json`의 scripts(또는 해당 생태계의 태스크)를 읽고 실행한다. 보통:

```bash
npm run typecheck      # 있으면
npm test               # 오래 걸리면 run_in_background로 돌리고 그동안 노트를 쓴다
```

- E2E·패키징은 CI가 같은 것을 재실행한다면 로컬에서 생략한다(0단계 4번으로 확인된 경우만).
- **실패하면 여기서 끝.** 커밋하지 않는다.

## 3단계 — 버전 결정

semver로 판단하고 **근거를 한 줄 명시**한다.

- 버그 수정·문구 수정 → patch
- 기능 추가, 하위 호환 → minor
- 저장 스키마/API 파괴 → major (확인 후 진행)

```bash
npm version 1.24.3 --no-git-tag-version    # package.json + package-lock.json 동시 갱신, 태그는 만들지 않음
```

## 4단계 — 릴리스 노트 + 부속 파일

- 직전 릴리스 노트 1~2개를 **먼저 읽고** 제목 규칙·섹션 구성·문체를 그대로 따른다.
- 제목은 `# vX.Y.Z — 무엇을 고쳤는지 한 줄`처럼 그 레포의 형식대로.
- 흔한 섹션: 변경 사항 / 호환성 / 릴리스 자산 / 검증.
- **사용자가 알아야 할 한계를 숨기지 않는다** (예: "이미 잘못 저장된 데이터는 복원되지 않는다").
- 0단계에서 확인한 부속 파일(README의 최신 릴리스 링크 등)을 같은 커밋에서 갱신한다.

## 5단계 — 커밋

레포 컨벤션 그대로. 여러 `-m`으로 제목/본문/트레일러를 나눈다(heredoc으로 파일을 만들지 않는다).

```bash
git add <릴리스에 포함할 파일들>        # git add -A 대신 명시적으로
git commit -m "chore: release v1.24.3" -m "<무엇을 왜 고쳤는지 본문>" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

## 6단계 — 태그 + 푸시

브랜치 먼저, 태그 나중. (태그가 먼저 가면 CI가 없는 커밋을 체크아웃하려 할 수 있다.)

```bash
git tag -a v1.24.3 -m "v1.24.3"      # 기존이 lightweight면 -a 없이
git push origin <기본 브랜치>
git push origin v1.24.3
```

CI가 태그와 `package.json` 버전 일치를 검사하는 경우가 흔하다 — 3단계 범프를 빠뜨리면 여기서 깨진다.

## 7단계 — CI 감시

```bash
gh run list --workflow=release.yml --limit 3           # 방금 뜬 run id 확인
gh run watch <run-id> --exit-status --interval 30      # run_in_background로 돌린다
```

- 대기 중에 다른 작업(문서, 다음 단계 준비)을 진행해도 되지만, **완료 전에 발행하지 않는다.**
- 실패하면: `gh run view <run-id> --log-failed | tail -50`으로 원인을 찾아 요약 보고.
  릴리스는 발행하지 않는다. 태그 삭제 여부는 사용자에게 묻는다.

## 8단계 — 릴리스 발행

CI가 draft를 만드는 구성이면 다음으로 마무리한다.

```bash
gh release view v1.24.3 --json isDraft,name,tagName,assets   # 자산이 다 붙었는지 확인
gh release view <직전 버전> --json name,body                  # 릴리스 본문 관례 확인 (아래 주의)
gh release edit v1.24.3 --draft=false --latest
gh release view v1.24.3 --json url,isDraft,publishedAt
```

- **자산 개수를 눈으로 확인**한다. 플랫폼별 인스톨러, `latest.yml`류 자동 업데이트 매니페스트가
  빠지면 기존 사용자에게 업데이트가 내려가지 않는다.
- **릴리스 본문은 직전 릴리스의 관례를 따른다.** 노트를 `docs/release/`에만 두고 GitHub 릴리스
  본문은 비워두는 레포가 있다 — 그런 곳에 임의로 `--notes-file`을 붙이지 않는다.
  본문을 채우는 관례라면 `--notes-file docs/release/v1.24.3.md`를 함께 준다.
- 자동 업데이트를 쓰는 앱이라면 `--draft=false`가 곧 전체 사용자 배포다. 되돌릴 수 없다는 점을 인지한다.

## 9단계 — 보고

- 버전과 릴리스 URL
- CI 결과(잡별 소요), 첨부된 자산 목록
- 릴리스 노트 요약 1~2줄
- **남은 수동 작업**(예: 사용자가 직접 확인해야 하는 GUI 동작, 복원 불가 데이터 재입력)

## 알려진 레포 규약

| 레포 | 버전 파일 | 노트 | 태그 | CI | 발행 |
| --- | --- | --- | --- | --- | --- |
| `harness-manager` | `package.json`(+lock) | `docs/release/vX.Y.Z.md` | annotated, 메시지=`vX.Y.Z` | `v*` 태그 push → windows·linux x64·arm64를 순차 빌드해 같은 draft에 append. 테스트는 CI에서 돌지 않으니 로컬에서 먼저. 기본 브랜치는 `dev` | `draft: true` → 검토 후 `gh release edit vX.Y.Z --draft=false --latest` |
| `multi-cli-work` | `package.json`(+lock), README의 "릴리스" 문단 링크 | `docs/release/vX.Y.Z.md` | annotated, 메시지=`vX.Y.Z` | `v*` 태그 push → 버전 일치 검사 → Windows/Linux 테스트·E2E·패키징 (약 7분) | `draft: true`로 생성됨 → `gh release edit vX.Y.Z --draft=false --latest`. 릴리스 본문은 비워두는 것이 관례(노트는 `docs/release/`에만) |

새 레포에서 이 스킬을 처음 쓰면, 0단계 실측 결과를 이 표에 한 줄 추가한다.
