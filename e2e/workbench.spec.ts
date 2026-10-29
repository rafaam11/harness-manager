import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("profile → shared skill → both providers → automatic update → history → restore", async ({}, info) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-v4-e2e-"));
  const entry = path.join(root, "main.cjs");
  // The agent running this test is itself Codex. Isolate OS process discovery, while production
  // IPC, profile persistence, filesystem writes and renderer behavior all run unchanged.
  await fs.writeFile(entry, `const {BrowserWindow,app}=require('electron'); const cp=require('child_process'),util=require('util'),original=cp.execFile,originalAsync=util.promisify(original); const patched=(...args)=>original(...args); patched[util.promisify.custom]=async(...args)=>{if(args[0]==='tasklist')return {stdout:'',stderr:''};if(args[0]==='pgrep'){const e=new Error('none');e.code=1;throw e;}return originalAsync(...args);};cp.execFile=patched;app.getVersion=()=>${JSON.stringify(JSON.parse(await fs.readFile("package.json", "utf8")).version)}; BrowserWindow.prototype.show=function(){}; BrowserWindow.prototype.showInactive=function(){}; require(${JSON.stringify(path.resolve("out/main/index.js"))});`);
  const app = await electron.launch({ args: [entry, "--no-sandbox"], env: { ...process.env, HM_HOME: root, HM_CLAUDE_HOME: path.join(root, ".claude"), HM_CODEX_HOME: path.join(root, ".codex"), CODEX_HOME: path.join(root, ".codex"), CLAUDE_CONFIG_DIR: path.join(root, ".claude"), HARNESS_MANAGER_USER_DATA: path.join(root, "electron-data") } });
  try {
    const page = await app.firstWindow();
    const invoke = async (channel: string, ...args: unknown[]) => page.evaluate(async ({ channel, args }) => {
      const response = await (window as any).hm.invoke(channel, ...args);
      if (!response.ok) throw new Error(response.error); return response.data;
    }, { channel, args });
    await expect(page.getByRole("heading", { name: "구성요소", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "프로필", exact: true }).click();
    await page.getByRole("textbox", { name: "새 프로필 이름" }).fill("E2E profile");
    await page.getByRole("button", { name: "현재 프로필 복사", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "현재 프로필", exact: true })).toContainText("E2E profile");
    await page.getByRole("button", { name: "v4 전환·정책 검토", exact: true }).click();
    await page.getByRole("dialog", { name: "변경 미리보기" }).getByRole("button", { name: "검토한 변경 적용" }).click();
    await expect(page.getByRole("button", { name: "자동 적용 끄기", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "구성요소", exact: true }).click();
    await page.getByRole("button", { name: "새 스킬", exact: true }).click();
    await page.getByRole("textbox", { name: "ID", exact: true }).fill("e2e-review");
    await page.getByRole("textbox", { name: "이름", exact: true }).fill("E2E 스킬");
    const original = "---\nname: e2e-review\ndescription: Review changes.\n---\nReview the changes carefully.\n";
    await page.getByRole("textbox", { name: "본문", exact: true }).fill(original);
    await page.getByRole("button", { name: "프로필 저장 미리보기" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "검토한 변경 적용" }).click();
    await page.locator(".wb-row-button").filter({ hasText: "E2E 스킬" }).click();
    await expect(page.getByRole("heading", { name: "E2E 스킬", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "적용 미리보기", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("SKILL.md");
    await page.getByRole("dialog").getByRole("button", { name: "검토한 변경 적용" }).click();
    const target = path.join(root, ".codex/skills/e2e-review/SKILL.md");
    await expect.poll(() => fs.readFile(target, "utf8").catch(() => null)).toBe(original);
    expect(await fs.readFile(path.join(root, ".claude/skills/e2e-review/SKILL.md"), "utf8")).toBe(original);
    await expect(page.getByRole("button", { name: "적용 미리보기", exact: true })).toBeEnabled();
    await expect(page.getByText("설치됨", { exact: true })).toHaveCount(2);
    await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath("workbench.png"), fullPage: true });
    await page.getByRole("button", { name: "내용·적용 대상 편집" }).click();
    const updated = original + "Check tests too.\n";
    await page.getByRole("textbox", { name: "본문", exact: true }).fill(updated);
    await page.getByRole("button", { name: "프로필 저장 미리보기" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "검토한 변경 적용" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await invoke("workbench:check");
    expect(await fs.readFile(target, "utf8")).toBe(updated);
    await page.getByRole("button", { name: "변경 내역", exact: true }).click();
    const record = page.locator("section.panel").filter({ hasText: "1개 구성요소 적용" }).filter({ hasText: "자동 적용" }).first();
    await record.getByRole("button", { name: "복원 미리보기" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "검토한 변경 적용" }).click();
    await expect.poll(() => fs.readFile(target, "utf8").catch(() => null)).toBe(original);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await invoke("workbench:check"); expect(await fs.readFile(target, "utf8")).toBe(original);
    expect((await invoke("workbench:automation")).detail).toContain("복원 후");
  } catch (error) {
    const page = app.windows()[0]; if (page) await info.attach("app-state", { body: await page.locator("body").innerText().catch(() => "window closed"), contentType: "text/plain" });
    throw error;
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); }).catch(() => undefined);
    await app.close();
    if (!root.startsWith(path.join(os.tmpdir(), "hm-v4-e2e-"))) throw new Error("Unexpected test directory");
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
