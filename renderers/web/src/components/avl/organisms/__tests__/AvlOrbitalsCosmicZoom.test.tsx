// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { AvlOrbitalsCosmicZoom } from '../AvlOrbitalsCosmicZoom';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import type { AvlPlayStep } from '../../../../lib/avl-play';

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

const schema: OrbitalSchema = {
  name: 'EditorApp',
  orbitals: [
    {
      name: 'Editor',
      entity: { name: 'Doc', fields: [{ name: 'mode', type: 'string', default: 'normal' }] },
      pages: [],
      traits: [
        {
          name: 'Modes',
          scope: 'instance',
          linkedEntity: 'Doc',
          stateMachine: {
            states: [{ name: 'NORMAL', isInitial: true }, { name: 'INSERT' }],
            events: [{ key: 'KEY', name: 'Key' }, { key: 'ESC', name: 'Esc' }],
            transitions: [
              { from: 'NORMAL', to: 'INSERT', event: 'KEY', guard: ['=', '@payload.key', 'i'] },
              { from: 'NORMAL', to: 'INSERT', event: 'KEY', guard: ['=', '@payload.key', 'a'] },
              { from: 'INSERT', to: 'NORMAL', event: 'ESC' },
            ],
          },
        },
      ],
    },
  ],
};

const step = (from: string, event: string, after: string, firedArm: number): AvlPlayStep => ({
  orbital: 'Editor',
  trait: 'Modes',
  from,
  event,
  payload: {},
  result: { trait: 'Modes', event, transitionFired: true, guard: 'none', firedArm, state: { before: from, after }, effects: [], emitted: [] },
});

const renderCosmic = (props: Partial<React.ComponentProps<typeof AvlOrbitalsCosmicZoom>> = {}) =>
  render(
    <EventBusProvider debug={false}>
      <AvlOrbitalsCosmicZoom schema={schema} highlightedOrbital="Editor" width={900} height={700} {...props} />
    </EventBusProvider>,
  );

const drillIntoEditor = async () => {
  const chip = await waitFor(() => {
    const node = screen.getAllByTestId('avl-system-node').find((n) => n.getAttribute('data-orbital') === 'Editor');
    expect(node).toBeDefined();
    return node!;
  });
  fireEvent.click(chip);
};

const labels = async () => {
  await drillIntoEditor();
  fireEvent.click(await screen.findByTestId('trait-lens-traits'));
  await waitFor(() => expect(screen.getAllByTestId('avl-sm-label').length).toBe(3));
  return screen.getAllByTestId('avl-sm-label');
};

describe('AvlOrbitalsCosmicZoom — the system map (L1)', () => {
  it('lands on the system map with the highlighted orbital ringed, not inside it', async () => {
    renderCosmic();
    const chip = await waitFor(() => screen.getAllByTestId('avl-system-node').find((n) => n.getAttribute('data-orbital') === 'Editor')!);
    expect(chip.className).toContain('border-primary');
    expect(screen.queryAllByTestId('avl-sm-label')).toHaveLength(0);
    expect(screen.getByTestId('avl-system-node-counts').textContent).toBe('1 traits · 0 pages · 1 fields');
  });

  it('hovering an orbital shows the host preview, and Open code asks the host for its source', async () => {
    const onOpen = vi.fn();
    function Listener() {
      const bus = useEventBus();
      React.useEffect(() => bus.on('UI:OPEN_ORBITAL_CODE', (e) => onOpen(e.payload)), [bus]);
      return null;
    }
    render(
      <EventBusProvider debug={false}>
        <Listener />
        <AvlOrbitalsCosmicZoom
          schema={schema}
          width={900}
          height={700}
          renderOrbitalPreview={(o) => <span data-testid="host-preview">{o}</span>}
          openCodeEvent="OPEN_ORBITAL_CODE"
        />
      </EventBusProvider>,
    );
    const chip = await waitFor(() => screen.getAllByTestId('avl-system-node')[0]);
    fireEvent.mouseEnter(chip);
    await waitFor(() => expect(screen.getByTestId('host-preview').textContent).toBe('Editor'));
    fireEvent.click(screen.getByTestId('action-OPEN_ORBITAL_CODE'));
    expect(onOpen).toHaveBeenCalledWith({ orbital: 'Editor' });
  });

  it('control: without a host preview there is no hover card', async () => {
    renderCosmic();
    const chip = await waitFor(() => screen.getAllByTestId('avl-system-node')[0]);
    fireEvent.mouseEnter(chip);
    expect(screen.queryByTestId('avl-system-preview')).toBeNull();
  });
});

describe('AvlOrbitalsCosmicZoom — the Dependencies lens', () => {
  const dependencies = {
    orbitals: { Editor: ['std-browse'] },
    behaviors: {
      'std-browse': { layer: 'std' as const, imports: ['ui-data-list'] },
      'ui-data-list': { layer: 'primitive' as const, imports: [] },
    },
  };
  const role = (id: string) => screen.getAllByTestId('avl-dependency-node').find((n) => n.getAttribute('data-dependency') === id)?.getAttribute('data-role');

  it('selecting a behavior lights what it is built from and what depends on it', async () => {
    renderCosmic({ dependencies });
    fireEvent.click(await screen.findByTestId('system-map-lens-dependencies'));
    await waitFor(() => expect(screen.getAllByTestId('avl-dependency-node')).toHaveLength(3));
    expect(screen.getByTestId('avl-dependency-column-primitive')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('avl-dependency-node').find((n) => n.getAttribute('data-dependency') === 'behavior:std-browse')!);
    await waitFor(() => expect(role('behavior:std-browse')).toBe('selected'));
    expect(role('behavior:ui-data-list')).toBe('upstream');
    expect(role('orbital:Editor')).toBe('downstream');
    expect(screen.getByTestId('dependency-summary').textContent).toBe('std-browse · built from 1 · 1 depend on it');
  });

  it('control: without dependencies the lens is off', async () => {
    renderCosmic();
    expect(await screen.findByTestId('system-map-lens-dependencies')).toBeDisabled();
  });
});

