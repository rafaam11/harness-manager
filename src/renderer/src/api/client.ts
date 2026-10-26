import type { ApiArgs, ApiChannel, ApiReturn } from "@shared/api-types";
import { errorMessage } from "../ipc-error";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * main 호출의 유일한 입구. 채널·인자·반환 타입은 api-types.ts의 맵에서 온다.
 * main은 throw 대신 봉투를 돌려주므로, 여기서 statusCode를 되살려 ApiError로 던진다(409 충돌 등을 구분하게).
 */
export async function call<K extends ApiChannel>(channel: K, ...args: ApiArgs<K>): Promise<ApiReturn<K>> {
  let result;
  try {
    result = await window.hm.invoke(channel, ...args);
  } catch (error) {
    // preload가 거절했거나 IPC 자체가 실패한 경우 — main의 상태코드가 없다.
    throw new ApiError(500, errorMessage(error));
  }
  if (!result.ok) throw new ApiError(result.statusCode, result.error);
  return result.data;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** "오늘/어제/N일 전" 형태의 상대 시간. */
export function fmtRelative(ms: number): string {
  if (!ms) return "—";
  const day = 86400000;
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startThat = new Date(ms);
  startThat.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startToday.getTime() - startThat.getTime()) / day);
  if (dayDiff <= 0) {
    const diff = Date.now() - ms;
    const h = Math.floor(diff / 3600000);
    if (h < 1) return `${Math.max(1, Math.floor(diff / 60000))}분 전`;
    return `${h}시간 전`;
  }
  if (dayDiff === 1) return "어제";
  if (dayDiff < 7) return `${dayDiff}일 전`;
  return fmtDate(ms);
}
