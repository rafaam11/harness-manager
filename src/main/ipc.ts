import { API_CHANNELS, type ApiResult } from "@shared/api-types";
import type { ApiHandlers } from "./api-handlers.js";

/** ipcMain에서 여기서 쓰는 부분만. 테스트가 가짜를 넣는다. */
export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** 상태코드를 들고 던진 에러(path-guard 403, safe-write 409, json-validate 422, 검증 400 등)를 봉투로 바꾼다. */
export function toApiResult(error: unknown): ApiResult<never> {
  const e = error as { statusCode?: unknown; message?: unknown };
  const statusCode = typeof e?.statusCode === "number" ? e.statusCode : 500;
  const message = typeof e?.message === "string" ? e.message : String(error);
  return { ok: false, statusCode, error: message };
}

/**
 * api-types.ts의 채널 목록을 전부 등록한다. 메인 창이 아닌 곳에서 온 요청은 어떤 채널도 받지 않는다.
 * 핸들러는 throw 대신 봉투를 돌려 statusCode가 렌더러까지 그대로 간다.
 */
export function registerMainIpc(
  registrar: IpcRegistrar,
  handlers: ApiHandlers,
  isTrustedSender: (event: unknown) => boolean,
): void {
  for (const channel of API_CHANNELS) {
    const handler = handlers[channel] as (...args: unknown[]) => unknown;
    registrar.handle(channel, async (event, ...args): Promise<ApiResult> => {
      if (!isTrustedSender(event)) return { ok: false, statusCode: 403, error: `Untrusted sender for ${channel}` };
      try {
        return { ok: true, data: await handler(...args) };
      } catch (error) {
        return toApiResult(error);
      }
    });
  }
}
