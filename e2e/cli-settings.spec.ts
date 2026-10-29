import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("provider settings → structured editor → mod options → compact layout → restore", async ({}, info) => {
  // Windows CI에서는 실제 파일 트랜잭션과 OS 진단을 함께 돌려 90초를 넘는다.
  // 개별 동작·기대 조건의 제한은 유지하고 전체 흐름에만 여유를 준다.
  test.setTimeout(150_000);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-v5-e2e-"));
  const entry = path.join(root, "main.cjs");
  // The agent running this test is itself Codex. Isolate OS process discovery, while production
  // IPC, profile persistence, filesystem writes and renderer behavior all run unchanged.
  await fs.writeFile(entry, `const {BrowserWindow,app}=require('electron'); const cp=require('child_process'),util=require('util'),original=cp.execFile,originalAsync=util.promisify(original); const patched=(...args)=>original(...args); patched[util.promisify.custom]=async(...args)=>{if(args[0]==='tasklist')return {stdout:'',stderr:''};if(args[0]==='pgrep'){const e=new Error('none');e.code=1;throw e;}return originalAsync(...args);};cp.execFile=patched;app.getVersion=()=>${JSON.stringify(JSON.parse(await fs.readFile("package.json", "utf8")).version)}; BrowserWindow.prototype.show=function(){}; BrowserWindow.prototype.showInactive=function(){}; require(${JSON.stringify(path.resolve("out/main/index.js"))});`);
  const app = await electron.launch({ args: [entry, "--no-sandbox"], env: { ...process.env, GH_HOST: "127.0.0.1:1", GH_TOKEN: "hm-e2e-fixture", GH_ENTERPRISE_TOKEN: "hm-e2e-fixture", GH_CONFIG_DIR: path.join(root, "gh"), GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"), HM_HOME: root, HM_CLAUDE_HOME: path.join(root, ".claude"), HM_CODEX_HOME: path.join(root, ".codex"), CODEX_HOME: path.join(root, ".codex"), CLAUDE_CONFIG_DIR: path.join(root, ".claude"), HARNESS_MANAGER_USER_DATA: path.join(root, "electron-data") } });
  try {
    const page = await app.firstWindow();
    const invoke = async (channel: string, ...args: unknown[]) => page.evaluate(async ({ channel, args }) => {
      const response = await (window as any).hm.invoke(channel, ...args);
      if (!response.ok) throw new Error(response.error); return response.data;
    }, { channel, args });
    await expect(page.getByRole("heading", { name: "이 PC", exact: true })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 800));
    const review = page.getByRole("dialog", { name: "변경 검토" });
    const settings = page.getByRole("complementary", { name: "CLI 설정 상세" });
    const choose = async (query: string, key: string) => {
      await page.getByRole("textbox", { name: "CLI 설정 검색" }).fill(query);
      await page.locator(".pc-name").filter({ hasText: key }).first().click();
      await expect(settings).toBeVisible();
    };
    const apply = async () => {
      await expect(review).toBeVisible();
      await review.getByRole("button", { name: "이 PC에 적용", exact: true }).click();
      await expect(review).toHaveCount(0);
    };
    const fits = async () => page.evaluate(() => {
      const main = document.querySelector("main")!;
      const rect = main.getBoundingClientRect();
      return rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 && main.scrollHeight <= main.clientHeight + 1 && main.scrollWidth <= main.clientWidth + 1;
    });
    await page.getByRole("tab", { name: "Claude Code", exact: true }).click();
    await choose("language", "language");
    await settings.getByRole("textbox", { name: "설정값", exact: true }).fill("Korean");
    await page.getByRole("tab", { name: "Codex", exact: true }).click();
    const discard = page.getByRole("dialog", { name: "설정 편집을 마칠까요?" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "취소", exact: true }).click();
    await settings.getByRole("button", { name: "변경 검토", exact: true }).click();
    expect((await invoke("profiles:list")).activeId).toBe("default");
    await apply();
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(root, ".claude/settings.json"), "utf8")).language).toBe("Korean");
    expect((await invoke("profiles:list")).activeId).not.toBe("default");
    await settings.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("tab", { name: "Codex", exact: true }).click();
    await choose("model_reasoning_effort", "model_reasoning_effort");
    await settings.getByRole("textbox", { name: "설정값", exact: true }).fill("high");
    await settings.getByRole("button", { name: "변경 검토", exact: true }).click();
    await apply();
    const config = path.join(root, ".codex/config.toml");
    await expect.poll(() => fs.readFile(config, "utf8")).toContain('"high"');
    await settings.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("tab", { name: "Claude Code", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "CLI 설정 검색" })).toHaveValue("language");
    await page.getByRole("tab", { name: "확장", exact: true }).click();
    await page.getByRole("button", { name: "입력창 상황판", exact: true }).click();
    const extension = page.getByRole("complementary", { name: "확장 상세" });
    await extension.getByRole("spinbutton", { name: "밴드 최대 줄 수", exact: true }).fill("6");
    await extension.getByRole("button", { name: "옵션 변경 검토", exact: true }).click();
    await apply();
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(root, ".claude/settings.json"), "utf8")).pluginConfigs["jinmin-hud@jinmin"].options.maxRows).toBe(6);
    await page.screenshot({ path: info.outputPath("cli-mod-options-1280.png"), fullPage: true });
    await extension.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("tab", { name: "Codex", exact: true }).click();
    await expect(page.getByRole("button", { name: "Codex 상태·가드 확장", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "설정", exact: true }).click();
    await choose("notify", "notify");
    await settings.getByRole("button", { name: "항목 추가", exact: true }).click();
    await settings.getByRole("textbox", { name: "설정값.0", exact: true }).fill("fixture-notification");
    await settings.getByRole("button", { name: "변경 검토", exact: true }).click(); await apply();
    await expect.poll(() => fs.readFile(config, "utf8")).toContain("fixture-notification");
    for (const zoom of [1, 1.25]) {
      await app.evaluate(({ BrowserWindow }, zoom) => { const win = BrowserWindow.getAllWindows()[0]!; win.setSize(900, 600); win.webContents.setZoomFactor(zoom); }, zoom);
      await expect.poll(fits).toBe(true);
      await expect(settings.getByRole("button", { name: "변경 검토", exact: true })).toBeInViewport();
      await expect.poll(() => settings.getByRole("button", { name: "변경 검토", exact: true }).evaluate(button => { const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; })).toBe(true);
      await page.screenshot({ path: info.outputPath(`cli-settings-900-${zoom}.png`), fullPage: true });
    }
    await settings.getByRole("button", { name: "기본값 사용", exact: true }).click(); await apply();
    await expect.poll(() => fs.readFile(config, "utf8")).not.toContain("fixture-notification");
    await page.getByRole("button", { name: "변경 기록", exact: true }).click();
    await page.locator(".pc-name").filter({ hasText: "1개 CLI 설정 변경" }).first().click();
    await page.getByRole("button", { name: "복원 검토", exact: true }).click();
    await review.getByRole("button", { name: "검토한 변경 복원", exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect.poll(() => fs.readFile(config, "utf8")).toContain("fixture-notification");
  } catch (error) {
    const page = app.windows()[0]; if (page) await info.attach("app-state", { body: await page.locator("body").innerText().catch(() => "window closed"), contentType: "text/plain" });
    throw error;
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); }).catch(() => undefined);
    await app.close();
    if (!root.startsWith(path.join(os.tmpdir(), "hm-v5-e2e-"))) throw new Error("Unexpected test directory");
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
