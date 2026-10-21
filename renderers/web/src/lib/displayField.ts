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

/** The declared title field (`variant: 'h3' | 'h4'`), if any. */
export function titleFieldOf(fields: readonly DisplayField[]): DisplayField | undefined {
  return fields.find((f) => f.variant === 'h3' || f.variant === 'h4');
}
