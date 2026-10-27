// jk-external-api(packages/catalog/src/schema.ts)에서 옮겨 왔다(M12, 단순 복사).
// 공개 사이트·Worker는 폐기했으므로 미리보기 응답 타입은 뺐다. previewAdapterId는 데이터 호환을 위해 남긴다.
import { z } from "zod";

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const isoDate = z.iso.date();

export const previewAdapterIdSchema = z.enum([
  "weather",
  "air-quality",
  "transit-arrival",
  "public-facilities",
  "places",
  "performances",
]);

export type PreviewAdapterId = z.infer<typeof previewAdapterIdSchema>;

export const sourceSchema = z.object({
  id,
  name: z.string().min(1),
  operator: z.string().min(1),
  summary: z.string().min(1),
  officialUrl: z.url(),
  docsUrl: z.url(),
  domains: z.array(z.string().min(1)).min(1),
  data: z.array(z.object({ name: z.string().min(1), fields: z.array(z.string().min(1)).min(1) })).min(1),
  delivery: z.array(z.enum(["open-api", "file", "standard-data", "linked-data", "web", "sdk"])).min(1),
  formats: z.array(z.string().min(1)).min(1),
  auth: z.enum(["none", "api-key", "oauth", "mixed"]),
  cost: z.enum(["free", "freemium", "paid", "mixed"]),
  cors: z.enum(["browser", "server-only", "mixed", "unknown"]),
  updateFrequency: z.string().min(1),
  realtime: z.enum(["realtime", "minutes", "hourly", "daily", "periodic", "static"]),
  geography: z.array(z.enum(["nationwide", "seoul", "regional", "global"])).min(1),
  termsUrl: z.url(),
  technologyIds: z.array(id),
  home: z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    lines: z.array(z.string().min(1)).min(1),
  }),
  previewAdapterId: previewAdapterIdSchema.optional(),
  skillIds: z.array(id),
  blueprintIds: z.array(id),
  keywords: z.array(z.string().min(1)),
  lastVerifiedAt: isoDate,
});

export const skillSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  upstreamPath: z.string().min(1),
  upstreamUrl: z.url(),
  sourceIds: z.array(id),
  runtimes: z.array(z.string().min(1)),
  auth: z.array(z.string().min(1)),
  technologyIds: z.array(id),
});

export const blueprintSchema = z.object({
  id,
  name: z.string().min(1),
  problem: z.string().min(1),
  users: z.array(z.string().min(1)).min(1),
  inputs: z.array(z.string().min(1)).min(1),
  outputs: z.array(z.string().min(1)).min(1),
  sourceIds: z.array(id).min(1),
  flow: z.array(z.string().min(1)).min(1),
  stack: z.array(z.string().min(1)).min(1),
  mvpSteps: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)).min(1),
  privacy: z.array(z.string().min(1)).min(1),
  fallback: z.array(z.string().min(1)).min(1),
  examples: z.object({ node: z.string().min(1), python: z.string().min(1) }),
});

export const technologySchema = z.object({
  id,
  name: z.string().min(1),
  category: z.string().min(1),
  summary: z.string().min(1),
});

export const catalogSchema = z.object({
  sources: z.array(sourceSchema),
  skills: z.array(skillSchema),
  blueprints: z.array(blueprintSchema),
  technologies: z.array(technologySchema),
});

export type Source = z.infer<typeof sourceSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Blueprint = z.infer<typeof blueprintSchema>;
export type Technology = z.infer<typeof technologySchema>;
export type Catalog = z.infer<typeof catalogSchema>;

/** k-skill 원본에 없는 연결 정보(정보원·기술)를 손으로 보정한다. 동기화 결과 위에 얹는다. */
export type SkillOverrides = Record<string, Partial<Omit<Skill, "id" | "name" | "upstreamPath" | "upstreamUrl">>>;

type ValidationOptions = { today?: string; maxAgeDays?: number };
type ValidationResult = { success: true; data: Catalog; errors: [] } | { success: false; errors: string[] };

export function validateCatalog(input: unknown, options: ValidationOptions = {}): ValidationResult {
  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success) return { success: false, errors: parsed.error.issues.map((issue) => issue.message) };

  const catalog = parsed.data;
  const errors: string[] = [];
  const collections = [
    ["source", catalog.sources],
    ["skill", catalog.skills],
    ["blueprint", catalog.blueprints],
    ["technology", catalog.technologies],
  ] as const;

  for (const [label, records] of collections) {
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) errors.push(`Duplicate ${label} id: ${record.id}`);
      seen.add(record.id);
    }
  }

  const sourceIds = new Set(catalog.sources.map(({ id: sourceId }) => sourceId));
  const skillIds = new Set(catalog.skills.map(({ id: skillId }) => skillId));
  const blueprintIds = new Set(catalog.blueprints.map(({ id: blueprintId }) => blueprintId));
  const technologyIds = new Set(catalog.technologies.map(({ id: technologyId }) => technologyId));

  const check = (ids: string[], known: Set<string>, relationship: string) => {
    for (const relatedId of ids) if (!known.has(relatedId)) errors.push(`Missing ${relationship}: ${relatedId}`);
  };

  for (const source of catalog.sources) {
    check(source.skillIds, skillIds, "skill");
    check(source.blueprintIds, blueprintIds, "blueprint");
    check(source.technologyIds, technologyIds, "technology");
  }
  for (const skill of catalog.skills) {
    check(skill.sourceIds, sourceIds, "source");
    check(skill.technologyIds, technologyIds, "technology");
  }
  for (const blueprintItem of catalog.blueprints) check(blueprintItem.sourceIds, sourceIds, "source");

  if (options.today && options.maxAgeDays !== undefined) {
    const now = Date.parse(`${options.today}T00:00:00Z`);
    const maxAgeMs = options.maxAgeDays * 86_400_000;
    for (const source of catalog.sources) {
      if (now - Date.parse(`${source.lastVerifiedAt}T00:00:00Z`) > maxAgeMs) {
        errors.push(`Stale verification date for source ${source.id}: ${source.lastVerifiedAt}`);
      }
    }
  }

  return errors.length > 0 ? { success: false, errors } : { success: true, data: catalog, errors: [] };
}
