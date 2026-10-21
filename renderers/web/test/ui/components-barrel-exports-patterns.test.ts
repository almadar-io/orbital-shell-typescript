/**
 * Every render-ui pattern the compiler can emit is imported from `@almadar/ui/components`
 * (the pattern registry's one import path). The drawable patterns listed in
 * `components/game/patterns.ts` were registered as patterns but missing from that barrel,
 * so a compiled app using `draw-shape` / `draw-fx-layer` failed to import them.
 */
import { describe, expect, it } from 'vitest';
import * as barrel from '../../src/components';
import * as drawables from '../../src/components/game/patterns';

describe('the components barrel', () => {
  it('exports every drawable pattern component', () => {
    const missing = Object.keys(drawables).filter((name) => !(name in barrel));
    expect(missing).toEqual([]);
  });

  it('control: a core pattern is exported', () => {
    expect('Canvas' in barrel).toBe(true);
  });
});