describe('AvlOrbitalsCosmicZoom — the orbital flow (L2)', () => {
  const flowSchema: OrbitalSchema = {
    name: 'FlowApp',
    orbitals: [{
      name: 'Shop',
      entity: { name: 'Order', fields: [] },
      pages: [],
      traits: [
        { name: 'Persistor', scope: 'instance', emits: [{ event: 'SAVED' }], listens: [{ event: 'SAVE', triggers: 'SAVE', source: { kind: 'trait', trait: 'Form' } }], stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] } },
        { name: 'Form', scope: 'instance', sourceBehavior: { alias: 'Modal', behavior: 'std/behaviors/std-modal', originalName: 'Modal' }, emits: [{ event: 'SAVE' }], stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] } },
        { name: 'FormTwo', scope: 'instance', sourceBehavior: { alias: 'Modal', behavior: 'std/behaviors/std-modal', originalName: 'Other' }, stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] } },
        { name: 'Grid', scope: 'instance', sourceBehavior: { alias: 'Browse', behavior: 'std/behaviors/std-browse', originalName: 'Browse' }, listens: [{ event: 'SAVED', triggers: 'SAVED', source: { kind: 'trait', trait: 'Persistor' } }], stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] } },
      ],
    }],
  };
  const unit = (id: string) => screen.getAllByTestId('avl-dependency-node').find((n) => n.getAttribute('data-dependency') === id);
  const openShop = async () => {
    render(<EventBusProvider debug={false}><AvlOrbitalsCosmicZoom schema={flowSchema} width={900} height={700} /></EventBusProvider>);
    fireEvent.click(await waitFor(() => screen.getAllByTestId('avl-system-node').find((n) => n.getAttribute('data-orbital') === 'Shop')!));
    await waitFor(() => expect(screen.getAllByTestId('avl-dependency-node')).toHaveLength(3));
  };

  it('opens on the flow: own traits alone, composed traits as one unit each', async () => {
    await openShop();
    expect(unit('behavior:std-modal')?.textContent).toBe('std-modal · 2 traits');
    expect(unit('trait:Persistor')?.textContent).toBe('Persistor');
  });

  it('selecting a unit lights what triggers it and what it triggers, one hop', async () => {
    await openShop();
    fireEvent.click(unit('trait:Persistor')!);
    await waitFor(() => expect(unit('trait:Persistor')?.getAttribute('data-role')).toBe('selected'));
    expect(unit('behavior:std-modal')?.getAttribute('data-role')).toBe('upstream');
    expect(unit('behavior:std-browse')?.getAttribute('data-role')).toBe('downstream');
    expect(screen.getByTestId('flow-summary').textContent).toBe('Persistor · 1 trigger it · it triggers 1');
  });

  it("Show its traits narrows the trait cards to that unit's traits", async () => {
    await openShop();
    fireEvent.click(unit('behavior:std-modal')!);
    fireEvent.click(await screen.findByTestId('flow-show-traits'));
    await waitFor(() => expect(screen.getByTestId('trait-filter').textContent).toContain('std-modal · 2 traits'));
  });
});

describe('AvlOrbitalsCosmicZoom — the trait drill', () => {
  it('opens exactly the clicked arm when two arms share an event', async () => {
    renderCosmic();
    const keyArms = (await labels()).filter((l) => l.dataset.event === 'KEY');
    fireEvent.click(keyArms[1]);
    await waitFor(() => expect(screen.getByTestId('avl-transition-detail')).toBeInTheDocument());
    expect(screen.getAllByTestId('avl-circuit-code')[0].textContent).toBe('(= @payload.key "a")');
  });

  it('coming back from a transition keeps the Traits lens the user was on', async () => {
    renderCosmic();
    const keyArms = (await labels()).filter((l) => l.dataset.event === 'KEY');
    fireEvent.click(keyArms[0]);
    await waitFor(() => expect(screen.getByTestId('avl-transition-detail')).toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-label').length).toBe(3));
    expect(screen.getByTestId('trait-lens-traits').getAttribute('aria-pressed')).toBe('true');
  });

  it('a played scene lights the trait machine and shows the scrubber position', async () => {
    renderCosmic({ scene: [step('NORMAL', 'KEY', 'INSERT', 1), step('INSERT', 'ESC', 'NORMAL', 0)] });
    await labels();
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state').find((n) => n.dataset.active === 'true')?.dataset.state).toBe('NORMAL'));
    expect(screen.getByTestId('avl-scene-position').textContent).toBe('Step 2 of 2');
  });

  it('control: without a scene there is no scene bar and nothing is active', async () => {
    renderCosmic();
    await labels();
    expect(screen.queryByTestId('avl-scene-bar')).toBeNull();
    expect(screen.getAllByTestId('avl-sm-state').filter((n) => n.dataset.active === 'true')).toHaveLength(0);
  });
});
