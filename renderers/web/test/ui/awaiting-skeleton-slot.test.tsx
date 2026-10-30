// @vitest-environment jsdom
/**
 * Awaiting-server skeletons: while a trait's server round trip is in flight
 * (`store.awaiting`), an EMPTY slot shows the skeleton its taken transition
 * predicts (`awaitRender`); content already on screen stays; nothing shows
 * once the leg ends, for a slot nothing predicts, for an embedded trait's
 * slot, or with no provider. Compiled mode takes `awaitingSkeleton` directly.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { memoryTraitDefinitions, programCircuit, type CircuitSurface } from '../../src/lib/circuit-surface';
import { kernelOrbitals } from '../../src/lib/kernel-schema';
import { loadTestKernel, TEST_TYPE_CONTRACT_VERSION } from '../../src/test-support/kernel-engine';
import { createMemoryCircuitStore, type CircuitStore } from '../../src';
import { EventBusProvider } from '../../src/core';
import { UISlotProvider, useUISlots } from '../../src/providers/UISlotContext';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { AwaitingSkeletonContext } from '../../src/providers/AwaitingSkeletonContext';
import { useAwaitingSkeletonSource } from '../../src/hooks/circuit/useAwaitingSkeletonSource';
import { UISlotComponent } from '../../src/components/core/organisms/UISlotRenderer';
import { TraitFrame } from '../../src/components/core/atoms/TraitFrame';

function schema(): OrbitalSchema {
  return {
    typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
    name: 'AwaitApp',
    schemaVersion: 4,
    orbitals: [
      {
        name: 'ItemOrbital',
        entity: { name: 'Item', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'ItemBrowse',
            linkedEntity: 'Item',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }, { name: 'loaded' }],
              events: [],
              transitions: [
                {
                  from: 'idle',
                  to: 'idle',
                  event: 'INIT',
                  effects: [['fetch', 'Item', { emit: { success: 'LOADED' } }]],
                  awaitRender: [
                    { trait: 'ItemBrowse', slot: 'main', skeleton: { stack: [{ shape: { variant: 'header' } }, { shape: { variant: 'grid', rows: 2 } }] } },
                    { trait: 'ItemStats', slot: 'main', skeleton: { shape: { variant: 'stats' } } },
                  ],
                },
                { from: 'idle', to: 'loaded', event: 'LOADED', effects: [['render-ui', 'main', { type: 'typography', content: 'Loaded' }]] },
              ],
            },
          },
          {
            name: 'ItemStats',
            linkedEntity: 'Item',
            stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] },
          },
        ],
        pages: [],
      },
    ],
  };
}

async function setup(): Promise<{ store: CircuitStore; traitIndex: CircuitSurface }> {
  const module = await loadTestKernel();
  const program = schema();
  const kernel = new module.Kernel(JSON.stringify({ ...program, orbitals: kernelOrbitals(program.orbitals) }), 'awaiting-skeleton-test');
  const traitIndex = programCircuit(kernel);
  kernel.free();
  return { store: createMemoryCircuitStore(memoryTraitDefinitions(traitIndex)), traitIndex };
}

function Provide({ store, traitIndex, embedded, children }: { store: CircuitStore; traitIndex: CircuitSurface; embedded?: ReadonlySet<string>; children: React.ReactNode }) {
  const source = useAwaitingSkeletonSource(store, traitIndex, embedded);
  return <AwaitingSkeletonContext.Provider value={source}>{children}</AwaitingSkeletonContext.Provider>;
}

function ManagerGrabber({ onReady }: { onReady: (manager: UISlotManager) => void }): null {
  onReady(useUISlots());
  return null;
}

function harness(children: React.ReactNode) {
  return render(
    <EventBusProvider isolated>
      <UISlotProvider>{children}</UISlotProvider>
    </EventBusProvider>,
  );
}

const AWAITING = { trait: 'ItemBrowse', event: 'INIT', from: 'idle' };

describe('awaiting-server skeleton in slots', () => {
  it('an empty slot shows the predicted skeleton while its trait awaits, and clears when the leg ends', async () => {
    const { store, traitIndex } = await setup();
    harness(<Provide store={store} traitIndex={traitIndex}><UISlotComponent slot="main" /></Provide>);
    expect(screen.getByTestId('ui-slot-main')).toHaveAttribute('data-slot-mode', 'empty');

    act(() => store.awaiting.begin([AWAITING]));
    const slot = screen.getByTestId('ui-slot-main');
    expect(slot).toHaveAttribute('data-slot-mode', 'awaiting');
    expect(slot.querySelector('[data-skeleton="tree"]')).not.toBeNull();
    expect(slot.querySelector('[data-loading-state]')).not.toBeNull();

    act(() => store.awaiting.end(['ItemBrowse']));
    expect(screen.getByTestId('ui-slot-main')).toHaveAttribute('data-slot-mode', 'empty');
    expect(screen.getByTestId('ui-slot-main').querySelector('[data-skeleton="tree"]')).toBeNull();
  });

  it('content already on screen stays while awaiting (keep-content)', async () => {
    const { store, traitIndex } = await setup();
    let manager!: UISlotManager;
    harness(
      <Provide store={store} traitIndex={traitIndex}>
        <ManagerGrabber onReady={(m) => { manager = m; }} />
        <UISlotComponent slot="main" />
      </Provide>,
    );
    act(() => { manager.render({ target: 'main', pattern: 'typography', props: { content: 'Existing' } }); });
    act(() => store.awaiting.begin([AWAITING]));
    expect(screen.getByText('Existing')).toBeInTheDocument();
    expect(document.querySelector('[data-skeleton="tree"]')).toBeNull();
  });

  it('control: a slot no awaiting render predicts stays empty', async () => {
    const { store, traitIndex } = await setup();
    harness(<Provide store={store} traitIndex={traitIndex}><UISlotComponent slot="sidebar" /></Provide>);
    act(() => store.awaiting.begin([AWAITING]));
    expect(screen.getByTestId('ui-slot-sidebar')).toHaveAttribute('data-slot-mode', 'empty');
  });

  it('control: an awaiting transition with no prediction (different from-state) shows nothing', async () => {
    const { store, traitIndex } = await setup();
    harness(<Provide store={store} traitIndex={traitIndex}><UISlotComponent slot="main" /></Provide>);
    act(() => store.awaiting.begin([{ trait: 'ItemBrowse', event: 'INIT', from: 'loaded' }]));
    expect(screen.getByTestId('ui-slot-main')).toHaveAttribute('data-slot-mode', 'empty');
  });

  it('an embedded trait renders in its frame, never claiming the top-level slot', async () => {
    const { store, traitIndex } = await setup();
    const embedded = new Set(['ItemBrowse']);
    harness(
      <Provide store={store} traitIndex={traitIndex} embedded={embedded}>
        <UISlotComponent slot="main" />
        <TraitFrame traitName="ItemStats" />
      </Provide>,
    );
    act(() => store.awaiting.begin([AWAITING]));
    const skeletons = document.querySelectorAll('[data-skeleton="tree"]');
    // ItemStats (not embedded) still predicts main; ItemBrowse's own entry is skipped for the slot.
    expect(screen.getByTestId('ui-slot-main')).toHaveAttribute('data-slot-mode', 'awaiting');
    expect(skeletons.length).toBe(2);
  });

  it('a trait frame with no content shows its predicted skeleton; control: no provider shows the fallback', async () => {
    const { store, traitIndex } = await setup();
    harness(<Provide store={store} traitIndex={traitIndex}><TraitFrame traitName="ItemStats" fallback={<span>fb</span>} /></Provide>);
    act(() => store.awaiting.begin([AWAITING]));
    expect(document.querySelector('[data-skeleton="tree"]')).not.toBeNull();
    expect(screen.queryByText('fb')).toBeNull();
  });

  it('control: no provider never shows a skeleton', () => {
    harness(<><UISlotComponent slot="main" /><TraitFrame traitName="ItemStats" fallback={<span>fb</span>} /></>);
    expect(screen.getByTestId('ui-slot-main')).toHaveAttribute('data-slot-mode', 'empty');
    expect(screen.getByText('fb')).toBeInTheDocument();
  });

  it('compiled: a cleared slot with awaitingSkeleton shows it; without it renders nothing', () => {
    const { rerender } = harness(
      <UISlotComponent slot="main" pattern="clear" awaitingSkeleton={{ shape: { variant: 'list', rows: 3 } }}>{null}</UISlotComponent>,
    );
    expect(document.querySelector('[data-slot-mode="awaiting"] [data-skeleton="tree"]')).not.toBeNull();
    rerender(
      <EventBusProvider isolated>
        <UISlotProvider><UISlotComponent slot="main" pattern="clear">{null}</UISlotComponent></UISlotProvider>
      </EventBusProvider>,
    );
    expect(document.querySelector('[data-skeleton="tree"]')).toBeNull();
  });

  it('control: a portal slot never shows an awaiting skeleton', () => {
    harness(<UISlotComponent slot="modal" pattern="clear" awaitingSkeleton={{ shape: { variant: 'form' } }}>{null}</UISlotComponent>);
    expect(document.querySelector('[data-skeleton="tree"]')).toBeNull();
  });
});
