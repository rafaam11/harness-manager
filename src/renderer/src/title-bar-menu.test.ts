import { describe, expect, it } from "vitest";
import { buildTitleBarMenus } from "./title-bar-menu";

function items(theme: "dark" | "light", appVersion = "3.0.0") {
  return buildTitleBarMenus({ appVersion, theme }).flatMap((menu) =>
    menu.entries.filter((entry) => entry.kind === "item"),
  );
}

describe("title bar menus", () => {
  it("offers the opposite theme in the 보기 menu", () => {
    expect(items("dark").find((entry) => entry.id === "view.toggle-theme")).toMatchObject({ label: "라이트 테마로" });
    expect(items("light").find((entry) => entry.id === "view.toggle-theme")).toMatchObject({ label: "다크 테마로" });
  });

  it("shows the version as a disabled, informational entry", () => {
    expect(items("dark").find((entry) => entry.id === "help.version")).toMatchObject({
      label: "버전 v3.0.0",
      disabled: true,
    });
  });

  it("keeps every actionable entry id unique", () => {
    const ids = items("dark").map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
