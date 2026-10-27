import type { SkillOverrides } from "@shared/external-api/schema";

export const skillOverrides: SkillOverrides = {
  "korea-weather": { sourceIds: ["weather-kma", "data-go-kr"], technologyIds: ["rest-api", "json", "xml"] },
  "fine-dust-location": { sourceIds: ["airkorea", "data-go-kr"], technologyIds: ["rest-api", "json", "xml", "geospatial"] },
  "kakao-map": { sourceIds: ["kakao-local-mobility"], technologyIds: ["rest-api", "json", "geospatial", "sdk"] },
  "kakao-bar-nearby": { sourceIds: ["kakao-local-mobility"], technologyIds: ["rest-api", "json", "geospatial"] },
  "kopis-performance-search": { sourceIds: ["culture-kopis"], technologyIds: ["rest-api", "xml"] },
  "localdata-business-status": { sourceIds: ["localdata"], technologyIds: ["rest-api", "json", "xml", "csv"] },
  "kosis-stats": { sourceIds: ["kosis"], technologyIds: ["rest-api", "json", "csv"] },
  "korean-transit-route": { sourceIds: ["tago", "topis"], technologyIds: ["rest-api", "json", "xml", "geospatial"] },
  "seoul-subway-arrival": { sourceIds: ["seoul-open-data", "topis"], technologyIds: ["rest-api", "json", "xml"] },
  "emergency-room-beds": { sourceIds: ["e-gen", "data-go-kr"], technologyIds: ["rest-api", "json", "xml", "geospatial"] },
  "parking-lot-search": { sourceIds: ["data-go-kr", "kakao-local-mobility"], technologyIds: ["rest-api", "json", "geospatial"] },
  "public-restroom-nearby": { sourceIds: ["data-go-kr", "kakao-local-mobility"], technologyIds: ["rest-api", "json", "geospatial"] },
  "zipcode-search": { sourceIds: ["juso"], technologyIds: ["rest-api", "json", "xml", "geospatial"] },
  "legacy-naver-map-route": { sourceIds: ["naver-search-map"], technologyIds: ["rest-api", "json", "geospatial", "sdk"] },
};
