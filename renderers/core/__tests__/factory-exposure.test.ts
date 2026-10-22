/**
 * Owner 2026-10-06: a user-facing `experience` organism per app domain is pickable as the app, beside
 * the `app` (admin/back-office) organism; atoms keep `palette` / `both` / `internal`.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { FactoryExposure } from '../src/factory/types.js';

describe('FactoryExposure', () => {
  it('admits the experience surface', () => {
    expectTypeOf<'experience'>().toMatchTypeOf<FactoryExposure>();
  });

  it('control: still a closed set — an unknown surface is not an exposure', () => {
    expectTypeOf<'admin'>().not.toMatchTypeOf<FactoryExposure>();
  });
});
