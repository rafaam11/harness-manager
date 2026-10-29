import { afterEach, it, expect, vi } from "vitest";
import { fetchSkill, discoverSkills } from "./github.js";
afterEach(() => vi.unstubAllGlobals());
const sha = "a".repeat(40);
it("pins discovery and download to one commit and never downloads another HEAD", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(url.includes("commits/HEAD") ? { sha } : url.includes("git/trees/") ? { truncated: false, tree: [{ path: "skills/review/SKILL.md", mode: "100644", type: "blob", sha: "b".repeat(40), size: 10 }] } : { encoding: "base64", content: Buffer.from("Review changes").toString("base64") }));
  }));
  const discovered = await discoverSkills("test/repo"); expect(discovered.directories).toEqual(["skills/review"]);
  const item = await fetchSkill("test/repo", "skills/review", discovered.revision);
  expect(item.source.revision).toBe(sha); expect(item.files["SKILL.md"]).toBe("Review changes");
  expect(urls.filter(url => url.includes("commits/HEAD"))).toHaveLength(1);
});
it("rejects links, executable permissions and truncated trees", async () => {
  for (const mode of ["120000", "100755", "160000"]) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ truncated: false, tree: [{ path: "SKILL.md", mode, type: "blob", sha, size: 10 }] }))));
    await expect(fetchSkill("test/repo", "", sha)).rejects.toMatchObject({ statusCode: 422 });
  }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ truncated: true, tree: [] }))));
  await expect(fetchSkill("test/repo", "", sha)).rejects.toThrow();
});
it("rejects malformed repository names and reports rate limiting without treating it as no updates", async () => {
  await expect(discoverSkills("../test/repo")).rejects.toMatchObject({ statusCode: 422 });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 403 })));
  await expect(discoverSkills("test/repo")).rejects.toThrow("403");
});
