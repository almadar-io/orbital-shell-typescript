/**
 * An app's dependency graph, read from what its program records: each orbital's
 * `uses` imports, then every behavior they reach with its own imports, each placed
 * in its layer.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { OrbitalSchema } from './types/schema.js';

/** Which package owns a behavior: the public substrate (`@almadar/std`), its realization (`@almadar-io/behaviors`), or neither registry. */
export type BehaviorTier = 'std' | 'io' | 'unknown';

/** Where a behavior sits upstream of an app: an io realization, a std behavior, a std UI primitive (a registry `pattern` factory), or outside both registries. */
export type DependencyLayer = 'io' | 'std' | 'primitive' | 'unknown';

/**
 * One `uses Alias from "…"` of an orbital, as its program records it: the behavior it
 * resolves to (the path's trailing name, as the compiler resolves it), that behavior's
 * tier, and the traits composed from it (`ref: "<Alias>.traits.<T>"`).
 */
export interface BehaviorImport {
  as: string;
  from: string;
  behavior: string;
  tier: BehaviorTier;
  traits: ReadonlyArray<{ name: string; ref: string }>;
}

/** Each orbital's direct imports, and every behavior reached with its layer and its own imports. */
export interface DependencyGraph {
  orbitals: Record<string, readonly string[]>;
  behaviors: Record<string, { layer: DependencyLayer; imports: readonly string[] }>;
}

export const DependencyGraphSchema = z.object({
  orbitals: z.record(z.string(), z.array(z.string())),
  behaviors: z.record(z.string(), z.object({ layer: z.enum(['io', 'std', 'primitive', 'unknown']), imports: z.array(z.string()) })),
}) satisfies z.ZodType<DependencyGraph>;

/** How `dependencyGraphOf` reads the installed behaviors. */
export interface DependencyGraphDeps {
  tierOf: (name: string) => BehaviorTier;
  /** The behavior's own program, or null when none is installed. */
  orbOf: (name: string) => OrbitalSchema | null;
  /** The UI pattern a behavior is the factory of, if any. */
  patternOf: (name: string) => string | undefined;
}

/**
 * A program's imports as edges: each `uses {as, from}` resolved to its behavior by
 * the path's trailing name (the compiler's loader rule), that behavior's tier, and the
 * traits composed from it (`ref: "<as>.traits.<T>"`). Own traits carry no `ref`.
 */
export function importsOf(schema: OrbitalSchema, tierOf: (name: string) => BehaviorTier): BehaviorImport[] {
  return schema.orbitals.flatMap((orbital) =>
    (orbital.uses ?? []).map((use) => {
      const behavior = use.from.slice(use.from.lastIndexOf('/') + 1);
      const prefix = `${use.as}.traits.`;
      const traits = (orbital.traits ?? []).flatMap((t) =>
        typeof t === 'object' && 'ref' in t && t.ref.startsWith(prefix)
          ? [{ name: t.name ?? t.ref.slice(prefix.length), ref: t.ref }]
          : [],
      );
      return { as: use.as, from: use.from, behavior, tier: tierOf(behavior), traits };
    }),
  );
}

/**
 * Each orbital's direct imports, then every behavior reached, once, with its own
 * imports from its program and its layer: a `pattern` factory is a UI primitive,
 * otherwise its tier.
 */
export function dependencyGraphOf(schema: OrbitalSchema, deps: DependencyGraphDeps): DependencyGraph {
  const unique = (s: OrbitalSchema): string[] => [...new Set(importsOf(s, deps.tierOf).map((i) => i.behavior))];
  const orbitals = Object.fromEntries(schema.orbitals.map((o) => [o.name, unique({ ...schema, orbitals: [o] })]));
  const behaviors: Record<string, { layer: DependencyLayer; imports: readonly string[] }> = {};
  const queue = Object.values(orbitals).flat();
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || behaviors[name]) continue;
    const orb = deps.orbOf(name);
    const imports = orb ? unique(orb) : [];
    behaviors[name] = { layer: deps.patternOf(name) !== undefined ? 'primitive' : deps.tierOf(name), imports };
    queue.push(...imports);
  }
  return { orbitals, behaviors };
}
