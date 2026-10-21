/**
 * Dialog Atom Component
 *
 * Semantic wrapper for the native `<dialog>` element. Owns the raw
 * HTML rendering so molecules (Modal, ConfirmDialog, etc.) can compose
 * the dialog primitive without dropping back to raw HTML.
 *
 * Defaults `role="dialog"` and `aria-modal="true"`; both overridable
 * for non-modal use cases.
 */

import type { A11yProps } from '@almadar/core';
import React from "react";
import { cn } from "../lib/cn";

export interface DialogProps extends Omit<React.DialogHTMLAttributes<HTMLDialogElement>, keyof A11yProps>, A11yProps {
  /** Additional CSS classes */
  className?: string;
  /** Dialog contents */
  children?: React.ReactNode;
}

export const Dialog = React.forwardRef<HTMLDialogElement, DialogProps>(
  (
    {
      role = "dialog",
      "aria-modal": ariaModal = true,
      className,
      children,
      ...rest
    },
    ref,
  ) => (
    <dialog
      ref={ref}
      role={role}
      aria-modal={ariaModal}
      className={cn(className)}
      {...rest}
    >
      {children}
    </dialog>
  ),
);

Dialog.displayName = "Dialog";
