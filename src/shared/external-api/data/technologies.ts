import type { Technology } from "../schema.js";

export const technologies: Technology[] = [
  { id: "rest-api", name: "REST API", category: "protocol", summary: "HTTP 요청으로 구조화된 데이터를 조회한다." },
  { id: "json", name: "JSON", category: "format", summary: "웹과 서버에서 널리 사용하는 구조화 데이터 형식이다." },
  { id: "xml", name: "XML", category: "format", summary: "공공 API에서 자주 사용하는 문서형 데이터 형식이다." },
  { id: "csv", name: "CSV", category: "format", summary: "표 형태 대용량 파일을 교환하는 형식이다." },
  { id: "geospatial", name: "공간정보", category: "data", summary: "좌표, 주소, 경계와 이동망을 다룬다." },
  { id: "sdk", name: "지도 SDK", category: "client", summary: "웹·앱에 지도와 장소 상호작용을 표시한다." },
  { id: "oauth", name: "OAuth 2.0", category: "auth", summary: "사용자 또는 애플리케이션 권한을 위임한다." },
  { id: "server-proxy", name: "서버 프록시", category: "architecture", summary: "비밀키와 CORS 제약을 브라우저 밖에서 처리한다." },
];
