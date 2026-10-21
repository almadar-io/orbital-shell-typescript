/**
 * Lucide canonical icon name → native platform glyph (Layer 1 Iconography
 * axis, native path). `lib/iconFamily.tsx` resolves a canonical name to a
 * React component for the web/runtime path; this table is the same
 * dispatch for the compiled iOS/Android shells, which have no React DOM to
 * render into and instead need a platform symbol name.
 *
 * Hand-curated (no fuzzy matching — see `resolveNativeIcon`). Covers:
 *   (a) every alias key in `components/core/atoms/Icon.tsx` `iconAliases`
 *       and `lib/iconFamily.tsx` `lucideAliases`
 *   (b) every icon name appearing as an icon-prop `default` or in an
 *       icon-prop description's quoted examples in
 *       `orbital-rust/crates/orbital-compiler/src/baked/patterns-registry.json`
 *   (c) every icon name used by the wave-1 native pattern set's React
 *       components under `components/core/**`
 *   (d) the common Lucide vocabulary: navigation, actions, files,
 *       communication, status, media, arrows, editing.
 *
 * `sfSymbol` values are real SF Symbols 5 names; `materialSymbol` values are
 * real Material Symbols names. The table is `lib/iconNativeMap.json`, the one source
 * `orb shell-renderers icon-map` also reads to emit `IconMap.swift`/`IconMap.kt`; edit the
 * JSON, then regenerate. The JSON also carries each icon's `categories` entry and the
 * per-icon rationale `notes` (the former inline comments); the TS ignores both.
 */

import iconTable from './iconNativeMap.json';

export interface NativeIconGlyph {
  sfSymbol: string;
  materialSymbol: string;
}

export const ICON_FALLBACK: NativeIconGlyph = iconTable.fallback;

export const ICON_NATIVE_MAP: Readonly<Record<string, NativeIconGlyph>> = iconTable.map;

/**
 * Every non-standard name from `iconAliases` (`components/core/atoms/Icon.tsx`)
 * and `lucideAliases` (`lib/iconFamily.tsx`) — the names that don't kebab→Pascal
 * to a real Lucide export. Each one is also a first-class `ICON_NATIVE_MAP` key
 * (requirement (a)); exported so the alias set has one pinned source of truth
 * a test can check against, independent of whatever else the map grows to cover.
 */
export const ICON_ALIASES: ReadonlyArray<string> = [
  'close', 'trash', 'loader', 'stop', 'volume', 'volume-off', 'refresh',
  'share', 'sort-asc', 'sort-desc',
];

/** Exact key match, then an `iconAliases` alias, then the deterministic fallback — no fuzzy matching. */
export function resolveNativeIcon(name: string): NativeIconGlyph {
  const direct = ICON_NATIVE_MAP[name];
  if (direct) return direct;
  if (ICON_ALIASES.includes(name)) {
    const aliased = ICON_NATIVE_MAP[name];
    if (aliased) return aliased;
  }
  return ICON_FALLBACK;
}
