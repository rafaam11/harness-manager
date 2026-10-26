// renderer ↔ main 공용 타입의 진입점. preload와 renderer, main이 함께 import한다(@shared).
// IPC 계약 자체는 api-types.ts가 단일 출처다.

export * from "./provider-types.js";
export * from "./api-types.js";
