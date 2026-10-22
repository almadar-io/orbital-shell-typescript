/**
 * Deterministic page-route slug for an orbital. The plan owns the global
 * route namespace: the primary/landing leg keeps `/`, every other leg is
 * assigned `/<orbital-slug>` so a multi-orbital plan never composes two
 * `path: "/"` pages (the global `PageDuplicatePath` class). The same slug is
 * the compose-time backstop's re-slug target, so guidance and backstop agree.
 *
 * `ExpenseDashboardOrbital` → `expense-dashboard`. The trailing `Orbital`
 * suffix (when present) is dropped to match the trait-dedup prefix convention
 * in `computeCrossOrbitalTraitRenames`.
 */
export function orbitalRouteSlug(orbitalName: string): string {
  return orbitalName
    .replace(/Orbital$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}
