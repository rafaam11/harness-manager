import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("first edit → one review → both CLIs → conflict → compact layout → restore", async ({}, info) => {
  // Windows CI에서는 실제 파일 트랜잭션과 OS 진단을 함께 돌려 90초를 넘는다.
  // 개별 동작·기대 조건의 제한은 유지하고 전체 흐름에만 여유를 준다.
  test.setTimeout(150_000);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-v4-e2e-"));
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
    const fits = async () => page.evaluate(() => {
      const main = document.querySelector("main")!;
      const rows = document.querySelector(".pc-rows")!;
      return { main: main.scrollHeight <= main.clientHeight + 1 && main.scrollWidth <= main.clientWidth + 1, rows: rows.scrollHeight <= rows.clientHeight + 1 };
    });
    await expect.poll(fits).toEqual({ main: true, rows: true });
    await page.getByRole("button", { name: "추가", exact: true }).click();
    await page.getByRole("button", { name: "새 스킬", exact: true }).click();
    await page.getByRole("textbox", { name: "폴더 이름", exact: true }).fill("e2e-review");
    await page.getByRole("textbox", { name: "이름", exact: true }).fill("E2E 스킬");
    const original = "---\nname: e2e-review\ndescription: Review changes.\n---\nReview the changes carefully.\n";
    await page.getByRole("textbox", { name: "본문", exact: true }).fill(original);
    const detail = page.getByRole("complementary", { name: "선택한 항목" });
    await detail.getByRole("button", { name: "변경 검토", exact: true }).click();
    const review = page.getByRole("dialog", { name: "변경 검토" });
    await expect(review).toContainText("내 설정에 저장하고 이 PC에 함께 반영합니다.");
    await expect(review.locator("pre")).toHaveCount(0);
    expect((await invoke("profiles:list")).activeId).toBe("default");
    await review.getByRole("button", { name: "이 PC에 적용", exact: true }).click();
    await expect(review).toHaveCount(0);
    const target = path.join(root, ".codex/skills/e2e-review/SKILL.md");
    await expect.poll(() => fs.readFile(target, "utf8").catch(() => null)).toBe(original);
    expect(await fs.readFile(path.join(root, ".claude/skills/e2e-review/SKILL.md"), "utf8")).toBe(original);
    const activeId = (await invoke("profiles:list")).activeId;
    expect(activeId).not.toBe("default");
    await expect(detail.getByText("설정 일치", { exact: true })).toHaveCount(2);
    await expect.poll(fits).toEqual({ main: true, rows: true });
    await page.screenshot({ path: info.outputPath("this-pc-1280.png"), fullPage: true });
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setSize(900, 600); });
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "편집", exact: true }).click();
    const updated = original + "Check tests too.\n";
    await page.getByRole("textbox", { name: "본문", exact: true }).fill(updated);
    await expect.poll(fits).toEqual({ main: true, rows: true });
    await page.getByRole("button", { name: "동기화", exact: true }).click();
    const discard = page.getByRole("dialog", { name: "편집을 마칠까요?" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "본문", exact: true })).toHaveValue(updated);
    await detail.getByRole("button", { name: "변경 검토", exact: true }).click();
    // A concurrent user edit must block the entire transaction, including the saved baseline.
    await expect(review).toBeVisible();
    await fs.writeFile(target, "Concurrent user edit");
    await review.getByRole("button", { name: "이 PC에 적용", exact: true }).click();
    await expect(review).toHaveCount(0);
    expect((await invoke("workbench:definition", "e2e-review")).files["SKILL.md"]).toBe(original);
    expect(await fs.readFile(target, "utf8")).toBe("Concurrent user edit");
    await fs.writeFile(target, original);
    await detail.getByRole("button", { name: "변경 검토", exact: true }).click();
    await review.getByRole("button", { name: "이 PC에 적용", exact: true }).click();
    await expect(review).toHaveCount(0);
    expect(await fs.readFile(target, "utf8")).toBe(updated);
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setSize(900, 600); win.webContents.setZoomFactor(1.25); });
    await expect.poll(fits).toEqual({ main: true, rows: true });
    await expect.poll(() => detail.getByRole("button", { name: "변경 검토" }).evaluate(button => { const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; })).toBe(true);
    await page.screenshot({ path: info.outputPath("this-pc-900-125.png"), fullPage: true });
    await page.getByRole("button", { name: "변경 기록", exact: true }).click();
    await expect(page.getByRole("heading", { name: "변경 기록", exact: true })).toBeVisible();
    await page.locator(".pc-name").filter({ hasText: "E2E 스킬 변경" }).first().click();
    await page.getByRole("button", { name: "복원 검토", exact: true }).click();
    await review.getByRole("button", { name: "검토한 변경 복원", exact: true }).click();
    await expect(review).toHaveCount(0);
    expect(await fs.readFile(target, "utf8")).toBe(original);
    expect((await invoke("workbench:definition", "e2e-review")).files["SKILL.md"]).toBe(original);
    await invoke("workbench:check");
    expect((await invoke("workbench:automation")).detail).toContain("복원 후");
    await page.getByRole("button", { name: "동기화", exact: true }).click();
    await expect(page.getByRole("heading", { name: "동기화", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "내 설정 보내기", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "다른 PC의 변경 받기", exact: true })).toBeInViewport();
    expect((await invoke("profiles:list")).activeId).toBe(activeId);
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.webContents.setZoomFactor(1); win.setSize(1280, 800); });
    await page.getByRole("button", { name: "앱 설정", exact: true }).click();
    await page.getByRole("tab", { name: "고급", exact: true }).click();
    await page.getByRole("button", { name: "고급 프로필 관리", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "사용할 프로필", exact: true })).toHaveValue(activeId);
    await page.getByRole("button", { name: "이 PC", exact: true }).click();
    // Enough real entries to require pagination at the minimum size.
    for (let index = 0; index < 12; index++) {
      const preview = await invoke("changes:prepare", { id: `page-${index}`, name: `페이지 스킬 ${index}`, description: "pagination fixture", kind: "skill", source: { kind: "profile" }, targets: ["claude", "codex"], files: { "SKILL.md": `Skill ${index}` } });
      await invoke("workbench:apply", preview.token);
    }
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 600));
    await expect.poll(fits).toEqual({ main: true, rows: true });
    await expect(page.getByRole("button", { name: "다음 페이지", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
    await expect(page.locator(".pc-pager")).toContainText("2 /");
    await page.getByRole("textbox", { name: "구성요소 검색" }).fill("페이지 스킬 11");
    await expect(page.locator(".pc-row")).toHaveCount(1);
    await expect(page.locator(".pc-name")).toHaveText("페이지 스킬 11");
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    await page.getByRole("button", { name: "환경 진단", exact: true }).click();
    const diagnostics = page.getByRole("dialog", { name: "환경 진단" });
    await expect(diagnostics).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(diagnostics).toHaveCount(0);

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
