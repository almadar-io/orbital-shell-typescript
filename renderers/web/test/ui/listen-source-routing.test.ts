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
import type { OrbitalId, OrbitalSchema } from '@almadar/core';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import { useCircuitKernel } from '../../src/hooks/circuit/useCircuitKernel';
import { machineReady } from '../../src/test-support/circuit';
import { useEventBus } from '../../src/core';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { ENGINES, TEST_STAMP } from '../../src/test-support/kernel-engine';
import { circuitReady } from '../../src/test-support/circuit';

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
    let bus!: ReturnType<typeof useEventBus>;
    const { result } = renderHook(() => {
      bus = useEventBus();
      return useTraitStateMachine(slots, { stamp: TEST_STAMP, orbitals, routePath: '/' });
    });

    // The exact key the Button's scope-chain fan-out produces (the button
    // renders inside RouteCatalog's subtree; RouteCatalog declares no CREATE
    // transition of its own).
    await machineReady(result);
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
    let bus!: ReturnType<typeof useEventBus>;
    const { result } = renderHook(() => {
      bus = useEventBus();
      return useTraitStateMachine(stubSlots(), { stamp: TEST_STAMP, orbitals, routePath: '/' });
    });
    await machineReady(result);
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

/**
 * Twin of orbital-core `a_listen_source_dispatch_delivers_the_listener_with_the_states_the_web_shell_gets`
 * (client/client_kernel/tests.rs): the same program, the same dispatch, the same literal answer. The web shell routes
 * nothing; the delivery is whatever the kernel answers, and the Rust host's kernel answers the same.
 */
describe.each(ENGINES)('listen-source delivery is the kernel\'s answer [%s engine] — twin of the Rust host', (_name, engine) => {
  it('dispatching the source answers the listener\'s delivery: RouteCatalog browsing, RouteCreate open', async () => {
    const { result } = renderHook(() => useCircuitKernel({ stamp: TEST_STAMP, orbitals: gatewayOrbitals(), engine }));
    await circuitReady(result);
    let answer!: Awaited<ReturnType<typeof result.current.kernel.dispatch>>;
    await act(async () => {
      answer = await result.current.kernel.dispatch({ event: 'CREATE', targetTrait: 'RouteCatalog' });
    });
    expect(answer.response.transitioned).toBe(true);
    expect(Object.entries(answer.response.states).sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ['RouteCatalog', 'browsing'],
      ['RouteCreate', 'open'],
    ]);
  });

  it('control: an event nobody listens to delivers nothing', async () => {
    const { result } = renderHook(() => useCircuitKernel({ stamp: TEST_STAMP, orbitals: gatewayOrbitals(), engine }));
    await circuitReady(result);
    let answer!: Awaited<ReturnType<typeof result.current.kernel.dispatch>>;
    await act(async () => {
      answer = await result.current.kernel.dispatch({ event: 'UNRELATED', targetTrait: 'RouteCatalog' });
    });
    expect(answer.response.transitioned).toBe(false);
    expect(answer.response.states['RouteCreate'] ?? 'closed').toBe('closed');
  });
});
