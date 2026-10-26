import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSettingsArgs } from "../cli-settings.js";
import { DEFAULT_SETTINGS, readAppSettings, updateAppSettings } from "./settings.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-settings-"));
  file = path.join(dir, "settings.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("앱 설정", () => {
  it("없거나 깨졌거나 값이 이상하면 기본값으로 읽는다", async () => {
    expect(await readAppSettings(file)).toEqual(DEFAULT_SETTINGS);
    fs.writeFileSync(file, "{ not json");
    expect(await readAppSettings(file)).toEqual(DEFAULT_SETTINGS);
    fs.writeFileSync(file, JSON.stringify({ profile: "huge", selfMarketplaceSource: "ftp" }));
    expect(await readAppSettings(file)).toEqual(DEFAULT_SETTINGS);
  });

  it("바꾼 키만 쓰고 모르는 키는 남긴다", async () => {
    fs.writeFileSync(file, JSON.stringify({ profile: "core", futureKey: 1 }));
    expect(await updateAppSettings(file, { selfMarketplaceSource: "github" })).toEqual({ profile: "core", selfMarketplaceSource: "github" });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ profile: "core", futureKey: 1, selfMarketplaceSource: "github" });
  });

  it("CLI 인자: 프로필·소스 값을 검사한다", () => {
    expect(parseSettingsArgs(["settings", "--profile", "dev", "--json"])).toEqual({ patch: { profile: "dev" }, json: true });
    expect(() => parseSettingsArgs(["settings", "--profile", "max"])).toThrow();
    expect(() => parseSettingsArgs(["settings", "--self-source", "ftp"])).toThrow();
  });
});
