import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus management for `aria-modal` dialogs: when `active`, moves focus into the
 * panel on open, restores it to the trigger on close, traps Tab within the
 * panel, and closes on Escape. Attach the returned ref to the dialog panel.
 */
export function useDialogFocus(active: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Initial focus on open + restore to the trigger on close. Keyed only on
  // `active` so a parent re-render (new `onClose` identity) doesn't re-capture
  // the trigger as an element inside the dialog.
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, [active]);

  // Escape to close + Tab trap within the panel.
  useEffect(() => {
    if (!active) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, onClose]);

  return panelRef;
}
