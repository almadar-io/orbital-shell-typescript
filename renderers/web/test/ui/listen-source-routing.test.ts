// @vitest-environment jsdom
/**
 * Listen-source bus routing — the std-api-gateway "Create Route" class.
 *
 * Observed 2026-09-23: buttons whose event is consumed ONLY by a `listens{}`
 * subscriber (the emitter trait declares no transition on the event) do
 * nothing. std-api-gateway's RouteCreate is the canonical shape:
 *
 *   RouteCatalog   — renders the toolbar with the create Button
 *                    (action=CREATE). Declares NO CREATE transition.
 *   RouteCreate    — `listens { RouteCatalog CREATE -> CREATE }`; its CREATE
 *                    transition mounts the "New Route" form.
 *
 * The Button click emits `UI:CREATE` from the InlineButtonRender's subtree;
 * the scope-chain fan-out (R-EMBEDDED-EMIT-BUBBLE) lands it on
 * `UI:RouteOrbital.RouteCatalog.CREATE`. That key has exactly ONE meaning in
 * the circuit: RouteCreate's listen SOURCE. `useBusIngress` — the ONE
 * bus→kernel adapter — only subscribed each trait's own TRANSITION events,
 * so a listen-source key reached no subscription, the kernel never saw the
 * event, and the click was a no-op. (Pre-W5b the god hook's `listen:subscribe`
 * block covered exactly this; the W5b adapter dropped it.)
 *
 * The contract pinned here: a bus emit on a declared listen's source key
 * dispatches the LISTENER trait's `triggers` event through the kernel (one
 * settle, payload mapping applied), so the server-fan-out and the client
 * agree on who runs listen arms.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { OrbitalId, OrbitalSchema, ResolvedTraitBinding } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import { useEventBus } from '../../src/core';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { TEST_STAMP } from '../../src/test-support/kernel-engine';

function gatewayOrbitals(): OrbitalSchema['orbitals'] {
  return [{
    name: 'RouteOrbital',
    id: 'orb_routes' as OrbitalId,
    pages: [{ name: 'Home', path: '/', traits: [{ ref: 'RouteCatalog' }, { ref: 'RouteCreate' }] }],
    entity: { name: 'Route', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }] },
    traits: [
      {
        name: 'RouteCatalog',
        linkedEntity: 'Route',
        stateMachine: {
          states: [{ name: 'browsing', isInitial: true }],
          events: [],
          transitions: [],
        },
      },
      {
        name: 'RouteCreate',
        linkedEntity: 'Route',
        listens: [{ event: 'CREATE', source: { kind: 'trait', trait: 'RouteCatalog' }, triggers: 'CREATE' }],
        stateMachine: {
          states: [{ name: 'closed', isInitial: true }, { name: 'open' }],
          events: [],
          transitions: [
            { from: 'closed', to: 'open', event: 'CREATE', effects: [['set', '@entity.formOpen', true]] },
          ],
        },
      },
    ],
  }];
}

function binding(
  name: string,
  transitions: ResolvedTraitBinding['trait']['transitions'],
  listens?: ResolvedTraitBinding['trait']['listens'],
): ResolvedTraitBinding {
  const trait = createEmptyResolvedTrait(name, 'schema');
  trait.transitions = transitions;
  if (listens !== undefined) trait.listens = listens;
  return { trait, linkedEntity: 'Route' };
}

function stubSlots(): UISlotManager {
  return {
    slots: {},
    render: vi.fn(() => 'id'),
    clear: vi.fn(),
    clearBySource: vi.fn(),
    clearById: vi.fn(),
    clearAll: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    hasContent: vi.fn(() => false),
    getContent: vi.fn(() => null),
    getTraitContent: vi.fn(() => null),
    subscribeTrait: vi.fn(() => () => undefined),
    updateTraitContent: vi.fn(() => 'id'),
  };
}

describe('listen-source bus routing — RouteCatalog.CREATE -> RouteCreate', () => {
  it('a click fanned onto the listen-source key opens the form trait', async () => {
    const slots = stubSlots();
    const orbitals = gatewayOrbitals();
    const bindings = [
      binding('RouteCatalog', []),
      binding('RouteCreate', [
        { from: 'closed', to: 'open', event: 'CREATE', effects: [['set', '@entity.formOpen', true]] },
      ], [{ event: 'CREATE', source: { kind: 'trait', trait: 'RouteCatalog' }, triggers: 'CREATE' }]),
    ];

    let bus!: ReturnType<typeof useEventBus>;
    const { result } = renderHook(() => {
      bus = useEventBus();
      return useTraitStateMachine(bindings, slots, { stamp: TEST_STAMP, orbitals, routePath: '/' });
    });

    // The exact key the Button's scope-chain fan-out produces (the button
    // renders inside RouteCatalog's subtree; RouteCatalog declares no CREATE
    // transition of its own).
    await act(async () => {
      bus.emit('UI:RouteOrbital.RouteCatalog.CREATE', {});
    });

    await vi.waitFor(() => {
      expect(result.current.getTraitState('RouteCreate')?.currentState).toBe('open');
    });
    expect(result.current.entityBindingSource.getEntitySnapshot('RouteCreate')['formOpen']).toBe(true);
  });
});

/**
 * The std-crm New Contact shape: the form trait declares SAVE itself and a persistor
 * `listens { ContactCreate SAVE -> DO_CREATE }`. The kernel's fan-out of the SAVE dispatch delivers the
 * listen, so the listen-source subscription must not deliver it again (every Save persisted two rows).
 */
