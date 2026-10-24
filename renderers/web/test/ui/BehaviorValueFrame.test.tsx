// @vitest-environment jsdom
/**
 * BehaviorValueFrame — a whole behavior VALUE embedded in a render tree: the
 * host mounts the program (validated and resolved), the frame runs it in place
 * through an isolated OrbPreview opening on its first page. A refused mount or a
 * host that cannot mount behaviors is an explicit error, never silence.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { BehaviorRef, BehaviorValueMountResult, OrbitalSchema } from '@almadar/core';
import { EventBusProvider } from '../../src/core';
import { UISlotProvider } from '../../src/providers/UISlotContext';
import { TraitValueMountProvider, type TraitValueMountHost } from '../../src/preview/TraitValueFrame';
import { BehaviorValueFrame } from '../../src/preview/BehaviorValueFrame';

const APP: BehaviorRef = { behavior: './orbitals/shop' };

function program(): OrbitalSchema {
  return {
    name: 'Shop',
    orbitals: [
      {
        name: 'Shop',
        entity: { name: 'ShopView', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'ShopHome',
            linkedEntity: 'ShopView',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [{ key: 'INIT', name: 'INIT' }],
              transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'Welcome to the shop' }]] }],
            },
          },
        ],
        pages: [{ name: 'ShopHomePage', path: '/shop', traits: [{ ref: 'ShopHome' }] }],
      },
    ],
  };
}

function host(result: BehaviorValueMountResult | undefined): TraitValueMountHost {
  return {
    mount: vi.fn(async () => ({ ok: false as const, error: 'not used' })),
    ...(result !== undefined ? { mountBehavior: vi.fn(async () => result) } : {}),
  };
}

function shell(h: TraitValueMountHost | null): React.ReactElement {
  const frame = <BehaviorValueFrame value={APP} />;
  return (
    <EventBusProvider>
      <UISlotProvider>{h ? <TraitValueMountProvider host={h}>{frame}</TraitValueMountProvider> : frame}</UISlotProvider>
    </EventBusProvider>
  );
}

describe('BehaviorValueFrame', () => {
  it('mounts the program and runs it in place on its first page', async () => {
    const h = host({ ok: true, mounted: { schema: program(), firstPage: '/shop' } });
    render(shell(h));
    await waitFor(() => expect(screen.getByText('Welcome to the shop')).toBeTruthy());
    expect(h.mountBehavior).toHaveBeenCalledWith(APP);
  });

  it('a refused mount shows the validator issues', async () => {
    render(shell(host({ ok: false, error: 'behavior ./orbitals/shop does not validate', errors: [{ code: 'ORB_X', message: 'broken' }] })));
    await waitFor(() => expect(screen.getByText(/does not validate/)).toBeTruthy());
    expect(screen.getByText(/ORB_X: broken/)).toBeTruthy();
  });

  it('control: a host that cannot mount behaviors is an explicit error', async () => {
    render(shell(host(undefined)));
    await waitFor(() => expect(screen.getByText(/cannot run behavior/)).toBeTruthy());
  });

  it('control: no host at all is an explicit error', async () => {
    render(shell(null));
    await waitFor(() => expect(screen.getByText(/cannot run behavior/)).toBeTruthy());
  });
});
