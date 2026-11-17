/**
 * The one resolver for declared display fields: normalizes the accepted field
 * spellings and picks a badge colour only from a declared `colorMap`.
 */
import type { BadgeVariant } from '../core';
import type { BadgeColor, DisplayField } from '../core';

/** Legacy column spelling (`key`/`header`) some displays still accept. */
export interface LegacyFieldSpelling {
  key?: string;
  header?: string;
  name?: string;
  label?: string;
}

export type DisplayFieldInput = string | DisplayField | LegacyFieldSpelling;

function isDisplayField(input: DisplayField | LegacyFieldSpelling): input is DisplayField {
  return typeof input.name === 'string' && !('key' in input) && !('header' in input);
}

export function normalizeDisplayField(input: DisplayFieldInput): DisplayField | null {
  if (typeof input === 'string') return input ? { name: input } : null;
  if (isDisplayField(input)) return input.name ? input : null;
  const name = input.name ?? input.key;
  if (!name) return null;
  const label = input.label ?? input.header;
  return label === undefined ? { name } : { name, label };
}

export function normalizeDisplayFields(inputs: readonly DisplayFieldInput[] | undefined): DisplayField[] {
  return (inputs ?? []).map(normalizeDisplayField).filter((f): f is DisplayField => f !== null);
}

/** The badge colour for `value`: its declared `colorMap` entry, otherwise neutral. */
export function badgeVariantFor(value: string, colorMap: Readonly<Record<string, BadgeColor>> | undefined): BadgeVariant {
  const declared = colorMap?.[value];
  if (declared === undefined) return 'default';
  return declared === 'destructive' ? 'danger' : declared;
}

/** The display text for `value`: its declared label, otherwise the value as stored. */
export function valueLabelFor(value: string, labels: Readonly<Record<string, string>> | undefined): string {
  return labels?.[value] ?? value;
}

export type TitleHeading = 'h3' | 'h4' | 'h5' | 'h6';

function isTitleHeading(variant: DisplayField['variant']): variant is TitleHeading {
  return variant === 'h3' || variant === 'h4' || variant === 'h5' || variant === 'h6';
}

/** The declared title field (a heading variant, `h3` to `h6`), if any. */
export function titleFieldOf(fields: readonly DisplayField[]): DisplayField | undefined {
  return fields.find((f) => isTitleHeading(f.variant));
}

/** The heading a title field declares; `h4` when it declares none. */
export function titleHeadingOf(field: DisplayField | undefined): TitleHeading {
  return field !== undefined && isTitleHeading(field.variant) ? field.variant : 'h4';
}
