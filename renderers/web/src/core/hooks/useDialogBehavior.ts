'use client';
/**
 * useDialogBehavior — the one owner of modal-dialog keyboard behavior
 * (WAI-ARIA APG dialog pattern), shared by Modal and Drawer:
 *
 * - focus moves into the dialog on open and returns to the opener on close;
 * - Tab / Shift+Tab wrap inside the dialog (focus trap);
 * - Escape reaches only the top-most open dialog, so stacked overlays close
 *   one at a time.
 *
 * A non-modal dialog (`modal: false`, e.g. Popover) joins the Escape stack
 * but neither takes focus on open nor traps Tab.
 */
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs keyed by open order. The order is taken at render time, which
// runs parent-first — effects run child-first, so a modal and a nested dialog
// mounting in one commit would otherwise put the parent on top.
const openStack = new Map<symbol, number>();
let openSequence = 0;

function isTop(id: symbol): boolean {
  let top: symbol | null = null;
  let max = -1;
  for (const [key, seq] of openStack) {
    if (seq > max) {
      max = seq;
      top = key;
    }
  }
  return top === id;
}

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export interface DialogBehaviorOptions {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onEscape: () => void;
  closeOnEscape?: boolean;
  modal?: boolean;
  /** Where focus returns on close; defaults to whatever had focus at open
   *  (a click does not focus a button in every browser, so triggers pass it). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function useDialogBehavior({ open, containerRef, onEscape, closeOnEscape = true, modal = true, returnFocusRef }: DialogBehaviorOptions): void {
  const idRef = useRef<symbol>(Symbol('dialog'));
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const closeOnEscapeRef = useRef(closeOnEscape);
  closeOnEscapeRef.current = closeOnEscape;
  const seqRef = useRef<number | null>(null);
  if (open && seqRef.current === null) seqRef.current = ++openSequence;
  if (!open) seqRef.current = null;

  useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    const opener = returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    openStack.set(id, seqRef.current ?? ++openSequence);

    const container = containerRef.current;
    if (modal && container && !container.contains(document.activeElement)) {
      (focusables(container)[0] ?? container).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTop(id)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (closeOnEscapeRef.current) onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !modal) return;
      const el = containerRef.current;
      if (!el) return;
      const items = focusables(el);
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!el.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      openStack.delete(id);
      const active = document.activeElement;
      const current = containerRef.current ?? container;
      const focusInside = current?.contains(active) ?? false;
      const focusLeftWithDialog = focusInside || active === null || active === document.body;
      if (opener && opener.isConnected && focusLeftWithDialog) opener.focus();
    };
  }, [open, containerRef, modal, returnFocusRef]);
}
