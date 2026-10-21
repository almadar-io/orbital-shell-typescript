/**
 * Navigation-stack core — the pure logic behind the orbital-scoped
 * client-session navigation stack both execution paths share.
 *
 * The stack is what detail-page breadcrumb bands and the `navigate-back`
 * effect read. It lives client-side only (per browser tab): the runtime
 * path's OrbPreview and the compiled app's App.tsx both mount
 * `NavStackProvider` (providers/NavStackContext.tsx), which drives this
 * module on every route change.
 *
 * Semantics (deterministic):
 * - One stack per ORBITAL, keyed by the orbital owning the current page.
 * - On route change: an entry with the same href already in the stack
 *   truncates back to it (revisit); otherwise the new entry is pushed.
 * - Cold load (deep link): the stack seeds from the declared page-path
 *   hierarchy — every declared page whose pattern matches a strict prefix
 *   of the concrete path becomes an ancestor entry — so the trail is never
 *   empty and back always has a target on nested paths.
 * - Entry label = the `crumb` carried by the navigate effect when one was
 *   staged for this href, else the page's declared label, else its name as written.
 */

import type { NavStackEntry } from "@almadar/core";
import { matchPathAmong, matchPath } from "../providers/navigation";

/** One declared page as the nav stack needs it: path pattern + name + owning orbital + declared label. */
export interface NavPageDecl {
  path: string;
  name: string;
  orbital: string;
  /** Declared nav label (`@label`); absent = the page name as written. */
  label?: string;
}

/** Per-orbital stacks. */
export type NavStackState = Record<string, NavStackEntry[]>;

/** Crumb staged by a `(navigate … { crumb })` effect, consumed by the next sync. */
export interface PendingCrumb {
  href: string;
  crumb: string;
}

/** A page's entry label: its declared label, else the declared navItem label for it, else its name as written (never derived). */
export function pageEntryLabel(page: NavPageDecl, navLabels?: NavItemLabels): string {
  return page.label ?? navLabels?.[page.path] ?? page.name;
}

/** Declared navItem labels keyed by the page path each item's href resolves to. */
export type NavItemLabels = Readonly<Record<string, string>>;

/** A declared navigation item (the app shell's `navItems`), children included. */
export interface NavItemDecl {
  href: string;
  label: string;
  children?: readonly NavItemDecl[];
}

/** Map every navItem (children too) to the declared page its href resolves to; hrefs matching no page are skipped. */
export function navLabelsFromItems(
  pages: readonly NavPageDecl[],
  items: readonly NavItemDecl[],
): Record<string, string> {
  const labels: Record<string, string> = {};
  const visit = (list: readonly NavItemDecl[]) => {
    for (const item of list) {
      const page = matchNavPage(pages, item.href);
      if (page && item.label) labels[page.path] = item.label;
      if (item.children) visit(item.children);
    }
  };
  visit(items);
  return labels;
}

/**
 * Entries whose label is still their page's own fallback (declared label or
 * name) take the page's navItem label; a staged record crumb is left alone.
 */
export function resolveEntryLabels(
  entries: readonly NavStackEntry[],
  pages: readonly NavPageDecl[],
  navLabels: NavItemLabels,
): readonly NavStackEntry[] {
  let changed = false;
  const resolved = entries.map((entry) => {
    const page = matchNavPage(pages, entry.href);
    if (!page || entry.label !== pageEntryLabel(page)) return entry;
    const label = pageEntryLabel(page, navLabels);
    if (label === entry.label) return entry;
    changed = true;
    return { ...entry, label };
  });
  return changed ? resolved : entries;
}

