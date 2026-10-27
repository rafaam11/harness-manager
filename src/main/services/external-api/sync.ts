import matter from "gray-matter";
import type { Skill, SkillOverrides } from "@shared/external-api/schema";

// jk-external-api(packages/catalog/src/sync)에서 옮겨 왔다(M12). k-skill 저장소의 SKILL.md를 GitHub 익명 API로 받는다.
// 네트워크는 main에서만 쓴다 — 렌더러는 "스냅샷 새로고침" 채널만 부른다.

const REPOSITORY = "NomaDamas/k-skill";
const BRANCH = "main";


type TreeResponse = {
  truncated?: boolean;
  tree?: Array<{ path?: string; type?: string }>;
  message?: string;
};

export class GitHubRateLimitError extends Error {
  constructor() {
    super("GitHub API rate limit exhausted; snapshot was not changed.");
    this.name = "GitHubRateLimitError";
  }
}

function readFrontmatter(document: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(document);
  if (!match?.[1]) throw new Error("Invalid SKILL.md frontmatter: opening and closing delimiters are required.");
  try {
    // yaml 의존성을 따로 두지 않고 이미 쓰는 gray-matter로 frontmatter만 읽는다.
    const parsed: unknown = matter(`---\n${match[1]}\n---\n`).data;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("frontmatter must be a mapping");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid SKILL.md frontmatter: ${error instanceof Error ? error.message : "parse failure"}`);
  }
}

export function parseSkillDocument(path: string, document: string): Skill {
  const frontmatter = readFrontmatter(document);
  const metadata = frontmatter.metadata && typeof frontmatter.metadata === "object" && !Array.isArray(frontmatter.metadata)
    ? frontmatter.metadata as Record<string, unknown>
    : {};
  const frontmatterName = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
  const directoryName = path.includes("/") ? (path.split("/").at(-2) ?? "") : frontmatterName;
  const directoryId = path.startsWith("legacy/") ? `legacy-${directoryName}` : directoryName;
  const name = frontmatterName || directoryId;
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  if (!name || !description) throw new Error(`Invalid SKILL.md frontmatter in ${path}: name and description are required.`);

  const secrets = [...document.matchAll(/\b[A-Z][A-Z0-9_]{2,}(?:_KEY|_TOKEN|_SECRET|_CLIENT_ID|_BASE_URL)\b/g)]
    .map(([secret]) => secret)
    .filter((secret): secret is string => Boolean(secret));
  const runtimes = [
    ...(document.match(/\b(?:node|npm|pnpm|npx|typescript|javascript)\b/i) ? ["Node.js"] : []),
    ...(document.match(/\bpython\b|\.py\b/i) ? ["Python"] : []),
    ...(document.match(/\bcurl\b/i) ? ["Shell"] : []),
  ];

  return {
    id: directoryId,
    name,
    description,
    category: typeof metadata.category === "string" ? metadata.category : "other",
    upstreamPath: path,
    upstreamUrl: `https://github.com/${REPOSITORY}/blob/${BRANCH}/${path}`,
    sourceIds: [],
    runtimes: runtimes.length > 0 ? [...new Set(runtimes)] : ["Agent skill"],
    auth: [...new Set(secrets)].sort(),
    technologyIds: [],
  };
}

export function mergeSkills(upstream: Skill[], overrides: SkillOverrides): Skill[] {
  return upstream.map((skill) => ({ ...skill, ...(overrides[skill.id] ?? {}) })).sort((a, b) => a.id.localeCompare(b.id));
}

async function checkedFetch(fetcher: typeof fetch, url: string): Promise<Response> {
  const response = await fetcher(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "harness-manager-external-api" } });
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") throw new GitHubRateLimitError();
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}) for ${url}`);
  return response;
}

export async function syncSkills({ fetcher = fetch, overrides = {} }: { fetcher?: typeof fetch; overrides?: SkillOverrides } = {}): Promise<Skill[]> {
  const treeResponse = await checkedFetch(fetcher, `https://api.github.com/repos/${REPOSITORY}/git/trees/${BRANCH}?recursive=1`);
  const tree = await treeResponse.json() as TreeResponse;
  if (tree.truncated) throw new Error("GitHub tree response was truncated; snapshot was not changed.");
  const paths = (tree.tree ?? []).filter(({ path, type }) =>
    type === "blob"
    && (path === "SKILL.md" || path?.endsWith("/SKILL.md"))
    && !path.includes("/test/fixtures/"),
  ).map(({ path }) => path as string);
  if (paths.length === 0) throw new Error("No SKILL.md entries found in the upstream tree.");

  const skills: Skill[] = [];
  for (let offset = 0; offset < paths.length; offset += 12) {
    const batch = paths.slice(offset, offset + 12);
    const parsed = await Promise.all(batch.map(async (path) => {
      const response = await checkedFetch(fetcher, `https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}/${path}`);
      return parseSkillDocument(path, await response.text());
    }));
    skills.push(...parsed);
  }
  return mergeSkills(skills, overrides);
}
