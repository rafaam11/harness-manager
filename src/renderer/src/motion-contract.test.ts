import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { motionDuration, motionEase } from "./motion-tokens";

const stylesheet = readFileSync(resolve("src/renderer/src/index.css"), "utf8");
const root = stylesheet.match(/:root\s*\{([^{}]*)\}/)?.[1] ?? "";

function token(name: string): string {
  const value = root.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
  if (value === undefined) throw new Error(`Missing CSS token: --${name}`);
  return value.trim();
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

describe("motion contract", () => {
  it("mirrors every CSS duration in motion-tokens.ts", () => {
    for (const [key, seconds] of Object.entries(motionDuration)) {
      expect(token(`motion-duration-${key}`)).toBe(`${Math.round(seconds * 1000)}ms`);
    }
  });

  it("mirrors every CSS easing in motion-tokens.ts", () => {
    for (const [key, points] of Object.entries(motionEase)) {
      expect(token(`ease-${kebab(key)}`)).toBe(`cubic-bezier(${points.join(", ")})`);
    }
  });

  it("never transitions every property", () => {
    expect(stylesheet).not.toMatch(/transition(?:-property)?\s*:\s*all\b/);
  });

  it("gives every OS reduced-motion rule a twin for the app's own setting", () => {
    const opener = "@media (prefers-reduced-motion: reduce) {";
    const selectors: string[] = [];
    for (let start = stylesheet.indexOf(opener); start !== -1; start = stylesheet.indexOf(opener, start + 1)) {
      let depth = 1;
      let end = start + opener.length;
      while (depth > 0) {
        const char = stylesheet[end++];
        if (char === "{") depth++;
        else if (char === "}") depth--;
      }
      const body = stylesheet.slice(start + opener.length, end - 1).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of body.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        selectors.push(...match[1]!.split(",").map((selector) => selector.trim()));
      }
    }
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(stylesheet, selector).toContain(`:root[data-reduce-motion] ${selector}`);
    }
  });
});
