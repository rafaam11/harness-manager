import type { Blueprint } from "../schema.js";

const examples = {
  node: "const key = process.env.DATA_GO_KR_API_KEY;\nconst response = await fetch(url, { headers: { Authorization: key ?? '' } });",
  python: "import os, requests\nkey = os.environ['DATA_GO_KR_API_KEY']\nresponse = requests.get(url, headers={'Authorization': key})",
};

export const blueprints: Blueprint[] = [
  {
    id: "commute-condition", name: "출퇴근 컨디션", problem: "출발 전에 날씨, 대기와 대중교통 도착 상태를 한 번에 판단한다.",
    users: ["대중교통 통근자", "자전거 통근자"], inputs: ["출발 지역", "정류장·역 이름", "출발 시간"], outputs: ["날씨·대기 요약", "도착 정보", "공식 원문 링크"],
    sourceIds: ["weather-kma", "airkorea", "tago", "topis"], flow: ["지역·정류장 입력 검증", "서버에서 예보·대기·도착 조회", "시간대와 단위를 정규화", "출처별 상태를 함께 표시"],
    stack: ["TypeScript", "Cloudflare Workers", "Astro"], mvpSteps: ["예시 위치 날씨", "역명 도착 검색", "대기 등급 결합"], risks: ["도시별 정류장 식별자 차이", "실시간 API 지연"],
    privacy: ["위치 권한을 요구하지 않는다", "검색어와 좌표를 저장하지 않는다"], fallback: ["마지막 결과를 최신으로 오인하지 않게 시각 표시", "각 공식 서비스 링크 제공"], examples,
  },
  {
    id: "neighborhood-infrastructure", name: "동네 생활 인프라", problem: "이사나 외출 전에 주변 공공시설과 생활업종을 함께 찾는다.",
    users: ["이사 준비자", "지역 생활자"], inputs: ["주소 또는 예시 좌표", "시설 종류", "반경"], outputs: ["공공시설 목록", "생활업종 목록", "지도 링크"],
    sourceIds: ["localdata", "data-go-kr", "juso", "kakao-local-mobility", "naver-search-map"], flow: ["주소를 좌표로 변환", "반경과 결과 수 제한", "공공·민간 장소를 병렬 조회", "거리와 운영기관으로 정렬"],
    stack: ["TypeScript", "Geospatial API", "서버 프록시"], mvpSteps: ["주소 검색", "공공시설 반경 검색", "공식 링크 연결"], risks: ["폐업·이전 정보 시차", "상호명 중복"],
    privacy: ["주소 입력을 로그에 남기지 않는다", "정밀 좌표를 저장하지 않는다"], fallback: ["검색 반경을 넓히는 안내", "LOCALDATA 원문 검색 링크 제공"], examples,
  },
  {
    id: "safety-environment-alert", name: "안전·환경 알림", problem: "생활권의 날씨·대기·응급 대응 정보를 빠르게 확인한다.",
    users: ["야외 활동자", "호흡기 민감 사용자"], inputs: ["시도", "관심 시간", "응급시설 종류"], outputs: ["기상 위험", "대기 등급", "응급시설 안내"],
    sourceIds: ["weather-kma", "airkorea", "e-gen", "data-go-kr"], flow: ["행정구역 입력 검증", "환경 지표 병렬 조회", "등급과 확인 시각 표시", "응급 원문 연결"],
    stack: ["TypeScript", "Scheduled Worker", "Web Push 없이 정적 알림판"], mvpSteps: ["시도별 대기", "단기예보", "응급실 공식 링크"], risks: ["안전 판단 과신", "관측소 결측"],
    privacy: ["건강 상태를 입력받지 않는다", "사용자 프로필을 만들지 않는다"], fallback: ["119 등 공식 긴급 연락 수단 명시", "결측값을 추정하지 않는다"], examples,
  },
  {
    id: "local-culture-calendar", name: "지역 문화 일정", problem: "여러 공연·문화 채널에 흩어진 지역 일정을 한 흐름으로 찾는다.",
    users: ["공연 관람자", "지역 행사 기획자"], inputs: ["날짜 범위", "지역", "검색어"], outputs: ["공연·행사 목록", "장소와 예매 원문"],
    sourceIds: ["culture-kopis", "seoul-open-data", "kakao-local-mobility"], flow: ["최대 날짜 범위 검증", "KOPIS와 지역 데이터를 조회", "작품·장소 중복을 표시", "예매·기관 원문 연결"],
    stack: ["Astro", "Cloudflare Workers", "KOPIS API"], mvpSteps: ["기간별 공연", "지역 필터", "장소 검색 연결"], risks: ["취소·변경 반영 시차", "동일 공연 중복"],
    privacy: ["관람 이력을 저장하지 않는다"], fallback: ["문화포털·KOPIS 원문에서 최신 상태 확인 안내"], examples,
  },
  {
    id: "accessible-mobility", name: "이동약자 편의 탐색", problem: "이동 경로 주변의 교통·시설 접근성 단서를 모아 사전 계획을 돕는다.",
    users: ["휠체어 사용자", "유아차 동반자", "고령자"], inputs: ["출발지", "목적지", "필요 편의시설"], outputs: ["대중교통 후보", "주변 공공시설", "확인 필요 항목"],
    sourceIds: ["tago", "topis", "vworld", "data-go-kr", "e-gen"], flow: ["주소·정류장 후보 조회", "교통과 시설 데이터를 결합", "접근성 필드의 출처와 시각 표시", "현장 확인 항목 제공"],
    stack: ["TypeScript", "공간정보", "접근 가능한 HTML"], mvpSteps: ["정류장 검색", "편의시설 목록", "정보 확인일 표시"], risks: ["접근성 필드 불완전", "현장 상태와 데이터 차이"],
    privacy: ["장애·건강 정보를 수집하지 않는다"], fallback: ["시설과 운영기관에 직접 확인할 연락 경로 제공", "확정 경로로 표현하지 않는다"], examples,
  },
  {
    id: "family-weekend", name: "아이와 함께하는 주말 계획", problem: "날씨, 이동, 문화 일정과 편의시설을 조합해 무리 없는 주말 후보를 만든다.",
    users: ["아동 동반 보호자"], inputs: ["지역", "날짜", "이동 시간", "관심 활동"], outputs: ["일정 후보", "날씨·대기 조건", "이동·시설 체크리스트"],
    sourceIds: ["weather-kma", "airkorea", "culture-kopis", "kakao-local-mobility", "data-go-kr"], flow: ["날짜·지역 조건 확인", "공연과 장소 후보 조회", "날씨·대기 조건 결합", "선택 근거와 원문 표시"],
    stack: ["Astro", "Preact", "Cloudflare Workers"], mvpSteps: ["공연 후보", "날씨 결합", "주변 시설 연결"], risks: ["연령 적합성 정보 부족", "행사 변경"],
    privacy: ["아동 이름·나이·위치를 저장하지 않는다"], fallback: ["주최기관의 관람 연령과 운영 상태를 다시 확인하도록 안내"], examples,
  },
];
