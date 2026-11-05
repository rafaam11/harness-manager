import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeElectronFixture } from "./cli-fixture";

test("CLI identity → disabled filter → project scope → reviewed text example", async ({}, info) => {
  test.setTimeout(150000);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hm-recognition-e2e-"));
  const entry = path.join(root, "main.cjs"), project = path.join(root, "project");
  const skill = "---\nname: same\ndescription: Text summary\n---\nSummarize input.";
  for (const relative of [".codex/skills/same/SKILL.md", ".claude/skills/same/SKILL.md", ".codex/fixture-plugin/SKILL.md", "project/.agents/skills/project-only/SKILL.md"]) {
    const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, relative.startsWith("project/") ? skill.replace("name: same", "name: project-only") : skill);
  }
  await writeElectronFixture(entry);
  const app = await electron.launch({ args: [entry, "--no-sandbox"], env: { ...process.env, GH_HOST: "127.0.0.1:1", GH_TOKEN: "hm-e2e-fixture", GH_CONFIG_DIR: path.join(root, "gh"), GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"), HM_HOME: root, HM_CLAUDE_HOME: path.join(root, ".claude"), HM_CODEX_HOME: path.join(root, ".codex"), CODEX_HOME: path.join(root, ".codex"), CLAUDE_CONFIG_DIR: path.join(root, ".claude"), HARNESS_MANAGER_USER_DATA: path.join(root, "electron-data") } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("tab", { name: "Codex", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "다시 확인", exact: true })).toBeEnabled();
    await page.getByRole("textbox", { name: "구성요소 검색" }).fill("same");
    await expect(page.locator(".pc-row")).toHaveCount(2);
    await page.getByLabel("구성요소 필터", { exact: true }).selectOption("disabled");
    await expect(page.locator(".pc-row")).toHaveCount(1);
    await page.getByRole("button", { name: "same", exact: true }).click();
    const detail = page.getByRole("complementary", { name: "선택한 항목" });
    await expect(detail).toContainText("공유 기준에 포함되지 않음");
    await expect(detail.getByRole("button", { name: "공유 기준에 추가" })).toHaveCount(0);
    await detail.getByRole("tab", { name: "진단", exact: true }).click();
    await expect(detail).toContainText("fixture@market");
    await expect(detail).toContainText(path.join(root, ".codex", "fixture-plugin", "SKILL.md"));
    await detail.getByRole("button", { name: "상세 닫기" }).click();
    for (const size of [[1280, 800], [900, 600]]) {
      await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0]!.setSize(width!, height!), size);
      await expect.poll(() => page.evaluate(() => { const main = document.querySelector("main")!; const rows = document.querySelector(".pc-rows")!; return main.scrollWidth <= main.clientWidth + 1 && main.scrollHeight <= main.clientHeight + 1 && rows.scrollHeight <= rows.clientHeight + 1; })).toBe(true);
      await page.screenshot({ path: info.outputPath(`recognition-${size[0]}.png`), fullPage: true });
    }
    const codex = page.getByRole("tab", { name: "Codex", exact: true }); await codex.focus(); await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Claude Code", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "다시 확인", exact: true })).toBeEnabled();
    await page.getByRole("tab", { name: "Codex", exact: true }).click();
    await expect(page.getByRole("button", { name: "다시 확인", exact: true })).toBeEnabled();
    await page.getByLabel("구성요소 필터", { exact: true }).selectOption("all");
    await page.getByRole("textbox", { name: "구성요소 검색" }).fill("");
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.getByRole("button", { name: "프로젝트 선택" }).click();
    await page.getByRole("textbox", { name: "구성요소 검색" }).fill("project-only");
    await expect(page.getByRole("button", { name: "project-only", exact: true })).toBeVisible();
    expect(await fs.readFile(path.join(project, ".agents/skills/project-only/SKILL.md"), "utf8")).toBe(skill.replace("name: same", "name: project-only"));
    await page.getByRole("button", { name: "전역으로" }).click();
    await expect(page.getByRole("button", { name: "project-only", exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Claude Code", exact: true }).click();
    await expect(page.getByRole("button", { name: "다시 확인", exact: true })).toBeEnabled();
    await page.getByRole("textbox", { name: "구성요소 검색" }).fill("same");
    await page.getByRole("button", { name: "same", exact: true }).click();
    await detail.getByRole("tab", { name: "진단", exact: true }).click();
    await detail.getByRole("button", { name: "예제 준비" }).click();
    await detail.getByRole("textbox", { name: "예제 생성 모델" }).fill("fixture-model");
    await detail.getByRole("textbox", { name: "예제 실행 모델" }).fill("fixture-model");
    await detail.getByRole("button", { name: "모델로 예제 생성" }).click();
    await expect(detail.getByRole("heading", { name: "생성된 예제 검토" })).toBeVisible();
    await detail.getByRole("button", { name: "검토한 예제 실행" }).click();
    await expect(detail).toContainText("이 예제의 텍스트 산출물 검증 통과");
    await expect(detail).toContainText("실제 스킬 호출은 미검증");
    await page.screenshot({ path: info.outputPath("example-reviewed-900.png"), fullPage: true });
  } catch (error) {
    const page = app.windows()[0]; if (page) await info.attach("app-state", { body: await page.locator("body").innerText().catch(() => "closed"), contentType: "text/plain" }); throw error;
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); }).catch(() => undefined); await app.close();
    if (!path.resolve(root).startsWith(path.join(os.tmpdir(), "hm-recognition-e2e-"))) throw new Error("Unexpected directory");
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
