import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { motionDuration, motionEase } from "../motion-tokens";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastInput {
  tone: ToastTone;
  title: string;
  detail?: string;
  /** Clicking the toast does this, then dismisses it. */
  onSelect?(): void;
}

interface Toast extends ToastInput {
  id: number;
}

/** How long a toast stays when nobody looks at it. Hovering holds it. */
export const TOAST_MS = 4500;
/** More than this and the stack stops being glanceable; the oldest goes first. */
const MAX_TOASTS = 3;

/*
 * App의 state가 아니라 모듈 수준 저장소다: 어디서든 토스트를 띄울 수 있어야 하고, 그러려고 콜백을
 * 줄줄이 내려보내지 않는다. Sonner의 모양을 무게 없이 따랐다.
 */
let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: readonly Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

export function showToast(input: ToastInput): number {
  const id = nextId++;
  publish([...toasts, { ...input, id }].slice(-MAX_TOASTS));
  return id;
}

export function dismissToast(id: number) {
  if (toasts.some((toast) => toast.id === id)) publish(toasts.filter((toast) => toast.id !== id));
}

/** For tests: forget every toast between cases. */
export function resetToasts() {
  publish([]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const TONE_ICON = { success: CircleCheck, error: CircleX, info: Info, warning: CircleAlert } as const;

function ToastItem({ toast }: { toast: Toast }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => dismissToast(toast.id), TOAST_MS);
  };
  const hold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    arm();
    return hold;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Icon = TONE_ICON[toast.tone];
  return (
    <motion.li
      layout="position"
      className={`toast toast-${toast.tone}`}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: motionDuration.slow, ease: motionEase.out }}
      onMouseEnter={hold}
      onMouseLeave={arm}
    >
      <button
        type="button"
        className="toast-body"
        onClick={() => {
          toast.onSelect?.();
          dismissToast(toast.id);
        }}
      >
        <Icon size={15} aria-hidden="true" />
        <span className="toast-copy">
          <span className="toast-title">{toast.title}</span>
          {toast.detail ? <span className="toast-detail">{toast.detail}</span> : null}
        </span>
      </button>
    </motion.li>
  );
}

/** 창 오른쪽 아래의 알림 더미. polite: 끝난 작업은 소식이지 방해가 아니다. */
export function Toaster() {
  const current = useSyncExternalStore(subscribe, () => toasts);
  return (
    <ol className="toaster" aria-live="polite" aria-label="알림">
      <AnimatePresence initial={false}>
        {current.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </ol>
  );
}
