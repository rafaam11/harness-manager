import crypto from "node:crypto";

/** 쓰기 직전 원본이 바뀌었으면 던진다(capture·install의 원본 대조). */
export class ConflictError extends Error {
  statusCode = 409;
}

export function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
