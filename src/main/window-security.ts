import type { BrowserWindow } from "electron";
import { pathToFileURL } from "node:url";

export const RENDERER_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // 카탈로그 본문 마크다운이 원격 이미지를 담을 수 있다. 스크립트·프레임은 여전히 막는다.
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  // vanilla-jsoneditor가 blob 워커를 쓴다.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

export type RendererTarget =
  | { kind: "url"; value: string }
  | { kind: "file"; value: string };

function isIpv4Loopback(hostname: string): boolean {
  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) return false;
      const value = Number(octet);
      return value >= 0 && value <= 255;
    })
  );
}

export function isLoopbackRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;

    return (
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      isIpv4Loopback(url.hostname)
    );
  } catch {
    return false;
  }
}

export function resolveRendererTarget(options: {
  isPackaged: boolean;
  rendererUrl?: string;
  rendererFilePath: string;
}): RendererTarget {
  if (
    !options.isPackaged &&
    options.rendererUrl &&
    isLoopbackRendererUrl(options.rendererUrl)
  ) {
    return { kind: "url", value: new URL(options.rendererUrl).href };
  }

  return { kind: "file", value: options.rendererFilePath };
}

export function rendererTargetNavigationUrl(target: RendererTarget): string {
  return target.kind === "url" ? target.value : pathToFileURL(target.value).href;
}

export function isAllowedRendererNavigation(
  navigationUrl: string,
  loadedAppUrl: string,
): boolean {
  try {
    const navigation = new URL(navigationUrl);
    const loadedApp = new URL(loadedAppUrl);

    if (loadedApp.protocol === "http:" || loadedApp.protocol === "https:") {
      return (
        isLoopbackRendererUrl(loadedApp.href) &&
        isLoopbackRendererUrl(navigation.href) &&
        navigation.origin === loadedApp.origin
      );
    }

    if (loadedApp.protocol === "file:") {
      return (
        navigation.protocol === "file:" &&
        navigation.host === loadedApp.host &&
        navigation.pathname === loadedApp.pathname
      );
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * 팝업과 외부로의 최상위 이동을 막는다. 막힌 URL은 `openExternal`로 넘겨 OS 브라우저에서 연다
 * (카탈로그 본문의 링크). 무엇을 열지는 openExternal 쪽이 http/https만 허용해 결정한다.
 */
export function secureBrowserWindow(
  window: BrowserWindow,
  loadedAppUrl: string,
  openExternal: (url: string) => void = () => undefined,
): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  const preventExternalNavigation = (
    event: Electron.Event,
    navigationUrl: string,
  ): void => {
    if (!isAllowedRendererNavigation(navigationUrl, loadedAppUrl)) {
      event.preventDefault();
      openExternal(navigationUrl);
    }
  };

  window.webContents.on("will-navigate", preventExternalNavigation);
  window.webContents.on("will-redirect", preventExternalNavigation);
}
