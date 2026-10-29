# HM v4 구현 계약

구성요소 작업대 / 환경 / 변경 내역 / 프로필을 기본 탐색으로 사용한다. 전역 환경만 쓰고 프로젝트는 읽기 전용이다.
기존 doctor/install/capture CLI와 관리 키 merge·Node 보호·MCW 설정 읽기 전용 원칙을 유지한다.

공통 일반 스킬·지침은 `home/components.v2.json`에 파일 내용·정확한 출처·대상을 저장한다. 기존 프로필은 명시적 마이그레이션 전까지 자동 쓰기를 하지 않는다. 일반 문서 자동 적용은 활성 프로필 전체에 적용하며 실행 코드·플러그인 패키지·MCP·hook·권한 변경은 수동 검토한다.

설정 변경은 미리보기 토큰·원본 해시·정확한 파일 경로 검사·writeFileChecked·복구 저널을 통과한다. 새 파일 복원은 삭제 대신 보관한다. 패키지 명령에는 자동 복원을 약속하지 않는다.
GitHub 수신은 정확한 커밋으로 고정하고 프로필 공유는 수동이다. 네트워크·실제 CLI 실행 검증과 일반 설정 검사를 구분한다.

검증: 격리 홈에서 충돌·멱등·복구·자동 보류·버전 변화와 기존 CLI 회귀를 검사하고 실제 Electron UI 흐름을 확인한다.

## 사용 흐름

1. 프로필에서 공통 기본의 개인 사본을 만든다.
2. v4 전환 미리보기에서 일반 스킬·지침 자동 적용 정책을 확인한다.
3. 구성요소에서 새 스킬·지침을 작성하거나 로컬 파일/GitHub 저장소에서 가져온다.
4. 프로필 저장을 검토한 뒤, 선택 항목의 PC 적용을 별도로 검토한다. 같은 항목에서 Claude·Codex의 대상을 편집한다.
5. 변경 내역에서 파일 diff·결과·복원을 확인한다. 새 파일은 삭제하지 않고 보관한다.

## 지원 범위와 한계

- 스킬 원본은 정확한 GitHub 커밋과 문서 내용을 프로필에 함께 보관한다. 적용 lock에는 문서 해시와 실제 파일 해시를 저장한다. CLI 버전은 관측값이며 CLI 자체 업데이트와 외부 설치기의 버전 고정을 보증하지 않는다.
- 일반 문서는 `.md`·`.txt` 파일만으로 이루어진 스킬·지침이다. 최초 PC 적용은 수동이다. 실행 권한 파일·바이너리·링크·서브모듈·큰 저장소는 GitHub 가져오기에서 거절한다. 실행 코드 파일이 있는 패키지는 자동 갱신하지 않는다.
- 원격 프로필 변경에 설정·개인 파일·새로운 출처·적용 대상 변경·항목 추가/제거가 섞이면 전체 자동 수신을 보류한다. 수신과 실제 PC 적용은 별도로 기록한다.
- hook 검사는 정적 진단이다. SDK 모듈의 동적 이벤트 등록·신뢰 승인·현재 세션의 실행은 자동으로 증명하지 않는다. CLI 홈 밖의 개발 플러그인은 이 검사에서 읽지 않는다.
- MCP 검사는 사용자가 미리보기를 승인한 후 stdio/Streamable HTTP 초기화만 수행한다. 도구 호출·sampling·모델 요청은 보내지 않는다. 구형 SSE 전송은 미검증으로 남긴다.
- Codex 스킬 인식은 새 입력 미리보기의 이름과 기준 폴더를 보여 준다. 이름 일치가 패키지 출처나 이미 열린 세션의 실행을 증명하지 않는다.
- 복구 저널이 중단된 변경을 보존한다. 사용자 수정이 있으면 복원을 거절한다. 패키지 설치·OS 변경은 자동 되돌리기를 제공하지 않는다.

## 참고 설계

- [CC Switch](https://github.com/farion1231/cc-switch): 도구별 적용 대상 관리
- [AgentSwitch](https://github.com/RoyCoding8/AgentSwitch): 범위·hook 진단, 일괄 변경 복구
- [rulesync](https://github.com/dyoshikawa/rulesync), [agentsync](https://github.com/spxrogers/agentsync): 공통 정의·명시적인 변환 한계
- [AI Config Sync Manager](https://github.com/slash9494/ai-config-sync-manager): 적용 전후 해시와 이력
- [Vercel Skills](https://github.com/vercel-labs/skills): 발견·선택 업데이트 흐름
- [chezmoi](https://github.com/twpayne/chezmoi), [mise](https://github.com/jdx/mise): PC 전용 상태 분리와 재현성 기록
