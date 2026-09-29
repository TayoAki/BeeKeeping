"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

export type DialogProps = {
  readonly open: boolean;
  readonly title: string;
  /**
   * Called once each time the dialog closes by Escape or the close button,
   * or by the browser. Not called when the owner closes it by setting open.
   */
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  /**
   * What gets focus when the dialog opens. Without it, the browser picks
   * the first control, which is the close button.
   */
  readonly initialFocus?: RefObject<HTMLElement | null>;
};

/**
 * A modal dialog on the native <dialog> element. Opening it moves focus
 * inside and makes the page behind it inert. Escape and the close button
 * close it, and focus goes back to whatever had it before. A click on the
 * backdrop does nothing, so a half-filled form isn't lost.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  className,
  initialFocus,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  // Whether the owner already knows about the close under way, so the
  // browser's close event doesn't tell it again.
  const told = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      told.current = false;
      opener.current = document.activeElement;
      dialog.showModal();
      initialFocus?.current?.focus();
    } else if (!open && dialog.open) {
      told.current = true;
      dialog.close();
    }
  }, [open, initialFocus]);

  // Escape, through the cancel event, and the close button tell the owner
  // at once. The browser's close event comes later, as a task of its own,
  // and a key pressed in between, such as Ctrl+K again, must find the
  // owner's state closed already, or it would do nothing.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const cancelled = () => {
      told.current = true;
      flushSync(onClose);
    };
    const closed = () => {
      // A close event that arrives after the dialog opened again is stale.
      if (dialog.open) return;
      if (!told.current) onClose();
      told.current = false;
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
    dialog.addEventListener("cancel", cancelled);
    dialog.addEventListener("close", closed);
    return () => {
      dialog.removeEventListener("cancel", cancelled);
      dialog.removeEventListener("close", closed);
    };
  }, [onClose]);

  return (
    <dialog ref={ref} aria-labelledby={titleId} className={className}>
      <div className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label="Close dialog"
          onClick={() => {
            told.current = true;
            flushSync(onClose);
          }}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
