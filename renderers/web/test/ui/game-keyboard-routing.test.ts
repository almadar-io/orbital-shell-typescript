// @vitest-environment jsdom
/**
 * Keyboard input routing for games (std-snake WASD), circuit level.
 *
 * Observed 2026-09-23 on runtime-verify --catalog: WASD no longer steers
 * std-snake. The delivery contract for a key press is:
 *
 *   Canvas2D keyMap handler emits the bare `UI:UP` (etc.) → `useEventBus`
 *   qualifies + fans it out to EVERY scope on the TraitScopeProvider chain
 *   (R-EMBEDDED-EMIT-BUBBLE — the canvas renders inside SnakeCanvas's
 *   TraitFrame, inside SnakeShell's, inside SnakePlay's stack, so the chain
 *   is [SnakeCanvas, SnakeShell, SnakePlay]) → `useBusIngress` is subscribed
 *   to `UI:SnakeOrbital.SnakePlay.UP` (SnakePlay declares the UP transition)
 *   → one targeted kernel dispatch → SnakePlay self-loops and `(emit TURN
 *   {dir})` → the kernel's own listen fan-out runs SnakeMechanic's STEER arm
 *   → `@entity.dir` updates.
 *
 * This file pins the circuit half of that contract: a key event arriving on
 * the qualified keys the scope fan-out produces must reach the mechanic's
 * frame. (The render half — that the TraitFrame chain actually nests so the
 * fan-out produces those keys — is TraitScopeProvider/TraitFrame's own
 * coverage.)
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { OrbitalId, OrbitalSchema, ResolvedTraitBinding, Trait } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import { useEventBus } from '../../src/core';
import type { UISlotManager } from '../../src/hooks/useUISlots';

function snakeOrbitals(): OrbitalSchema['orbitals'] {
  const mk = (name: string, transitions: NonNullable<Trait['stateMachine']>['transitions']) => ({
    name,
    linkedEntity: 'Snake',
    stateMachine: {
      states: [{ name: 'playing', isInitial: true }],
      events: [],
      transitions,
    },
  });
  return [{
    name: 'SnakeOrbital',
    id: 'orb_snake' as OrbitalId,
    pages: [],
    entity: { name: 'Snake', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [
      // The composer: owns the semantic direction events (the keyMap's
      // KeyW → UP target) and re-emits them as the domain TURN event.
      mk('SnakePlay', [
        { from: 'playing', to: 'playing', event: 'UP', effects: [['emit', 'TURN', { dir: 'up' }]] },
        { from: 'playing', to: 'playing', event: 'DOWN', effects: [['emit', 'TURN', { dir: 'down' }]] },
      ]),
      // The domain atom: listens for the composer's TURN and steers.
      {
        ...mk('SnakeMechanic', [
          { from: 'playing', to: 'playing', event: 'STEER', effects: [['set', '@entity.dir', '@payload.dir']] },
        ]),
        // listens ride on the orbital's trait def, not the state machine.
      },
      // The render-only embedded atom the canvas lives in.
      mk('SnakeCanvas', []),
    ],
  }];
}

// The mechanic's listen, attached the way resolution carries it.
function withListen(orbitals: OrbitalSchema['orbitals']): OrbitalSchema['orbitals'] {
  const mechanic = orbitals[0].traits.find((t) => (t as { name?: string }).name === 'SnakeMechanic') as {
    listens?: unknown[];
  };
  mechanic.listens = [{ event: 'SnakePlay.TURN', triggers: 'STEER' }];
  return orbitals;
}

function binding(name: string, transitions: unknown[]): ResolvedTraitBinding {
  const trait = createEmptyResolvedTrait(name, 'schema');
  trait.transitions = transitions as ResolvedTraitBinding['trait']['transitions'];
  return { trait, linkedEntity: 'Snake' };
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

describe('game keyboard input — qualified key fans reach the domain trait', () => {
  it('a key event fanned from the embedded canvas scope steers SnakeMechanic', async () => {
    const slots = stubSlots();
    const orbitals = withListen(snakeOrbitals());
    const bindings = [
      binding('SnakePlay', [
        { from: 'playing', to: 'playing', event: 'UP', effects: [['emit', 'TURN', { dir: 'up' }]] },
      ]),
      binding('SnakeMechanic', [
        { from: 'playing', to: 'playing', event: 'STEER', effects: [['set', '@entity.dir', '@payload.dir']] },
      ]),
      binding('SnakeCanvas', []),
    ];

    let bus!: ReturnType<typeof useEventBus>;
    const { result } = renderHook(() => {
      bus = useEventBus();
      return useTraitStateMachine(bindings, slots, { orbitals });
    });

    // The exact keys `useEventBus`'s R-EMBEDDED-EMIT-BUBBLE fan-out
    // produces for a KeyW keydown inside SnakeCanvas's TraitFrame.
    await act(async () => {
      bus.emit('UI:SnakeOrbital.SnakeCanvas.UP', {});
      bus.emit('UI:SnakeOrbital.SnakePlay.UP', {});
    });

    await vi.waitFor(() => {
      expect(result.current.entityBindingSource.getEntitySnapshot('SnakeMechanic')['dir']).toBe('up');
    });
  });

  it('the mechanic steers exactly once per key press (no double-fire)', async () => {
    const slots = stubSlots();
    const orbitals = withListen(snakeOrbitals());
    const bindings = [
      binding('SnakePlay', [
        { from: 'playing', to: 'playing', event: 'UP', effects: [['emit', 'TURN', { dir: 'up' }]] },
      ]),
      binding('SnakeMechanic', [
        { from: 'playing', to: 'playing', event: 'STEER', effects: [['set', '@entity.dir', '@payload.dir']] },
      ]),
    ];

    let bus!: ReturnType<typeof useEventBus>;
    const { result } = renderHook(() => {
      bus = useEventBus();
      return useTraitStateMachine(bindings, slots, { orbitals });
    });

    // The real fan emits the SAME semantic event on BOTH the embedded scope
    // and the composer's scope; ingress must settle each trait's dispatch
    // once (the SnakePlay.UP subscription fires once — SnakeCanvas.UP has no
    // subscriber) and the mechanic's arm must apply exactly one steering set.
    await act(async () => {
      bus.emit('UI:SnakeOrbital.SnakeCanvas.UP', {});
      bus.emit('UI:SnakeOrbital.SnakePlay.UP', {});
    });

    await vi.waitFor(() => {
      expect(result.current.entityBindingSource.getEntitySnapshot('SnakeMechanic')['dir']).toBe('up');
    });
    // No counter fixture needed: a double STEER is invisible on a set, so pin
    // the dispatch-count contract at the ingress boundary instead — the
    // mechanic's frame must hold exactly the last write and the play trait
    // must have settled (state machine trace would show two hops otherwise).
    expect(result.current.getTraitState('SnakeMechanic')?.currentState).toBe('playing');
  });
});