describe('listen-source bus routing — the emitter declares the event', () => {
  const listens = [{ event: 'SAVE', source: { kind: 'trait' as const, trait: 'ContactCreate' }, triggers: 'DO_CREATE' }];

  function crmOrbitals(formStates: string[], formArm: { from: string; to: string; event: string }): OrbitalSchema['orbitals'] {
    return [{
      name: 'ContactOrbital',
      id: 'orb_contacts' as OrbitalId,
      pages: [{ name: 'Home', path: '/', traits: [{ ref: 'ContactCreate' }, { ref: 'ContactPersistor' }] }],
      entity: { name: 'Contact', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }, { name: 'created', type: 'number', default: 0 }] },
      traits: [
        {
          name: 'ContactCreate',
          linkedEntity: 'Contact',
          stateMachine: { states: formStates.map((name, i) => ({ name, isInitial: i === 0 })), events: [], transitions: [{ ...formArm, effects: [] }] },
        },
        {
          name: 'ContactPersistor',
          linkedEntity: 'Contact',
          listens,
          stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [{ from: 'idle', to: 'idle', event: 'DO_CREATE', effects: [['set', '@entity.created', ['+', '@entity.created', 1]]] }] },
        },
      ],
    }];
  }

  async function saveOnce(formStates: string[], formArm: { from: string; to: string; event: string }): Promise<number> {
    const orbitals = crmOrbitals(formStates, formArm);
    const bindings: ResolvedTraitBinding[] = [
      { ...binding('ContactCreate', [{ ...formArm, effects: [] }]), linkedEntity: 'Contact' },
      { ...binding('ContactPersistor', [{ from: 'idle', to: 'idle', event: 'DO_CREATE', effects: [['set', '@entity.created', ['+', '@entity.created', 1]]] }], listens), linkedEntity: 'Contact' },
    ];
    let bus!: ReturnType<typeof useEventBus>;
    const { result } = renderHook(() => {
      bus = useEventBus();
      return useTraitStateMachine(bindings, stubSlots(), { stamp: TEST_STAMP, orbitals, routePath: '/' });
    });
    await act(async () => {
      bus.emit('UI:ContactOrbital.ContactCreate.SAVE', {});
    });
    await vi.waitFor(() => {
      expect(result.current.entityBindingSource.getEntitySnapshot('ContactPersistor')['created']).toBeGreaterThan(0);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    return Number(result.current.entityBindingSource.getEntitySnapshot('ContactPersistor')['created']);
  }

  it('one Save runs the listener once', async () => {
    expect(await saveOnce(['open'], { from: 'open', to: 'open', event: 'SAVE' })).toBe(1);
  });

  it('edge: the emitter declares the event only in another state — the listener still runs once', async () => {
    expect(await saveOnce(['closed', 'open'], { from: 'open', to: 'closed', event: 'SAVE' })).toBe(1);
  });
});
