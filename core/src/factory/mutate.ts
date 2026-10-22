import type { EntityField } from '../types/field.js';
import type { TraitReference } from '../types/trait.js';
import type { EntityPersistence } from '../types/entity.js';
import type { RuleOverlay, RuleOverlayEntry } from './overlays.js';
import type { FactoryParamValue } from './types.js';

/**
 * One slot the agent emits per orbital. Slim shape — agent-facing,
 * carries only what factory dispatch needs. The studio renders forms
 * over this; the projector turns it into a `FactoryCallSite`.
 */
export interface OrbitalCallInput {
  orbitalName: string;
  organism?: string;
  orbital?: string;
  entityName?: string;
  entityFields?: ReadonlyArray<EntityField>;
  persistence?: EntityPersistence;
  collection?: string;
  pagePaths?: Readonly<Record<string, string>>;
  traitOverlay?: Readonly<
    Record<
      string,
      {
        config?: Readonly<Record<string, FactoryParamValue>>;
        linkedEntity?: string;
        name?: string;
      }
    >
  >;
  extraTraits?: ReadonlyArray<TraitReference>;
}

/**
 * Discriminated union of typed edits. Each variant carries only the
 * payload pieces that change. The reducer is total over the union.
 */
export type FactoryCallPlanMutation =
  | {
      kind: 'set-orbital-entity-fields';
      orbitalName: string;
      fields: ReadonlyArray<EntityField>;
    }
  | { kind: 'set-orbital-entity-name'; orbitalName: string; name: string }
  | {
      kind: 'set-orbital-persistence';
      orbitalName: string;
      persistence: EntityPersistence;
    }
  | { kind: 'set-orbital-collection'; orbitalName: string; collection: string }
  | {
      kind: 'set-orbital-page-path';
      orbitalName: string;
      pageName: string;
      path: string;
    }
  | {
      kind: 'set-trait-override-config';
      orbitalName: string;
      traitName: string;
      key: string;
      value: FactoryParamValue;
    }
  | {
      kind: 'add-extra-trait';
      orbitalName: string;
      trait: TraitReference;
    }
  | { kind: 'remove-extra-trait'; orbitalName: string; ref: string }
  | { kind: 'set-rule'; rule: RuleOverlayEntry }
  | { kind: 'remove-rule'; ruleId: string };

/**
 * State shape the reducer operates on. Mirrors the slice of the
 * agent's analysis result that incremental edits target.
 */
export interface FactoryCallPlanState {
  orbitals: ReadonlyArray<OrbitalCallInput>;
  ruleOverlay?: RuleOverlay;
}

/**
 * Immutable reducer. Returns a new state; never mutates input.
 */
export function applyFactoryCallPlanMutation(
  state: FactoryCallPlanState,
  m: FactoryCallPlanMutation,
): FactoryCallPlanState {
  switch (m.kind) {
    case 'set-orbital-entity-fields':
      return patchOrbital(state, m.orbitalName, (o) => ({
        ...o,
        entityFields: m.fields,
      }));
    case 'set-orbital-entity-name':
      return patchOrbital(state, m.orbitalName, (o) => ({
        ...o,
        entityName: m.name,
      }));
    case 'set-orbital-persistence':
      return patchOrbital(state, m.orbitalName, (o) => ({
        ...o,
        persistence: m.persistence,
      }));
    case 'set-orbital-collection':
      return patchOrbital(state, m.orbitalName, (o) => ({
        ...o,
        collection: m.collection,
      }));
    case 'set-orbital-page-path':
      return patchOrbital(state, m.orbitalName, (o) => ({
        ...o,
        pagePaths: { ...(o.pagePaths ?? {}), [m.pageName]: m.path },
      }));
    case 'set-trait-override-config':
      return patchOrbital(state, m.orbitalName, (o) => {
        const overlay = o.traitOverlay ?? {};
        const existing = overlay[m.traitName] ?? {};
        const existingConfig = existing.config ?? {};
        return {
          ...o,
          traitOverlay: {
            ...overlay,
            [m.traitName]: {
              ...existing,
              config: { ...existingConfig, [m.key]: m.value },
            },
          },
        };
      });
    case 'add-extra-trait':
      return patchOrbital(state, m.orbitalName, (o) => {
        const existing = o.extraTraits ?? [];
        if (existing.some((t) => t.ref === m.trait.ref)) return o;
        return { ...o, extraTraits: [...existing, m.trait] };
      });
    case 'remove-extra-trait':
      return patchOrbital(state, m.orbitalName, (o) => ({
        ...o,
        extraTraits: (o.extraTraits ?? []).filter((t) => t.ref !== m.ref),
      }));
    case 'set-rule': {
      const rules = state.ruleOverlay?.rules ?? [];
      const idx = rules.findIndex((r) => r.id === m.rule.id);
      const next = idx >= 0
        ? rules.map((r, i) => (i === idx ? m.rule : r))
        : [...rules, m.rule];
      return {
        ...state,
        ruleOverlay: { ...(state.ruleOverlay ?? { rules: [] }), rules: next },
      };
    }
    case 'remove-rule': {
      const rules = state.ruleOverlay?.rules ?? [];
      const next = rules.filter((r) => r.id !== m.ruleId);
      return {
        ...state,
        ruleOverlay: { ...(state.ruleOverlay ?? { rules: [] }), rules: next },
      };
    }
  }
}

function patchOrbital(
  state: FactoryCallPlanState,
  orbitalName: string,
  patch: (o: OrbitalCallInput) => OrbitalCallInput,
): FactoryCallPlanState {
  return {
    ...state,
    orbitals: state.orbitals.map((o) =>
      o.orbitalName === orbitalName ? patch(o) : o,
    ),
  };
}
