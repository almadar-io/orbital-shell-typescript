/**
 * Every host renders the canvas from `@almadar/ui/index.css` alone, so it carries React Flow's base
 * styles itself: without them nodes are `position: static` and the background grid stacks over the
 * cards, swallowing every click on the canvas. They load before ui's own React Flow overrides.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dirname, '..', 'index.css'), 'utf8');
const xyflow = "@import '@xyflow/react/dist/style.css';";

describe('@almadar/ui/index.css and React Flow', () => {
  it('imports React Flow\'s stylesheet', () => {
    expect(css).toContain(xyflow);
  });

  it('imports it before ui\'s React Flow control overrides, so the overrides win', () => {
    expect(css.indexOf(xyflow)).toBeGreaterThanOrEqual(0);
    expect(css.indexOf(xyflow)).toBeLessThan(css.indexOf('.react-flow__controls {'));
  });

  it('control: every @import precedes the first rule (CSS ignores a late @import)', () => {
    const firstRule = css.search(/^[^@\s/*][^\n]*\{/m);
    const lastImport = css.lastIndexOf('@import');
    expect(lastImport).toBeLessThan(firstRule);
  });
});
