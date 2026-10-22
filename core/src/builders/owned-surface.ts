import type { JsonValue } from '../types/index.js';

/**
 * Collect the page paths and trait names an orbital's `.orb` owns. Shared by
 * rabit's delete-turn dangling-ref cleanup and
 * compose-time nav narrowing (`compose-app.ts`) — one walker,
 * two consumers, so the page↔orbital ownership map never drifts between them.
 */
export function collectOwnedSurface(node: JsonValue, pages: Set<string>, traits: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectOwnedSurface(item, pages, traits);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const pagesField = node['pages'];
  if (Array.isArray(pagesField)) {
    for (const p of pagesField) {
      if (p !== null && typeof p === 'object' && !Array.isArray(p) && typeof p['path'] === 'string') {
        pages.add(p['path']);
      }
    }
  }
  const traitsField = node['traits'];
  if (Array.isArray(traitsField)) {
    for (const t of traitsField) {
      if (t !== null && typeof t === 'object' && !Array.isArray(t) && typeof t['name'] === 'string') {
        traits.add(t['name']);
      }
    }
  }
  for (const value of Object.values(node)) collectOwnedSurface(value, pages, traits);
}

/**
 * The inverse walker: references in a SURVIVING orbital that point at a
 * deleted orbital's surface. Two kinds, and only two — a `navigate` to a page
 * the deleted orbital owned, and a `listens` entry sourced from one of its
 * traits that the survivor does not own itself.
 *
 * Lives beside `collectOwnedSurface` for the same reason that one does: it has
 * two consumers now (`collectDeleteCleanupEdits` in the coordinator, and the
 * e2e delete-cascade case, which has to find an orbital worth deleting before
 * it can test the cleanup). A second copy would answer a slightly different
 * question and quietly test nothing — measured: a substring-matching stand-in
 * reported 7–14 "references" per orbital on an organism where these rules find
 * zero.
 */
export function findDanglingRefs(
  node: JsonValue,
  deletedPages: ReadonlySet<string>,
  deletedTraits: ReadonlySet<string>,
  ownTraits: ReadonlySet<string>,
  out: Set<string>,
): void {
  if (Array.isArray(node)) {
    if (node[0] === 'navigate' && typeof node[1] === 'string' && deletedPages.has(node[1])) {
      out.add(`navigate "${node[1]}" targets a deleted orbital's page`);
    }
    for (const item of node) findDanglingRefs(item, deletedPages, deletedTraits, ownTraits, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const source = node['source'];
  if (
    source !== null &&
    typeof source === 'object' &&
    !Array.isArray(source) &&
    source['kind'] === 'trait' &&
    typeof source['trait'] === 'string' &&
    deletedTraits.has(source['trait']) &&
    !ownTraits.has(source['trait'])
  ) {
    out.add(`a listens entry is sourced from deleted trait "${source['trait']}"`);
  }
  for (const value of Object.values(node)) {
    findDanglingRefs(value, deletedPages, deletedTraits, ownTraits, out);
  }
}
