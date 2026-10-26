/**
 * The motion scale from index.css's :root, in the units motion/react takes (seconds and cubic-bezier
 * tuples). motion-contract.test.ts keeps the two in step.
 */
export const motionDuration = {
  instant: 0.08,
  fast: 0.12,
  base: 0.18,
  slow: 0.28,
  signal: 1.6,
} as const;

export const motionEase = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  standard: [0.2, 0, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;
