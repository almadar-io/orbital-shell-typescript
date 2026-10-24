// @vitest-environment jsdom
/**
 * TraitValueFrame — a trait VALUE (language trio) rendered where a render tree
 * embeds it: the host mounts it (a resolved wrapper program), the frame runs it
 * in the plugin host's local kernel, starts it with INIT, paints
 * its `main` slot inline, and bridges its emits to the ambient bus. A refused
 * mount or a missing host is an explicit error, never silence.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { OrbitalSchema, TraitValue, TraitValueMountResult } from '@almadar/core';
import { EventBusProvider } from '../../src/core';
import { useEventBus, type EventBusContextType } from '../../src/core';
import { UISlotProvider } from '../../src/providers/UISlotContext';
import { TraitValueFrame, TraitValueMountProvider, type TraitValueMountHost } from '../../src/preview/TraitValueFrame';

const WIDGET: TraitValue = { behavior: 'almadar-std/std-greeting', trait: 'Greet', config: { title: 'Hello' } };

function mountedSchema(): OrbitalSchema {
  return {
    name: 'MountGreet',
    orbitals: [
      {
        name: 'Mounted',
        entity: { name: 'MountedGreeting', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        pages: [],
        traits: [
          {
            name: 'MountedGreet',
            linkedEntity: 'MountedGreeting',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }, { name: 'shown' }],
              events: [{ key: 'INIT', name: 'INIT' }],
              transitions: [
                {
                  from: 'idle',
                  to: 'shown',
                  event: 'INIT',
                  effects: [
                    ['render-ui', 'main', { type: 'typography', content: 'Hello from the bound widget' }],
                    ['emit', 'GREETED', {}],
                  ],
                },
              ],
            },
            emits: [{ event: 'GREETED', scope: 'external' }],
          },
        ],
      },
    ],
  };
}

function okHost(): TraitValueMountHost {
  return {
    mount: vi.fn(async (): Promise<TraitValueMountResult> => ({
      ok: true,
      mounted: { schema: mountedSchema(), orbital: 'Mounted', trait: 'MountedGreet' },
    })),
  };
}

let captured: EventBusContextType | null = null;
function BusProbe(): null {
  captured = useEventBus();
  return null;
}

function shell(host: TraitValueMountHost | null, value: TraitValue = WIDGET): React.ReactElement {
  const frame = <TraitValueFrame value={value} />;
  return (
    <EventBusProvider>
      <UISlotProvider>
        <BusProbe />
        {host ? <TraitValueMountProvider host={host}>{frame}</TraitValueMountProvider> : frame}
      </UISlotProvider>
    </EventBusProvider>
  );
}

describe('TraitValueFrame', () => {
  it('mounts the value, starts it with INIT and paints its main slot inline', async () => {
    const host = okHost();
    render(shell(host));
    await waitFor(() => expect(screen.getByText('Hello from the bound widget')).toBeTruthy());
    expect(host.mount).toHaveBeenCalledWith(WIDGET);
  });

  it("bridges the bound trait's emits to the ambient bus", async () => {
    const seen = vi.fn();
    render(shell(okHost()));
    await waitFor(() => expect(captured).not.toBeNull());
    const off = captured?.on('UI:GREETED', seen);
    await waitFor(() => expect(screen.getByText('Hello from the bound widget')).toBeTruthy());
    off?.();
    await waitFor(() => expect(seen).toHaveBeenCalled());
  });

  it('shows the validator issues when the value does not validate where it is bound', async () => {
    const host: TraitValueMountHost = {
      mount: async () => ({ ok: false, error: 'does not validate', errors: [{ code: 'ORB_X', message: 'broken' }] }),
    };
    render(shell(host));
    await waitFor(() => expect(screen.getByText(/ORB_X: broken/)).toBeTruthy());
  });

  it("runs a playground host's value in-browser on its own kernel (mode: 'mock', no transport)", async () => {
    const host: TraitValueMountHost = { ...okHost(), mode: 'mock' };
    const seen = vi.fn();
    render(shell(host));
    await waitFor(() => expect(captured).not.toBeNull());
    const off = captured?.on('UI:GREETED', seen);
    await waitFor(() => expect(screen.getByText('Hello from the bound widget')).toBeTruthy());
    await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    off?.();
  });

  it('control: without a host the frame says so explicitly', async () => {
    render(shell(null));
    await waitFor(() => expect(screen.getByText(/No trait-value host is configured/)).toBeTruthy());
  });
});
