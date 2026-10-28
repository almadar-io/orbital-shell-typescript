// @vitest-environment jsdom
/**
 * TraitValueFrame — a trait VALUE (language trio) rendered where a render tree
 * embeds it: the host mounts it (a resolved wrapper program), the frame runs it
 * in the plugin host's local kernel, starts it with INIT, paints
 * its `main` slot inline, and bridges its emits to the ambient bus. A refused
 * mount or a missing host is an explicit error, never silence.
 */
import React, { useEffect } from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { OrbitalSchema, TraitValue, TraitValueMountResult } from '@almadar/core';
import { EventBusProvider } from '../../src/core';
import { useEventBus } from '../../src/core';
import { UISlotProvider } from '../../src/providers/UISlotContext';
import { clientProgram } from '../../src/test-support/lolo-program';
import { TraitValueFrame, TraitValueMountProvider, type TraitValueMountHost } from '../../src/preview/TraitValueFrame';

const WIDGET: TraitValue = { behavior: 'almadar-std/std-greeting', trait: 'Greet', config: { title: 'Hello' } };

const mountedProgram = `app mount-greet [
  version: "1.0.0"
]

orbital Mounted {
  entity MountedGreeting [runtime] {
    id : string!
  }

  trait MountedGreet -> MountedGreeting [client] {
    initial: idle

    state idle {
      INIT -> shown
        (render-ui main { type: "typography", content: "Hello from the bound widget" })
        (emit GREETED {})
    }

    state shown {
      INIT -> shown
        (render-ui main { type: "typography", content: "Hello from the bound widget" })
    }

    emits {
      GREETED -> external {
      }
    }
  }

  page "/" as MountedPage -> MountedGreet
}
`;

const mountedSchemaValue: OrbitalSchema = clientProgram(mountedProgram);

function mountedSchema(): OrbitalSchema {
  return structuredClone(mountedSchemaValue);
}

function okHost(): TraitValueMountHost {
  return {
    mount: vi.fn(async (): Promise<TraitValueMountResult> => ({
      ok: true,
      mounted: { schema: mountedSchema(), orbital: 'Mounted', trait: 'MountedGreet' },
    })),
  };
}

const greeted = vi.fn();
function BusProbe(): null {
  const bus = useEventBus();
  useEffect(() => bus.on('UI:GREETED', greeted), [bus]);
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
  beforeEach(() => { greeted.mockClear(); });

  it('mounts the value, starts it with INIT and paints its main slot inline', async () => {
    const host = okHost();
    render(shell(host));
    await waitFor(() => expect(screen.getByText('Hello from the bound widget')).toBeTruthy());
    expect(host.mount).toHaveBeenCalledWith(WIDGET);
  });

  it("bridges the bound trait's emits to the ambient bus", async () => {
    render(shell(okHost()));
    await waitFor(() => expect(screen.getByText('Hello from the bound widget')).toBeTruthy());
    await waitFor(() => expect(greeted).toHaveBeenCalled());
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
    render(shell(host));
    await waitFor(() => expect(screen.getByText('Hello from the bound widget')).toBeTruthy());
    await waitFor(() => expect(greeted).toHaveBeenCalledTimes(1));
  });

  it('control: without a host the frame says so explicitly', async () => {
    render(shell(null));
    await waitFor(() => expect(screen.getByText(/No trait-value host is configured/)).toBeTruthy());
  });
});
