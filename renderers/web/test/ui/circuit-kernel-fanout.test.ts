/**
 * Replaces `commitServerEntityRow.test.ts`, `init-relay-commit-clobber.test.tsx`,
 * `machine-emit-listen-relay.test.tsx`, `listen-relay-server-only-forward.test.tsx`
 * and `server-consumed-echo-payload.test.tsx` (deleted with the hook body
 * that made them necessary — W5b, `docs/Almadar_Runtime_Stateless_Stateful_PLAN.md`
 * §5.1). Each of those tested a hand-rolled bus-relay mechanism
 * (`commitServerEntityRow`'s sibling publish, the qualified/bare listen
 * subscriptions, `stampLocallyDeliveredEchoes`) that no longer exists in
 * `@almadar/ui` — the composition (`@almadar/runtime`'s `evaluateOrbitalEvent`
 * + client role) owns cross-trait `listens` delivery, sibling row fan-out
 * (G-RUNTIME-026/027) and echo/already-delivered tracking now, and each is
 * already covered by that package's own suite (`client-kernel.test.ts`'s
 * "G5 sibling rows" describe block, `evaluateOrbitalEvent`'s listens tests).
 *
 * What's left to prove from `@almadar/ui`'s side is narrower and more
 * useful: that `useCircuitKernel` — the ONE new seam between this package
 * and the runtime's client role — wires a real dispatch through to a
 * sibling trait's frame and to a cross-trait `listens` subscriber, with no
 * `@almadar/ui`-local relay code in the path at all.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { OrbitalId, OrbitalSchema } from '@almadar/core';
import { useCircuitKernel } from '../../src/hooks/circuit/useCircuitKernel';
import { ENGINES } from '../../src/test-support/kernel-engine';

function fixtureOrbitals(): OrbitalSchema['orbitals'] {
  return [
    {
      name: 'FanoutOrbital',
      id: 'orb_fanout' as OrbitalId,
      pages: [],
      entity: {
        name: 'Board',
        persistence: 'runtime',
        fields: [
          { name: 'id', type: 'string' },
          { name: 'points', type: 'string' },
        ],
      },
      traits: [
        {
          name: 'Writer',
          linkedEntity: 'Board',
          scope: 'instance',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [],
            transitions: [
              {
                from: 'idle', to: 'idle', event: 'COMPUTE',
                effects: [
                  ['set', '@entity.points', '@payload.points'],
                  ['emit', 'POINTS_READY'],
                ],
              },
            ],
          },
        },
        // A non-`[shared]` sibling bound to the SAME `linkedEntity` — the
        // G-RUNTIME-026/027 shape: its own frame must see Writer's write.
        {
          name: 'Chart',
          linkedEntity: 'Board',
          scope: 'instance',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }, { name: 'listened' }],
            events: [],
            transitions: [
              { from: 'idle', to: 'listened', event: 'RENDER', effects: [] },
            ],
          },
          listens: [{ event: 'POINTS_READY', triggers: 'RENDER', source: { kind: 'trait', trait: 'Writer' } }],
        },
      ],
    },
  ];
}

describe.each(ENGINES)('useCircuitKernel [%s engine] — cross-trait dispatch through the client role (no ui-local relay)', (_name, engine) => {
  it('a listens{} subscriber transitions from the SAME kernel.dispatch call that produced its trigger', async () => {
    const orbitals = fixtureOrbitals();
    const bindings = [
      { trait: { name: 'Writer', id: undefined, states: [{ name: 'idle' }], events: [], transitions: [{ from: 'idle', to: 'idle', event: 'COMPUTE' }], guards: [], ticks: [], listens: [], emits: [], source: 'schema' } },
      { trait: { name: 'Chart', id: undefined, states: [{ name: 'idle' }, { name: 'listened' }], events: [], transitions: [{ from: 'idle', to: 'listened', event: 'RENDER' }], guards: [], ticks: [], listens: [{ event: 'POINTS_READY', triggers: 'RENDER', source: { kind: 'trait', trait: 'Writer' } }], emits: [], source: 'schema' } },
    ] as never;

    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals, engine }));

    await act(async () => {
      await result.current.kernel.dispatch({ event: 'COMPUTE', payload: { points: '[1,2,3]' }, targetTrait: 'Writer' });
    });

    // The listener transitioned — no bus round-trip, no `@almadar/ui` relay
    // code involved; `evaluateOrbitalEvent`'s own in-band fan-out did it.
    expect(result.current.store.states.getState('Chart')?.currentState).toBe('listened');
    // Sibling fan-out: Chart's own frame (same `linkedEntity`, non-shared —
    // frameKey is its own name) is untouched by Writer's LOCAL write (that
    // fan-out is `applyOrbitalEventResponse`'s job, a SERVER-response
    // concern — see the plan's residual-gap note for the pure-local case);
    // Writer's own frame carries the write.
    expect(result.current.store.frames.get('Writer')?.points).toBe('[1,2,3]');
  });
});
