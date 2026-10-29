import fs from "node:fs/promises";
import path from "node:path";
import { readProfileFile, profileFile } from "../profile-document.js";
import { upsertMarkerBlock } from "../install/merge.js";
import { DEFINITION_FILE, parseDefinition } from "./definition.js";
import type { DoctorContext } from "../doctor/doctor.js";
export async function projectComponents(ctx: Pick<DoctorContext, "templateRoot" | "repoRoot" | "claudeHome" | "codexHome">) {
  const root = ctx.templateRoot ?? ctx.repoRoot;
  const definition = parseDefinition(root ? await readProfileFile(root, DEFINITION_FILE) : null);
  const results = [];
  for (const component of definition.components) {
    const files = [];
    for (const target of component.targets) for (const [relative, text] of Object.entries(component.files)) {
      const home = target === "claude" ? ctx.claudeHome : ctx.codexHome;
      const file = await profileFile(home, component.kind === "skill" ? `skills/${component.id}/${relative}` : target === "claude" ? "CLAUDE.md" : "AGENTS.md");
      const before = await fs.readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
      const after = component.kind === "instruction" ? upsertMarkerBlock(before ?? "", text, { start: `<!-- >>> harness-manager:${component.id} >>> -->`, end: `<!-- <<< harness-manager:${component.id} <<< -->` }) : text;
      files.push({ path: file, before, after });
    }
    results.push({ component, files });
  }
  return results;
}
