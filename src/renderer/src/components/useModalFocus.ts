import { useEffect, type RefObject } from "react";

export function useModalFocus(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [...element?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary") ?? []].filter(node => node.getClientRects().length);
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    element?.addEventListener("keydown", trap);
    return () => { element?.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, [root]);
}
