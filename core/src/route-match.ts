import { isPageReference, isRoutePage, type OrbitalSchema, type Page } from './types/index.js';
/**
 * Route matching — the one resolver from a concrete path to a declared page
 * pattern (`/appointments/:id`), shared by the UI router, the verifiers and
 * the expectation walker.
 *
 * @packageDocumentation
 */

/**
 * Match a concrete path against a pattern with :param placeholders.
 * Returns null if no match, or the extracted params if match.
 *
 * @example
 * matchPath('/inspection/:id', '/inspection/123') // { id: '123' }
 * matchPath('/users/:userId/posts/:postId', '/users/42/posts/7') // { userId: '42', postId: '7' }
 * matchPath('/about', '/about') // {}
 * matchPath('/about', '/contact') // null
 */
export function matchPath(
  pattern: string,
  path: string
): Record<string, string> | null {
  // Normalize paths - remove trailing slashes, ensure leading slash
  const normalizeSegment = (p: string) => {
    let normalized = p.trim();
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  };

  const normalizedPattern = normalizeSegment(pattern);
  const normalizedPath = normalizeSegment(path);

  const patternParts = normalizedPattern.split('/').filter(Boolean);
  const pathParts = normalizedPath.split('/').filter(Boolean);

  // Must have same number of segments
  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    if (patternPart.startsWith(':')) {
      // This is a param - extract the name and value
      const paramName = patternPart.slice(1);
      params[paramName] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      // Static segment doesn't match
      return null;
    }
  }

  return params;
}

/**
 * Order two route patterns most-specific-first: at the first segment where they
 * disagree in kind, a static segment outranks a `:param`. Patterns that agree in
 * kind everywhere tie, leaving declaration order to decide.
 *
 * Without this, `/listings/:id` declared before `/listings/moderation` swallows
 * its static sibling, because every `:param` matches any segment.
 */
export function comparePathSpecificity(a: string, b: string): number {
  const aParts = a.split('/').filter(Boolean);
  const bParts = b.split('/').filter(Boolean);
  const shared = Math.min(aParts.length, bParts.length);

  for (let i = 0; i < shared; i++) {
    const aParam = aParts[i].startsWith(':');
    const bParam = bParts[i].startsWith(':');
    if (aParam !== bParam) return aParam ? 1 : -1;
  }

  return 0;
}

/**
 * Match a concrete path against route-bearing candidates, most-specific first.
 * The single resolver every route lookup goes through — the candidate array is
 * never reordered in place, so callers keep their declaration-order semantics.
 */
export function matchPathAmong<T>(
  candidates: readonly T[],
  path: string,
  pathOf: (candidate: T) => string | undefined
): { candidate: T; params: Record<string, string> } | null {
  // Rank only the patterns that match: across unrelated patterns the
  // comparator is not transitive, so a whole-list sort could leave
  // `/x/:id` ahead of its static sibling `/x/checkin`.
  let best: { candidate: T; params: Record<string, string>; pattern: string } | null = null;
  for (const candidate of candidates) {
    const pattern = pathOf(candidate);
    if (!pattern) continue;
    const params = matchPath(pattern, path);
    if (params === null) continue;
    if (best === null || comparePathSpecificity(pattern, best.pattern) < 0) {
      best = { candidate, params, pattern };
    }
  }

  return best === null ? null : { candidate: best.candidate, params: best.params };
}

/**
 * The page an app shows when no page matches its route: the first page the program marks `initial`,
 * else the first inline page of the first orbital that declares one. The runtime's navigation
 * default, runtime-verify's boot probe, the catalog and the behavior-value frame all read it.
 */
export function defaultPage(schema: OrbitalSchema): { page: Page; orbitalName: string } | null {
  let first: { page: Page; orbitalName: string } | null = null;
  for (const orbital of schema.orbitals) {
    for (const page of orbital.pages ?? []) {
      if (isPageReference(page) || !isRoutePage(page)) continue;
      if (page.isInitial === true) return { page, orbitalName: orbital.name };
      first ??= { page, orbitalName: orbital.name };
    }
  }
  return first;
}

/**
 * The page an app shows for a path no page matches: the one the program marks `notFound`, else none.
 * The resolver admits at most one per program.
 */
export function notFoundPage(schema: OrbitalSchema): { page: Page; orbitalName: string } | null {
  for (const orbital of schema.orbitals) {
    for (const page of orbital.pages ?? []) {
      if (isPageReference(page) || !isRoutePage(page)) continue;
      if (page.isNotFound === true) return { page, orbitalName: orbital.name };
    }
  }
  return null;
}

/** A concrete path matches a route pattern: same segment count, each pattern segment a `:param` or equal. */
export function pathMatchesPattern(path: string, pattern: string): boolean {
  return matchPath(pattern, path) !== null;
}
