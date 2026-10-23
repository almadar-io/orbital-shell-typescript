import { OrbitalDefinition, NavItem, PageRef } from '@almadar/core';

/**
 * The render sigils `@pages` and `@currentTheme`, assembled one way for every effect
 * stage (the server's and the index runner's). Mirrors the compiler's resolver.
 *
 * @packageDocumentation
 */

/** The baseline theme `@currentTheme` falls back to when no orbital or app theme is declared. Mirrors the compiler's `DEFAULT_THEME_KEY`. */
declare const DEFAULT_THEME_KEY = "minimalist-light";
/**
 * Map an orbital's inline pages to the `NavItem[]` the `@pages` sigil yields: one
 * entry per root page that declares `@label` (`href = page.path`, its `@icon` and
 * `@roles`). References (resolved before any stage runs) and `:param` pages are
 * skipped — the Rust resolver's filter.
 */
declare function inlineNavItems(pages: readonly PageRef[]): NavItem[];
/** `@pages` is app-wide: the root pages of every orbital, deduped by path, in orbital order. */
declare function appNavItems(orbitals: Iterable<Pick<OrbitalDefinition, 'pages'>>): NavItem[];
/** `@currentTheme`: the orbital's declared theme, else the app's theme key, else the baseline. */
declare function sigilThemeKey(orbitalTheme: OrbitalDefinition['theme'], appThemeKey?: string): string;

export { DEFAULT_THEME_KEY, appNavItems, inlineNavItems, sigilThemeKey };