function normalizePath(p: string): string {
  let normalized = p.trim();
  if (!normalized.startsWith("/")) normalized = "/" + normalized;
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** The page a concrete path resolves to (specificity-ranked), or null. */
export function matchNavPage(
  pages: readonly NavPageDecl[],
  path: string,
): NavPageDecl | null {
  const hit = matchPathAmong(pages, path, (p) => p.path);
  return hit ? hit.candidate : null;
}

/**
 * Ancestor entries for a concrete path, from the declared page hierarchy:
 * for each strict prefix of the path's segments, the declared page whose
 * pattern matches that prefix (specificity-ranked), ordered root-first.
 */
function seedAncestors(
  pages: readonly NavPageDecl[],
  path: string,
): NavStackEntry[] {
  const segments = normalizePath(path).split("/").filter(Boolean);
  const ancestors: NavStackEntry[] = [];
  for (let depth = 1; depth < segments.length; depth++) {
    const prefix = "/" + segments.slice(0, depth).join("/");
    const page = matchNavPage(pages, prefix);
    if (page) {
      ancestors.push({ href: prefix, label: pageEntryLabel(page) });
    }
  }
  return ancestors;
}

/**
 * Fold a route change into the stack state. Returns the next state plus the
 * orbital owning the current path (`null` when no declared page matches —
 * e.g. /login — in which case the state is returned unchanged).
 */
export function syncNavStack(
  state: NavStackState,
  pages: readonly NavPageDecl[],
  path: string,
  pending: PendingCrumb | null,
): { state: NavStackState; orbital: string | null } {
  const normalized = normalizePath(path);
  const page = matchNavPage(pages, normalized);
  if (!page) return { state, orbital: null };

  const label =
    pending && normalizePath(pending.href) === normalized
      ? pending.crumb
      : pageEntryLabel(page);

  const prior = state[page.orbital];
  const stack: NavStackEntry[] =
    prior && prior.length > 0 ? [...prior] : seedAncestors(pages, normalized);

  const existing = stack.findIndex((e) => e.href === normalized);
  if (existing >= 0) {
    stack.length = existing + 1;
    if (pending && normalizePath(pending.href) === normalized) {
      stack[existing] = { href: normalized, label };
    }
  } else {
    stack.push({ href: normalized, label });
  }

  return { state: { ...state, [page.orbital]: stack }, orbital: page.orbital };
}

/**
 * Relabel the entry for the current path — the loaded record's real title
 * replacing the page-name fallback (`Contract Detail` → the contract's
 * title). Fed by DetailPanel when it renders a resolved record in the
 * routed main slot, so cold loads and refreshes read like in-app pushes.
 * Returns the same state object when nothing changes (no page match, or
 * the label already equals `label`) so callers can skip re-renders.
 */
export function relabelCurrent(
  state: NavStackState,
  pages: readonly NavPageDecl[],
  path: string,
  label: string,
): NavStackState {
  const normalized = normalizePath(path);
  const page = matchNavPage(pages, normalized);
  if (!page || !label) return state;
  const stack = state[page.orbital];
  if (!stack || stack.length === 0) return state;
  const idx = stack.findIndex((e) => e.href === normalized);
  if (idx < 0 || stack[idx].label === label) return state;
  const next = [...stack];
  next[idx] = { href: normalized, label };
  return { ...state, [page.orbital]: next };
}

/**
 * The previous entry for the current path's orbital — the `navigate-back`
 * target — or null when the stack holds no earlier entry (top-level page).
 */
export function previousEntry(
  state: NavStackState,
  pages: readonly NavPageDecl[],
  path: string,
): NavStackEntry | null {
  const page = matchNavPage(pages, normalizePath(path));
  if (!page) return null;
  const stack = state[page.orbital] ?? [];
  return stack.length >= 2 ? stack[stack.length - 2] : null;
}

/** Entries for the current path's orbital (empty when no page matches). */
export function entriesFor(
  state: NavStackState,
  pages: readonly NavPageDecl[],
  path: string,
): readonly NavStackEntry[] {
  const page = matchNavPage(pages, normalizePath(path));
  if (!page) return [];
  return state[page.orbital] ?? [];
}

/** Re-exported so provider code needs no second import site. */
export { matchPath };
