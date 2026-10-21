/**
 * Aside Atom Component
 *
 * Semantic wrapper for the native `<aside>` landmark. Owns raw HTML so
 * molecules (SidePanel, navigation rails, callouts) can compose the
 * semantic-aside primitive without falling back to a raw element.
 */

import type { A11yProps } from '@almadar/core';
import React from "react";
import { cn } from "../lib/cn";

/**
 * Aside — a secondary side panel that hosts navigation links or supplementary
 * content alongside a main content area.
 *
 * @capabilities settings navigation sidebar, preferences menu panel, account settings nav, secondary panel, side navigation rail
 */
export interface AsideProps extends Omit<React.HTMLAttributes<HTMLElement>, keyof A11yProps>, A11yProps {
  /** Additional CSS classes */
  className?: string;
  /** Aside contents */
  children?: React.ReactNode;
}

export const Aside = React.forwardRef<HTMLElement, AsideProps>(
  ({ className, children, ...rest }, ref) => (
    <aside ref={ref} className={cn(className)} {...rest}>
      {children}
    </aside>
  ),
);

Aside.displayName = "Aside";
