/**
 * The build's dedupe-providers plugin rewrites every relative import of a
 * top-level providers/* module to the `@almadar/ui/providers` entry. A runtime
 * export that providers/index.ts does not re-export therefore builds fine and
 * then fails at module load ("does not provide an export named …"). Keep the
 * barrel complete so that failure is caught here instead.
 */
import { describe, it, expect } from 'vitest';
import * as barrel from '../index';

const modules = import.meta.glob<Record<string, unknown>>('../*.{ts,tsx}', { eager: true });

// Routed to @almadar/ui/context by their own dedupe plugins, not this barrel.
const OWNED_ELSEWHERE = /\/(ThemeContext|UISlotContext|DesignThemeContext|index)\.tsx?$/;

describe('providers barrel', () => {
  const entries = Object.entries(modules).filter(([path]) => !OWNED_ELSEWHERE.test(path));
  // Re-exports of a context-owned symbol resolve through @almadar/ui/context.
  const ownedElsewhere = new Set(
    Object.entries(modules)
      .filter(([path]) => OWNED_ELSEWHERE.test(path) && !path.endsWith('/index.ts'))
      .flatMap(([, mod]) => Object.values(mod)),
  );

  it('covers at least the known provider modules', () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it.each(entries.map(([path, mod]) => [path, mod] as const))('%s is fully re-exported', (path, mod) => {
    // A default export can never be reached through a named-import barrel.
    const missing = Object.entries(mod)
      .filter(([name, value]) => name !== 'default' && !ownedElsewhere.has(value) && !(name in barrel))
      .map(([name]) => name);
    expect(missing, `${path} exports not in providers/index.ts`).toEqual([]);
  });
});
