import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  API_CHANNELS,
  API_EVENTS,
  type ApiChannel,
  type ApiEvent,
  type HarnessBridge,
} from "@shared/api-types";

// 채널 목록은 api-types.ts 한 곳에서만 온다. 목록 밖 채널은 main까지 가지 않고 여기서 거절한다.
const allowedChannels: ReadonlySet<string> = new Set(API_CHANNELS);
const allowedEvents: ReadonlySet<string> = new Set(API_EVENTS);

const bridge: HarnessBridge = {
  platform: process.platform,
  invoke: (channel: ApiChannel, ...args: unknown[]) => {
    if (!allowedChannels.has(channel)) return Promise.reject(new Error(`Unknown channel: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (event: ApiEvent, listener: (payload: unknown) => void) => {
    if (!allowedEvents.has(event)) throw new Error(`Unknown event: ${event}`);
    const handler = (_e: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  },
} as HarnessBridge;

contextBridge.exposeInMainWorld("hm", bridge);
