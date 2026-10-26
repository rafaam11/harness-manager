import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve("src/renderer/src/index.css"), "utf8");

function ruleBody(selector: string): string {
  const normalizedTarget = selector.replace(/\s+/g, " ").trim();
  let matchedBody: string | null = null;
  for (const [, rawSelectors, body] of stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/gs)) {
    const selectors = rawSelectors
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((value) => value.replace(/\s+/g, " ").trim());
    if (selectors.includes(normalizedTarget)) matchedBody = body;
  }
  if (matchedBody !== null) return matchedBody;
  throw new Error(`Missing CSS rule: ${selector}`);
}

describe("typography contract", () => {
  it("defines the compact semantic type scale", () => {
    expect(ruleBody(":root")).toMatch(/--type-page-title:\s*600 16px\/22px/);
    expect(ruleBody(":root")).toMatch(/--type-panel-title:\s*600 14px\/20px/);
    expect(ruleBody(":root")).toMatch(/--type-ui:\s*400 13px\/18px/);
    expect(ruleBody(":root")).toMatch(/--type-secondary:\s*400 12px\/16px/);
    expect(ruleBody(":root")).toMatch(/--type-caption:\s*400 11px\/14px/);
  });

  it("uses 13px UI text by default and makes form controls inherit it", () => {
    expect(ruleBody("body")).toMatch(/font:\s*var\(--type-ui\)/);
    expect(ruleBody("button")).toMatch(/font:\s*inherit/);
  });

  it("keeps literal font sizes on the five-step scale and never below 11px", () => {
    const fontDeclarations = [...stylesheet.matchAll(/\bfont(?:-size)?\s*:\s*([^;}]*)/g)].map(
      ([, value]) => value,
    );
    const pixelSizes = fontDeclarations.flatMap((value) =>
      [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map(([, size]) => Number(size)),
    );

    expect(pixelSizes.every((size) => [11, 12, 13, 14, 16].includes(size))).toBe(true);
  });

  it("only uses the supported font weights", () => {
    const weights = [...stylesheet.matchAll(/font-weight:\s*(\d+)/g)].map(([, value]) =>
      Number(value),
    );
    expect(weights.every((weight) => [400, 600, 700].includes(weight))).toBe(true);
  });

  it("pins representative UI roles to their semantic sizes", () => {
    expect(ruleBody(".title-bar-menu-button")).toMatch(/font-size:\s*var\(--type-ui-size\)/);
    expect(ruleBody(".title-bar-title")).toMatch(/font:\s*var\(--type-secondary-semibold\)/);
    expect(ruleBody(".toast-title")).toMatch(/font:\s*var\(--type-ui-semibold\)/);
    expect(ruleBody(".confirm-dialog h2")).toMatch(/font:\s*var\(--type-panel-title\)/);
    expect(ruleBody(".update-badge")).toMatch(/font-size:\s*var\(--type-secondary-size\)/);
  });
});
