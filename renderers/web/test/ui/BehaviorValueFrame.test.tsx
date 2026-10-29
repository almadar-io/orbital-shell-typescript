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
import { UISlotComponent } from '../../src/components/core/organisms/UISlotRenderer';
import { useUISlots } from '../../src/providers/UISlotContext';

const APP: BehaviorRef = { behavior: './orbitals/shop' };

function program(): OrbitalSchema {
  return {
    name: 'Shop',
    typeContractVersion: 1,
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

function Slot({ refs }: { refs: BehaviorRef[] }): React.ReactElement {
  const manager = useUISlots();
  React.useEffect(() => {
    manager.render({ target: 'main', pattern: 'stack', props: { children: refs } });
  }, [manager, refs]);
  return <UISlotComponent slot="main" />;
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

  it('the embed fills its slot instead of the preview default 400px', async () => {
    const h = host({ ok: true, mounted: { schema: program(), firstPage: '/shop' } });
    render(shell(h));
    const text = await screen.findByText('Welcome to the shop');
    const heights: string[] = [];
    for (let node: HTMLElement | null = text; node !== null; node = node.parentElement) heights.push(node.style.height);
    expect(heights).toContain('100%');
    expect(heights).not.toContain('400px');
  });

  it('a later embed keeps its DOM when an earlier sibling embed is removed (keyed by behavior id)', async () => {
    const carried = (name: string): BehaviorRef => ({ behavior: `./orbitals/${name}`, resolved: JSON.stringify(program()) });
    const first = carried('one');
    const second = carried('two');
    const tree = (children: BehaviorRef[]): React.ReactElement => (
      <EventBusProvider>
        <UISlotProvider>
          <Slot refs={children} />
        </UISlotProvider>
      </EventBusProvider>
    );
    const view = render(tree([first, second]));
    const texts = await screen.findAllByText('Welcome to the shop');
    const kept = texts[1]!;
    view.rerender(tree([second]));
    const after = await screen.findAllByText('Welcome to the shop');
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(kept);
  });
});
