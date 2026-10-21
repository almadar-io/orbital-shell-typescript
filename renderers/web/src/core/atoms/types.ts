/**
 * Cross-cutting atom-level prop shapes shared across the design system.
 */

import type { AssetUrl } from "@almadar/core";
import type { IconInput } from "./Icon";
import type { BadgeVariant } from "./Badge";

/**
 * Canonical semantic color palette.  Values are the Tailwind / CSS-var token
 * names that every component in the design system understands.  Prefer this
 * over a bare `string` for any `color` or `variant` prop.
 */
export type ColorToken =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'error'
  | 'muted';

/**
 * Concrete error-state shape read by display components (`error.message`,
 * occasionally `error.stack`). Structurally assignable from the global `Error`,
 * so existing call sites passing an `Error` keep working — this just gives the
 * pattern extractor a readable field schema instead of the opaque `Error` global.
 */
export type UiError = {
  message: string;
  name?: string;
  code?: string;
  stack?: string;
};

/**
 * A labelled link/CTA used by marketing molecules (HeroSection, CTABanner,
 * PricingCard) for their primary/secondary call-to-action props.
 */
export type LinkAction = {
  label: string;
  href: string;
};

/** An image with its required alt text. */
export type ImageSource = {
  src: AssetUrl;
  alt: string;
};

/** A 2D point in canvas/layout coordinates. */
export type Point = {
  x: number;
  y: number;
};

/** A 2D rectangle in canvas coordinates (`w`/`h` = width/height). */
export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** A badge colour a field's `colorMap` may name (`destructive` is the shadcn alias of `danger`). */
export type BadgeColor = BadgeVariant | 'destructive';

/** How a display field renders: `h3`/`h4` is the record's title, `badge` a
 *  status pill, `progress` a progress bar, `body` a prose block. */
export type DisplayFieldVariant = 'h3' | 'h4' | 'overline' | 'avatar' | 'body' | 'caption' | 'badge' | 'small' | 'progress';

/** How a display field's value is formatted. */
export type DisplayFieldFormat = 'date' | 'time' | 'datetime' | 'currency' | 'number' | 'boolean' | 'percent';

/**
 * One field of a record shown by a data display (DataGrid, DataList, List,
 * CardGrid, DetailPanel, Timeline). Every slot a field fills — title, badge,
 * progress, date — is declared here; nothing is inferred from its name or value.
 */
export interface DisplayField {
  /** Entity field name (dot-notation supported) */
  name: string;
  /** Display label (the `name` as written if omitted) */
  label?: string;
  /** Icon shown beside the field */
  icon?: IconInput;
  /** Rendering variant */
  variant?: DisplayFieldVariant;
  /** Value format */
  format?: DisplayFieldFormat;
  /** Badge colour per exact value (for `variant: 'badge'`); unmapped values are neutral */
  colorMap?: Readonly<Record<string, BadgeColor>>;
  /** Display text per exact value (e.g. `in_progress` → "In progress"); unmapped values show as stored */
  labels?: Readonly<Record<string, string>>;
}
