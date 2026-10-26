import { PROFILES, type AppSettings, type Profile } from "@shared/manifest-types";
import { APP_SETTINGS_FILE } from "./config.js";
import { readAppSettings, updateAppSettings } from "./services/settings.js";

export const SETTINGS_USAGE = `  hm settings [--profile core|dev|full] [--self-source directory|github] [--json]
                                    이 PC 설정을 보이거나 바꾼다(doctor·install의 기본 프로필·마켓플레이스 소스)`;

class SettingsUsageError extends Error {}

export function parseSettingsArgs(argv: string[]): { patch: Partial<AppSettings>; json: boolean } {
  const [command, ...rest] = argv;
  if (command !== "settings") throw new SettingsUsageError("알 수 없는 명령입니다.");
  const patch: Partial<AppSettings> = {};
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const value = rest[index + 1];
    if (arg === "--json") json = true;
    else if (arg === "--profile") {
      if (!PROFILES.includes(value as Profile)) throw new SettingsUsageError("--profile은 core, dev, full 중 하나입니다.");
      patch.profile = value as Profile;
      index += 1;
    } else if (arg === "--self-source") {
      if (value !== "directory" && value !== "github") throw new SettingsUsageError("--self-source는 directory나 github입니다.");
      patch.selfMarketplaceSource = value;
      index += 1;
    } else throw new SettingsUsageError(`알 수 없는 옵션: ${arg}`);
  }
  return { patch, json };
}

export async function runSettingsCli(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseSettingsArgs>;
  try {
    parsed = parseSettingsArgs(argv);
  } catch (error) {
    if (!(error instanceof SettingsUsageError)) throw error;
    process.stderr.write(`${error.message}\n\n사용법:\n${SETTINGS_USAGE}\n`);
    return 2;
  }
  const settings = Object.keys(parsed.patch).length > 0
    ? await updateAppSettings(APP_SETTINGS_FILE, parsed.patch)
    : await readAppSettings(APP_SETTINGS_FILE);
  process.stdout.write(
    parsed.json ? `${JSON.stringify(settings)}\n` : `프로필 ${settings.profile} · jinmin 마켓플레이스 소스 ${settings.selfMarketplaceSource}\n`,
  );
  return 0;
}
