"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "success" | "error" | "info";

type Toast = {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
};

type ShowToast = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<ShowToast>(() => {});

/**
 * How long a toast stays: 3 seconds, plus 60 ms for each character past 40,
 * so longer messages can be read. Errors stay at least 6 seconds. Nothing
 * stays past 15.
 */
export function toastDuration(message: string, kind: ToastKind): number {
  const reading = 3_000 + 60 * Math.max(0, message.length - 40);
  return Math.min(
    15_000,
    kind === "error" ? Math.max(6_000, reading) : reading,
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  // Hovering or focusing the toast holds it. Once neither does, a short
  // timer starts, so the pointer leaving can't end a hold that focus set.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const [remaining, setRemaining] = useState(() =>
    toastDuration(toast.message, toast.kind),
  );

  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => onDismiss(toast.id), remaining);
    return () => clearTimeout(timer);
  }, [held, remaining, onDismiss, toast.id]);

  // Focus in a toast that goes away would fall to the page's start. It
  // moves to the next toast's button, or the one before, or the page's
  // main content.
  function dismiss(event: React.MouseEvent<HTMLButtonElement>) {
    const item = event.currentTarget.closest(".toast");
    if (item?.contains(document.activeElement)) {
      const neighbour =
        item.nextElementSibling ?? item.previousElementSibling ?? null;
      const next =
        neighbour?.querySelector("button") ??
        document.querySelector<HTMLElement>("main");
      next?.focus();
    }
    onDismiss(toast.id);
  }

  return (
    <div
      className={`toast toast-${toast.kind}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setRemaining(2_000);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // Focus moving between the toast's own parts keeps it held.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false);
        setRemaining(2_000);
      }}
    >
      <p>{toast.message}</p>
      <button type="button" aria-label="Dismiss notification" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}

/**
 * Holds the toasts and the live region that announces them. Screen readers
 * read each new toast once, politely, without interrupting.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ShowToast>((message, kind = "info") => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((list) => [...list, { id, kind, message }]);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="toasts"
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Shows a toast: useToast()("Invitation sent.", "success"). */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}
