/**
 * `resolveDirectChildren` regression: `resolveL2Path` in OrbPreviewNode.tsx
 * used `el.querySelectorAll(':scope > [data-pattern-path]')` to find a
 * container's direct pattern children, on the assumption that the pattern
 * wrappers are DOM-adjacent to the container. In a real render they aren't —
 * the container is itself a `display:contents` wrapper whose actual layout
 * child (the Stack/Grid div UISlotRenderer renders) sits BETWEEN it and its
 * patterns' own wrappers — so `:scope >` matched nothing, `computeInsertionIndex`
 * always got an empty rect list, and every drop resolved to index 0. The fix
 * matches by PATH (`${containerPath}.children.<N>`, no further segments)
 * instead of DOM adjacency, immune to how many layout layers sit in between.
 */
import { describe, it, expect } from 'vitest';
import { directPatternChildren, resolveDirectChildren } from '../../src/lib/resolve-direct-children';

describe('resolveDirectChildren', () => {
  it('returns direct children in path order', () => {
    const candidates = [
      { path: 'root.children.2', ref: 'C' },
      { path: 'root.children.0', ref: 'A' },
      { path: 'root.children.1', ref: 'B' },
    ];
    expect(resolveDirectChildren('root', candidates)).toEqual(['A', 'B', 'C']);
  });

  it('excludes a grandchild (nested container) — its path has an extra segment', () => {
    const candidates = [
      { path: 'root.children.0', ref: 'A' },
      { path: 'root.children.0.children.0', ref: 'A-grandchild' },
      { path: 'root.children.1', ref: 'B' },
    ];
    expect(resolveDirectChildren('root', candidates)).toEqual(['A', 'B']);
  });

  it('excludes candidates under a different container path', () => {
    const candidates = [
      { path: 'root.children.0', ref: 'A' },
      { path: 'other.children.0', ref: 'unrelated' },
    ];
    expect(resolveDirectChildren('root', candidates)).toEqual(['A']);
  });

  it('is immune to DOM adjacency: matches by path regardless of how many extra layout layers sit between the container and its patterns', () => {
    // Mirrors the real bug: `querySelectorAll('[data-pattern-path]')` (ALL
    // descendants, not just direct DOM children) is what the caller now
    // passes in, so an intervening Stack/Grid div (no data-pattern-path of
    // its own) between the container and its patterns changes nothing here.
    const document_ = new DOMParser().parseFromString(
      `<div data-pattern-path="root">
         <div class="real-layout-div">
           <div data-pattern-path="root.children.0">Item A</div>
           <div data-pattern-path="root.children.1">
             Item B
             <div data-pattern-path="root.children.1.children.0">nested inside B</div>
           </div>
           <div data-pattern-path="root.children.2">Item C</div>
         </div>
       </div>`,
      'text/html',
    );
    const container = document_.querySelector('[data-pattern-path="root"]');
    if (!container) throw new Error('fixture container not found');
    const candidates = Array.from(container.querySelectorAll('[data-pattern-path]')).map((el) => ({
      path: el.getAttribute('data-pattern-path') ?? '',
      ref: el.getAttribute('data-pattern-path') ?? '',
    }));
    // 4 elements match `[data-pattern-path]` total (3 direct children + 1
    // grandchild nested inside "Item B") — only the 3 direct children,
    // in order, should survive the filter.
    expect(candidates).toHaveLength(4);
    expect(resolveDirectChildren('root', candidates)).toEqual([
      'root.children.0',
      'root.children.1',
      'root.children.2',
    ]);
  });

  it('ignores an empty or non-numeric trailing segment', () => {
    const candidates = [
      { path: 'root.children.', ref: 'empty-index' },
      { path: 'root.children.abc', ref: 'non-numeric' },
      { path: 'root.children.0', ref: 'A' },
    ];
    expect(resolveDirectChildren('root', candidates)).toEqual(['A']);
  });
});

describe('directPatternChildren (the pattern tree, embedded frames included)', () => {
  /** Builds `<div data-pattern-path=path data-orb-trait=trait>` with an extra layout div in between, like UISlotRenderer. */
  function node(path: string, trait: string, ...children: HTMLElement[]): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-pattern-path', path);
    el.setAttribute('data-orb-trait', trait);
    const layout = document.createElement('div');
    children.forEach((c) => layout.appendChild(c));
    el.appendChild(layout);
    return el;
  }

  it("a container's children are the nearest pattern elements under it — its own nodes and embedded behaviors' frames, in render order", () => {
    const own = node('root.children.0', 'Card', node('root.children.0.children.0', 'Card'));
    const save = node('root', 'SaveButton');
    const help = node('root', 'HelpButton');
    const container = node('root', 'Card', own, save, help);
    expect(directPatternChildren(container)).toEqual([own, save, help]);
  });

  it('an empty container has none', () => {
    expect(directPatternChildren(node('root', 'Card'))).toEqual([]);
  });
});
