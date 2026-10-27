const domainLabels: Record<string, string> = {
  business: "사업", culture: "문화", environment: "환경", facility: "시설",
  geospatial: "공간정보", health: "건강", local: "지역", mobility: "교통",
  place: "장소", public: "공공", search: "검색", seoul: "서울",
  statistics: "통계", weather: "날씨",
};

const skillCategoryLabels: Record<string, string> = {
  automotive: "자동차", beauty: "뷰티", business: "비즈니스", civic: "시민·행정",
  convenience: "편의", culture: "문화", data: "데이터", documents: "문서",
  education: "교육", entertainment: "엔터테인먼트", finance: "금융", food: "식음료",
  health: "건강", healthcare: "의료", history: "역사", housing: "주거",
  information: "정보", ip: "지식재산", jobs: "일자리", legal: "법률",
  "legal-documents": "법률 문서", lifestyle: "생활", "local-info": "지역 정보",
  logistics: "물류", marketing: "마케팅", marketplace: "마켓플레이스",
  messaging: "메시징", news: "뉴스", other: "기타", procurement: "조달",
  "public-health": "공중보건", "real-estate": "부동산", recruiting: "채용",
  research: "연구", retail: "소매", security: "보안", setup: "설정",
  sports: "스포츠", transit: "대중교통", transport: "운송", travel: "여행",
  utility: "유틸리티", weather: "날씨", writing: "글쓰기",
};

const technologyCategoryLabels: Record<string, string> = {
  architecture: "아키텍처", auth: "인증", client: "클라이언트",
  data: "데이터", format: "데이터 형식", protocol: "프로토콜",
};

const format = (labels: Record<string, string>, value: string) => labels[value] ?? value;

export const formatDomain = (value: string) => format(domainLabels, value);
export const formatSkillCategory = (value: string) => format(skillCategoryLabels, value);
export const formatTechnologyCategory = (value: string) => format(technologyCategoryLabels, value);
export const formatDomains = (values: readonly string[], separator = " · ") => values.map(formatDomain).join(separator);
