import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createInstallJournal } from "./journal.js";

it("keeps JSONL valid while masking environment secrets, bearer tokens and named credentials", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hm-journal-"));
  try {
    const journal = await createInstallJournal(directory, { API_KEY: 'secret"with\\quotes' });
    journal.record({ type: "log", id: "test", stream: "stderr", line: 'secret"with\\quotes Bearer abc123 token=another-secret' });
    await journal.close();
    const text = await fs.readFile(journal.filePath, "utf8");
    expect(JSON.parse(text).event.line).toBe("*** Bearer *** token=***");
    expect(text).not.toContain("another-secret");
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
