/** 기능 대응표다. 설치·신뢰·실행을 확인했다는 뜻은 아니다. */
export const MOD_PARITY = [
  { claude: "jinmin-hud", codex: "jinmin-codex / codex-status", detail: "상태 조회로 대체 · 입력창 HUD·토큰·비용 추정은 제공하지 않음" },
  { claude: "guard", codex: "jinmin-codex / HM_CODEX_GUARD=block", detail: "위험 명령 차단 · 승인 질문 방식은 지원하지 않음" },
  { claude: "codex-watch", codex: "jinmin-codex 외부 CLI 관측", detail: "직접 실행·도구 반환 관측 · 분리 프로세스 생존은 미검증" },
  { claude: "mcw-companion", codex: "MCW 자체 통합", detail: "MCW가 주입 · HM은 해당 설정을 읽기만 함" },
  { claude: "mcw-chips", codex: "MCW 자체 Codex 칩", detail: "모델·권한·도구 관측값 표시 · 컨텍스트·비용 추정 제외" },
] as const;
