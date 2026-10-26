import type { ExposureFlag } from "@shared/manifest-types";

/**
 * 공개 레포로 나가는 텍스트에서 개인 정보를 찾는다(스펙 Q10). capture는 개인 값을 먼저 로컬로 돌리고,
 * 그래도 남은 것을 이 검사로 잡아 적용을 막는다 — 두 겹이다.
 */
export interface ExposureRules {
  /** 사용자 홈의 절대경로. 슬래시 방향·JSON 이스케이프와 상관없이 잡는다. */
  home: string;
  /** 회사명 등 공개하면 안 되는 낱말. `~/.harness-manager/profile/private-terms.json`에서 온다. */
  privateTerms: readonly string[];
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
// URL의 `https://`는 드라이브 문자가 아니다. 한 글자 + `:` + 구분자만 절대경로로 본다.
const WINDOWS_ABSOLUTE = /(^|[^\w/])[a-z]:(\\\\|\\|\/)/i;

function homeVariants(home: string): string[] {
  const forward = home.replace(/\\/g, "/");
  const back = home.replace(/\//g, "\\");
  return [forward, back, back.replace(/\\/g, "\\\\")].map((variant) => variant.toLowerCase());
}

function containsTerm(text: string, terms: readonly string[]): string | null {
  const lower = text.toLowerCase();
  return terms.find((term) => term && lower.includes(term.toLowerCase())) ?? null;
}

/** 값 하나가 개인적인지(레포 대신 로컬로 보내야 하는지). */
export function isPersonalValue(value: string, rules: ExposureRules): boolean {
  const lower = value.toLowerCase();
  if (homeVariants(rules.home).some((variant) => lower.includes(variant))) return true;
  if (WINDOWS_ABSOLUTE.test(value) || EMAIL.test(value)) return true;
  return containsTerm(value, rules.privateTerms) !== null;
}

export function scanExposure(text: string, rules: ExposureRules): ExposureFlag[] {
  const flags: ExposureFlag[] = [];
  const variants = homeVariants(rules.home);
  text.split(/\r?\n/).forEach((line, index) => {
    const lower = line.toLowerCase();
    const at = { line: index + 1, text: line.trim() };
    if (variants.some((variant) => lower.includes(variant))) flags.push({ kind: "home-path", ...at });
    else if (WINDOWS_ABSOLUTE.test(line)) flags.push({ kind: "absolute-path", ...at });
    if (EMAIL.test(line)) flags.push({ kind: "email", ...at });
    if (containsTerm(line, rules.privateTerms)) flags.push({ kind: "private-term", ...at });
  });
  return flags;
}

/** 홈 아래 경로를 `~/…`로 바꾼다. 홈 밖이면 그대로 돌려준다. */
export function tildify(value: string, home: string): string {
  const normalizedHome = home.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalized = value.replace(/\\/g, "/");
  if (normalized.toLowerCase() === normalizedHome.toLowerCase()) return "~";
  if (normalized.toLowerCase().startsWith(`${normalizedHome.toLowerCase()}/`)) {
    return `~${normalized.slice(normalizedHome.length)}`;
  }
  return value;
}
