/**
 * Filters an arbitrary set of `[data-pattern-path]` descendants down to the
 * DIRECT children of `containerPath` — paths shaped
 * `${containerPath}.children.<N>` with no further segments — sorted by `N`.
 *
 * Pulled out of `OrbPreviewNode`'s `resolveL2Path` as a pure function: the
 * container element is itself a `display:contents` wrapper (UISlotRenderer's
 * `slot-content contents`), so its REAL layout child (the Stack/Grid div it
 * renders) sits between it and its patterns' own wrappers — `:scope >
 * [data-pattern-path]` therefore matches nothing on a container with
 * rendered children, silently yielding an empty rect list downstream
 * (`computeInsertionIndex` then always returns 0). Matching by PATH instead
 * of DOM adjacency is immune to how many layout layers sit in between —
 * the same address scheme the e2e helpers' `readContainerChildren` uses.
 */
export function resolveDirectChildren<T>(
  containerPath: string,
  candidates: readonly { path: string; ref: T }[],
): T[] {
  const prefix = `${containerPath}.children.`;
  return candidates
    .reduce<{ index: number; ref: T }[]>((acc, { path, ref }) => {
      if (!path.startsWith(prefix)) return acc;
      const rest = path.slice(prefix.length);
      if (!rest || rest.includes('.')) return acc;
      const index = Number(rest);
      if (Number.isFinite(index)) acc.push({ index, ref });
      return acc;
    }, [])
    .sort((a, b) => a.index - b.index)
    .map(({ ref }) => ref);
}

/**
 * A container element's direct children in the pattern tree: the nearest
 * `[data-pattern-path]` elements under it, in render order. Unlike paths
 * (which restart at every embedded behavior's own root), this includes the
 * frames of behaviors embedded in the container's children, and it sees
 * through the layout layers between a wrapper and its patterns.
 */
export function directPatternChildren(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-pattern-path]')).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.parentElement?.closest('[data-pattern-path]') === container,
  );
}
