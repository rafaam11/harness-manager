import type { ProviderId } from "./provider-types";
export interface ExampleLimits { model: string; budgetUsd: number; timeoutSeconds: number }
export interface ExamplePlan {
  description: string; input: string; expectedArtifact: string;
  tools: never[]; connections: never[]; checks: { type: "contains"; text: string }[];
}
export interface ExamplePreview {
  token: string; itemId: string; provider: ProviderId; skillName: string; fingerprint: string;
  plan: ExamplePlan; generation: ExampleLimits; execution: ExampleLimits; limitations: string[];
}
export interface ExampleResult {
  at: string; status: "completed" | "failed" | "cancelled";
  exit: "success" | "error"; skillEvidence: "content-supplied"; artifactVerified: boolean;
  fingerprint: string; detail: string; artifact?: string;
  checks: { text: string; passed: boolean }[];
}
export interface ExampleRequest {
  itemId: string; provider: ProviderId; scopeId: string;
  generation: ExampleLimits; execution: ExampleLimits;
}
export interface ExampleRecord { itemId: string; scopeId: string; provider: ProviderId; limits: ExampleLimits; result: ExampleResult }
