import generatedSkills from "./generated/skills.json";
import { blueprints } from "./data/blueprints.js";
import { sources } from "./data/sources.js";
import { technologies } from "./data/technologies.js";
import { catalogSchema, type Catalog } from "./schema.js";

/** 앱에 번들한 k-skill 기준 스냅샷. "스냅샷 새로고침"으로 받은 사본이 있으면 그쪽이 우선한다. */
export const bundledSkills: unknown[] = generatedSkills;

/**
 * 손으로 관리하는 정보원·청사진·기술에 k-skill 목록을 붙여 카탈로그를 만든다. 정보원의 skillIds는 스킬 쪽
 * sourceIds에서 거꾸로 계산한다. 스키마에 맞지 않으면 throw한다(호출자가 번들 스냅샷으로 되돌린다).
 */
export function buildCatalog(skills: unknown[]): Catalog {
  const parsedSkills = catalogSchema.shape.skills.parse(skills);
  const linkedSources = sources.map((source) => ({
    ...source,
    skillIds: parsedSkills.filter(({ sourceIds }) => sourceIds.includes(source.id)).map(({ id }) => id),
  }));
  return catalogSchema.parse({ sources: linkedSources, skills: parsedSkills, blueprints, technologies });
}

export const catalog: Catalog = buildCatalog(bundledSkills);
