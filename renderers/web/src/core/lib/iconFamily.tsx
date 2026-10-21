/**
 * Icon family runtime resolver (Layer 1 Iconography axis).
 *
 * Reads the active `--icon-family` CSS variable from the document element and
 * dispatches a canonical icon name (kebab-case, matching lucide's vocabulary)
 * to the equivalent lucide component. Subscribes to data-theme attribute changes
 * via MutationObserver so a theme switch re-renders icons without a page reload.
 *
 * Non-lucide families (phosphor, tabler, fontawesome) are temporarily disabled
 * to keep them out of client bundles. They can be re-enabled later behind an
 * async chunk boundary once the workspace/publish dust settles.
 *
 * See `docs/Almadar_Std_Variations.md` §2 and `themes/_contract.md`.
 */

'use client';
import React, { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { IconFamily as IconFamilyType } from '@almadar/core';
import { resolveLucideByName } from './lucideIcons';
import type { LucideIcon } from 'lucide-react';

export type IconFamily = IconFamilyType;

/** Adapter props that EVERY family-specific icon component accepts at this layer. */
export interface RenderedIconProps {
  className?: string;
  strokeWidth?: number;
  size?: number;
  style?: React.CSSProperties;
}

const DEFAULT_FAMILY: IconFamily = 'lucide';
const VALID_FAMILIES: ReadonlyArray<IconFamily> = [DEFAULT_FAMILY];

/** The theme's declared --icon-family ('' when unset or on SSR). */
function themeIconFamily(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--icon-family')
    .trim()
    .replace(/^["']|["']$/g, '');
}

/** Read --icon-family from <html> at runtime. Returns 'lucide' on SSR. */
export function getCurrentIconFamily(): IconFamily {
  const raw = themeIconFamily();
  return (VALID_FAMILIES as ReadonlyArray<string>).includes(raw)
    ? (raw as IconFamily)
    : DEFAULT_FAMILY;
}

/**
 * The theme's `--icon-stroke-width` belongs to the theme's family; it applies
 * only when that family is the one rendering (unset = the default family).
 */
function familyStrokeApplies(raw: string): boolean {
  return raw === '' || (VALID_FAMILIES as ReadonlyArray<string>).includes(raw);
}

function themeStrokeApplies(): boolean {
  return familyStrokeApplies(themeIconFamily());
}

/** The --icon-family a theme scoped to `el`'s subtree declares, or null when only the document theme
 *  applies. A scoped theme is a `data-theme` element and declares its tokens there, so one read of
 *  that element answers it: no style is read for an icon outside any scope (most icons). */
function scopedIconFamily(el: Element): string | null {
  const scope = el.closest('[data-theme]');
  if (!scope || scope === document.documentElement) return null;
  // Read once per scope per theme change: every icon in a themed preview shares it.
  const known = scopedFamilies.get(scope);
  if (known && known.version === themeVersion) return known.family;
  const raw = getComputedStyle(scope).getPropertyValue('--icon-family').trim().replace(/^["']|["']$/g, '');
  const family = raw === '' ? null : raw;
  scopedFamilies.set(scope, { version: themeVersion, family });
  return family;
}

const scopedFamilies = new WeakMap<Element, { version: number; family: string | null }>();

// ---------------------------------------------------------------------------
// useIconFamily — hook that re-renders consumers when data-theme changes
// ---------------------------------------------------------------------------

let cachedFamily: IconFamily | null = null;
let cachedStrokeApplies: boolean | null = null;
let themeVersion = 0;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
let scopeObserver: MutationObserver | null = null;

function ensureObserver(): void {
  if (typeof window === 'undefined' || observer) return;
  observer = new MutationObserver(() => {
    const next = getCurrentIconFamily();
    const nextStroke = themeStrokeApplies();
    if (next !== cachedFamily || nextStroke !== cachedStrokeApplies) {
      cachedFamily = next;
      cachedStrokeApplies = nextStroke;
      themeVersion++;
      listeners.forEach((fn) => fn());
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style'],
  });
  // Scoped themes (`data-theme` on a subtree) change what an icon's CSS
  // variables resolve to without touching <html>.
  scopeObserver = new MutationObserver((records) => {
    if (records.every((r) => r.target === document.documentElement)) return;
    themeVersion++;
    listeners.forEach((fn) => fn());
  });
  scopeObserver.observe(document.documentElement, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-theme'],
  });
  cachedFamily = getCurrentIconFamily();
  cachedStrokeApplies = themeStrokeApplies();
}

function subscribeIconFamily(notify: () => void): () => void {
  ensureObserver();
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

function getIconFamilySnapshot(): IconFamily {
  if (cachedFamily !== null) return cachedFamily;
  cachedFamily = getCurrentIconFamily();
  return cachedFamily;
}

function getIconFamilyServerSnapshot(): IconFamily {
  return DEFAULT_FAMILY;
}

function getStrokeAppliesSnapshot(): boolean {
  if (cachedStrokeApplies !== null) return cachedStrokeApplies;
  cachedStrokeApplies = themeStrokeApplies();
  return cachedStrokeApplies;
}

function getThemeVersionSnapshot(): number {
  return themeVersion;
}

/** React hook: whether the theme's `--icon-stroke-width` applies to the rendered icons. */
export function useThemeIconStrokeApplies(ref: React.RefObject<Element | null>): boolean {
  const documentApplies = useSyncExternalStore(subscribeIconFamily, getStrokeAppliesSnapshot, () => true);
  const version = useSyncExternalStore(subscribeIconFamily, getThemeVersionSnapshot, () => 0);
  const [scopedApplies, setScopedApplies] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const scoped = scopedIconFamily(ref.current);
    setScopedApplies(scoped === null ? null : familyStrokeApplies(scoped));
  }, [ref, version]);
  return scopedApplies ?? documentApplies;
}

/** React hook: returns the active icon family, re-renders on theme switch. */
export function useIconFamily(): IconFamily {
  return useSyncExternalStore(
    subscribeIconFamily,
    getIconFamilySnapshot,
    getIconFamilyServerSnapshot,
  );
}

// ---------------------------------------------------------------------------
// Lucide resolver (canonical, only active family)
// ---------------------------------------------------------------------------

const resolveLucide = resolveLucideByName;

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export type RenderedIcon = React.ForwardRefExoticComponent<
  RenderedIconProps & React.RefAttributes<SVGSVGElement>
>;

function makeLucideAdapter(name: string): RenderedIcon {
  const LucideComp = resolveLucide(name);
  const Adapter = React.forwardRef<SVGSVGElement, RenderedIconProps>((props, ref) => (
    <LucideComp
      ref={ref}
      className={props.className}
      strokeWidth={props.strokeWidth}
      style={props.style}
      size={props.size}
    />
  ));
  Adapter.displayName = `Lucide.${name}`;
  return Adapter;
}

/**
 * Dispatch a canonical icon name to the active family component.
 * Non-lucide families are currently disabled and fall back to lucide.
 */
export function resolveIconForFamily(
  name: string,
  _family: IconFamily,
): RenderedIcon {
  return makeLucideAdapter(name);
}

// ---------------------------------------------------------------------------
// useResolvedIcon — re-renders when family changes, returns the right component
// ---------------------------------------------------------------------------

/**
 * Resolve a canonical icon name to a family-aware component. The returned
 * component re-renders the icon into the active family's library on theme
 * switch (via useIconFamily's MutationObserver subscription).
 */
export function useResolvedIcon(
  name: string,
): RenderedIcon {
  const family = useIconFamily();
  const [comp, setComp] = useState<RenderedIcon>(() =>
    resolveIconForFamily(name, family),
  );
  useEffect(() => {
    setComp(() => resolveIconForFamily(name, family));
  }, [name, family]);
  return comp;
}
