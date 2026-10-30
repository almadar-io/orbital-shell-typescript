/**
 * FlowCanvas — externalInspector / onSelectedNodeChange (Studio V4 persistent
 * properties panel). Covers: default behavior renders the inline OrbInspector
 * unchanged, `externalInspector` suppresses it while selection changes still
 * fire `onSelectedNodeChange` through every `setSelectedNode` call site.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { EventPayload, OrbitalSchema } from '@almadar/core';
import { FlowCanvas } from '../FlowCanvas';
import { type PreviewNodeData } from '../../../../lib/avl-preview-converter';

// jsdom has no ResizeObserver; React Flow's viewport pane measures itself
// with one on mount. A no-op stub is enough for the graph to render.
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

const schema: OrbitalSchema = {
  name: 'FixtureApp',
  orbitals: [
    {
      name: 'TaskBoard',
      entity: {
        name: 'Task',
        fields: [{ name: 'title', type: 'string', required: true }],
      },
      pages: [{ name: 'TasksPage', path: '/tasks' }],
      traits: [
        {
          name: 'TaskList',
          linkedEntity: 'Task',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }, { name: 'loaded' }],
            events: [{ key: 'LOAD', name: 'Load' }],
            transitions: [
              {
                from: 'idle',
                to: 'loaded',
                event: 'LOAD',
                effects: [['render-ui', 'main', { type: 'badge' }]],
              },
            ],
          },
        },
      ],
    },
  ],
};

const preselectedNode: PreviewNodeData = {
  orbitalName: 'TaskBoard',
  traitName: 'TaskList',
  transitionEvent: 'LOAD',
  fromState: 'idle',
  toState: 'loaded',
  entityName: 'Task',
  patterns: [{ slot: 'main', pattern: { type: 'badge' } }],
  eventSources: [],
};

describe('FlowCanvas default (externalInspector absent)', () => {
  it('renders the inline OrbInspector when a node is pre-selected', () => {
    render(
      <FlowCanvas
        schema={schema}
        initialOrbital="TaskBoard"
        initialSelectedNode={preselectedNode}
      />,
    );
    // OrbInspector's own tab bar (Design is always offered) — proves it mounted inline.
    expect(screen.getByRole('button', { name: 'Design' })).toBeInTheDocument();
  });

  it('clears the inline inspector on Escape and reports it via onSelectedNodeChange', () => {
    const onSelectedNodeChange = vi.fn();
    render(
      <FlowCanvas
        schema={schema}
        initialOrbital="TaskBoard"
        initialSelectedNode={preselectedNode}
        onSelectedNodeChange={onSelectedNodeChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'Design' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Design' })).not.toBeInTheDocument();
    expect(onSelectedNodeChange).toHaveBeenCalledWith(null);
  });
});

// Opening the inline inspector must not move the canvas: it takes width from
// the canvas row only, never from the toolbar (which would re-wrap and push
// every card down between the two clicks of a double-click).
describe('FlowCanvas inline inspector leaves the toolbar alone', () => {
  it('the toolbar spans above the canvas-and-inspector row', () => {
    render(<FlowCanvas schema={schema} initialOrbital="TaskBoard" initialSelectedNode={preselectedNode} />);
    const toolbar = screen.getByTestId('flow-canvas-toolbar');
    const inspectorButton = screen.getByRole('button', { name: 'Design' });
    const pane = screen.getByTestId('flow-canvas');
    expect(pane.contains(toolbar)).toBe(false);
    const row = toolbar.nextElementSibling;
    expect(row?.contains(pane)).toBe(true);
    expect(row?.contains(inspectorButton)).toBe(true);
  });

  it('control: without a selection the toolbar still sits directly above the canvas', () => {
    render(<FlowCanvas schema={schema} initialOrbital="TaskBoard" />);
    const toolbar = screen.getByTestId('flow-canvas-toolbar');
    expect(toolbar.nextElementSibling?.contains(screen.getByTestId('flow-canvas'))).toBe(true);
  });
});

describe('FlowCanvas externalInspector=true', () => {
  it('suppresses the inline OrbInspector even with a node pre-selected', () => {
    render(
      <FlowCanvas
        schema={schema}
        initialOrbital="TaskBoard"
        initialSelectedNode={preselectedNode}
        externalInspector
      />,
    );
    expect(screen.queryByRole('button', { name: 'Design' })).not.toBeInTheDocument();
  });

  it('still fires onSelectedNodeChange on clear-on-escape with the inspector suppressed', () => {
    const onSelectedNodeChange = vi.fn();
    render(
      <FlowCanvas
        schema={schema}
        initialOrbital="TaskBoard"
        initialSelectedNode={preselectedNode}
        externalInspector
        onSelectedNodeChange={onSelectedNodeChange}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSelectedNodeChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('button', { name: 'Design' })).not.toBeInTheDocument();
  });

  it('fires onSelectedNodeChange with the node on click-select of a card showing a state', async () => {
    const onSelectedNodeChange = vi.fn();
    const { container } = render(
      <FlowCanvas
        schema={schema}
        initialOrbital="TaskBoard"
        externalInspector
        onSelectedNodeChange={onSelectedNodeChange}
      />,
    );
    const node = container.querySelector('.react-flow__node');
    expect(node).toBeTruthy();
    await act(async () => {
      fireEvent.click(node as Element);
    });
    expect(onSelectedNodeChange).toHaveBeenCalledWith(
      expect.objectContaining({ orbitalName: 'TaskBoard', traitName: 'TaskList', transitionEvent: 'LOAD' }),
    );
  });
});

const twoOrbitals: OrbitalSchema = {
  name: 'TwoApp',
  orbitals: [
    schema.orbitals[0],
    { ...schema.orbitals[0], name: 'Notes', pages: [{ name: 'NotesPage', path: '/notes' }] },
    { ...schema.orbitals[0], name: 'Files', pages: [{ name: 'FilesPage', path: '/files' }] },
  ],
};

// A card's right-edge resize control, standing in for the library's pointer drag geometry: one click ends a resize at `resizeTo`.
let resizeTo = 0;
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    NodeResizeControl: ({ onResizeEnd }: { onResizeEnd?: (event: unknown, params: { width: number }) => void }) => (
      <button type="button" data-testid="card-resize" onClick={() => onResizeEnd?.(null, { width: resizeTo })} />
    ),
  };
});

const cardIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.react-flow__node')).map((n) => n.getAttribute('data-id'));

describe('FlowCanvas focus (local / world)', () => {
  it('opens on one card — the first orbital — in local view', () => {
    const { container } = render(<FlowCanvas schema={twoOrbitals} />);
    expect(cardIds(container)).toEqual(['TaskBoard']);
    expect(screen.getByTestId('canvas-scope-local').getAttribute('aria-pressed')).toBe('true');
  });

  it('Tab and Shift+Tab move the focus between orbitals, wrapping around', () => {
    const onFocusChange = vi.fn();
    const { container } = render(<FlowCanvas schema={twoOrbitals} onFocusChange={onFocusChange} />);
    const canvas = screen.getByTestId('flow-canvas');
    fireEvent.keyDown(canvas, { key: 'Tab' });
    expect(cardIds(container)).toEqual(['Notes']);
    fireEvent.keyDown(canvas, { key: 'Tab', shiftKey: true });
    fireEvent.keyDown(canvas, { key: 'Tab', shiftKey: true });
    expect(cardIds(container)).toEqual(['Files']);
    expect(onFocusChange).toHaveBeenLastCalledWith({ orbital: 'Files', scope: 'local', state: 'TaskList:LOAD:idle:loaded' });
  });

  it('Tab inside an input is left alone', () => {
    const { container } = render(<FlowCanvas schema={twoOrbitals} />);
    const input = document.createElement('input');
    screen.getByTestId('flow-canvas').appendChild(input);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(cardIds(container)).toEqual(['TaskBoard']);
  });

  it('the orbital picker and the arrows focus an orbital', () => {
    const { container } = render(<FlowCanvas schema={twoOrbitals} />);
    fireEvent.change(screen.getByTestId('canvas-orbital-picker'), { target: { value: 'Files' } });
    expect(cardIds(container)).toEqual(['Files']);
    fireEvent.click(screen.getByTestId('canvas-orbital-next'));
    expect(cardIds(container)).toEqual(['TaskBoard']);
  });

  it('a focusedOrbital prop change moves the focus without remounting', () => {
    const { container, rerender } = render(<FlowCanvas schema={twoOrbitals} />);
    rerender(<FlowCanvas schema={twoOrbitals} focusedOrbital="Notes" />);
    expect(cardIds(container)).toEqual(['Notes']);
  });

  it('world view shows every orbital', () => {
    const { container } = render(<FlowCanvas schema={twoOrbitals} />);
    fireEvent.click(screen.getByTestId('canvas-scope-world'));
    expect(cardIds(container)).toEqual(['TaskBoard', 'Notes', 'Files']);
  });

  it('a double-click on a card changes nothing', () => {
    const { container } = render(<FlowCanvas schema={twoOrbitals} />);
    fireEvent.doubleClick(container.querySelector('.react-flow__node') as Element);
    expect(cardIds(container)).toEqual(['TaskBoard']);
    expect(screen.getByTestId('canvas-state-TaskBoard')).toHaveValue('TaskList:LOAD:idle:loaded');
  });

  it('a card opens on its first state; the dropdown also offers the live orbital, and swaps the card', () => {
    const onFocusChange = vi.fn();
    render(<FlowCanvas schema={twoOrbitals} onFocusChange={onFocusChange} />);
    const picker = screen.getByTestId('canvas-state-TaskBoard') as HTMLSelectElement;
    expect(picker.value).toBe('TaskList:LOAD:idle:loaded');
    expect(Array.from(picker.options).map((o) => o.value)).toEqual(['live', 'TaskList:LOAD:idle:loaded']);
    fireEvent.change(picker, { target: { value: 'live' } });
    expect(onFocusChange).toHaveBeenLastCalledWith({ orbital: 'TaskBoard', scope: 'local', state: 'live' });
  });

  it('a resize in local view keeps the other cards\' saved placements', () => {
    const onPositionsChange = vi.fn();
    render(
      <>
        <FlowCanvas
          schema={twoOrbitals}
          nodePositions={{ Notes: { x: 5, y: 6 } }}
          onPositionsChange={onPositionsChange}
        />
      </>,
    );
    resizeTo = 700;
    fireEvent.click(screen.getByTestId('card-resize'));
    expect(onPositionsChange).toHaveBeenCalledWith(expect.objectContaining({ Notes: { x: 5, y: 6 }, TaskBoard: expect.objectContaining({ width: 700 }) }));
  });
});

describe('FlowCanvas has one mode', () => {
  it('a composition of behaviors is shown as their orbital cards, never as behavior glyphs', () => {
    const glyphs = [{ behaviorName: 'std-notes', level: 'atom', entityName: 'Note', stateCount: 1, fieldCount: 1, connectableEvents: [], orbitalNames: ['TaskBoard'] }];
    const { container } = render(
      // @ts-expect-error — the behavior compose level is gone; a composition is ordinary orbitals.
      <FlowCanvas schema={twoOrbitals} composeLevel="behavior" behaviorEntries={glyphs} />,
    );
    expect(container.querySelector('.react-flow__node-behaviorCompose')).toBeNull();
    expect(cardIds(container)).toEqual(['TaskBoard']);
  });
});

describe('FlowCanvas toolbar on small screens', () => {
  it('wraps instead of overflowing, and sits above the canvas rather than over its cards', () => {
    render(<FlowCanvas schema={twoOrbitals} />);
    const toolbar = screen.getByTestId('flow-canvas-toolbar');
    expect(toolbar.className).toContain('flex-wrap');
    expect(toolbar.className).not.toMatch(/(^|\s)absolute(\s|$)/);
    const pane = screen.getByTestId('flow-canvas').querySelector('.react-flow');
    expect(pane).not.toBeNull();
    expect(toolbar.compareDocumentPosition(pane as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });


  it('folds the screen-size presets into one dropdown below sm, the buttons above', () => {
    render(<FlowCanvas schema={twoOrbitals} />);
    const picker = screen.getByTestId('canvas-screen-size-picker') as HTMLSelectElement;
    expect(picker.closest('.sm\\:hidden')).not.toBeNull();
    expect(screen.getByTestId("canvas-screen-size-buttons").className).toMatch(/hidden sm:flex/);
    fireEvent.change(picker, { target: { value: 'mobile' } });
    expect(picker.value).toBe('mobile');
    expect(screen.getByRole('button', { name: /mobile/i }).getAttribute('aria-pressed')).toBe('true');
  });

  it('gives the focus controls a 40px tap target at phone width', () => {
    render(<FlowCanvas schema={twoOrbitals} />);
    for (const id of ['canvas-orbital-prev', 'canvas-orbital-next', 'canvas-scope-local', 'canvas-scope-world']) {
      expect(screen.getByTestId(id).className).toMatch(/(^|\s)h-10(\s|$)/);
    }
  });
});

describe('FlowCanvas in the compact (mobile) variant', () => {
  const stubWidth = (compact: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: compact && q === '(max-width: 1023.98px)', media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
  // Put back only matchMedia — unstubbing everything would drop the file's ResizeObserver stub.
  afterEach(() => { vi.stubGlobal('matchMedia', undefined); });

  it('has no zoom buttons (pinch zooms), and keeps the orbital picker on one row', () => {
    stubWidth(true);
    const { container } = render(<FlowCanvas schema={twoOrbitals} />);
    expect(container.querySelector('.react-flow__controls')).toBeNull();
    const picker = screen.getByTestId('canvas-orbital-picker');
    expect(screen.getByTestId('canvas-orbital-nav').className).toMatch(/flex-nowrap/);
    expect(screen.getByTestId('canvas-orbital-nav').contains(picker)).toBe(true);
  });

  it('desktop keeps the zoom buttons', () => {
    stubWidth(false);
    const { container } = render(<FlowCanvas schema={twoOrbitals} />);
    expect(container.querySelector('.react-flow__controls')).not.toBeNull();
  });
});

describe('FlowCanvas flow lens driven from outside (the runtime debugger)', () => {
  const flowSchema: OrbitalSchema = {
    name: 'FlowApp',
    orbitals: [{
      name: 'Shop',
      entity: { name: 'Order', fields: [] },
      pages: [],
      traits: [
        { name: 'Persistor', emits: [{ event: 'SAVED' }], listens: [{ event: 'SAVE', triggers: 'SAVE', source: { kind: 'trait', trait: 'Form' } }], stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] } },
        { name: 'Form', sourceBehavior: { alias: 'Modal', behavior: 'std/behaviors/std-modal', originalName: 'Modal' }, emits: [{ event: 'SAVE' }], stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] } },
        { name: 'Grid', sourceBehavior: { alias: 'Browse', behavior: 'std/behaviors/std-browse', originalName: 'Browse' }, listens: [{ event: 'SAVED', triggers: 'SAVED', source: { kind: 'trait', trait: 'Persistor' } }], stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] } },
      ],
    }],
  };
  const unit = (id: string) => screen.getAllByTestId('avl-dependency-node').find((n) => n.getAttribute('data-dependency') === id);

  it('lights the unit the host selects, one hop each way', async () => {
    render(<FlowCanvas schema={flowSchema} initialLevel="trait-expanded" initialOrbital="Shop" flowSelection="trait:Persistor" width={900} height={600} />);
    await waitFor(() => expect(unit('trait:Persistor')?.getAttribute('data-role')).toBe('selected'));
    expect(unit('behavior:std-modal')?.getAttribute('data-role')).toBe('upstream');
    expect(unit('behavior:std-browse')?.getAttribute('data-role')).toBe('downstream');
  });

  it('reports the unit the user clicks, with its traits', async () => {
    const picked = vi.fn();
    render(<FlowCanvas schema={flowSchema} initialLevel="trait-expanded" initialOrbital="Shop" flowSelection={null} onFlowSelect={picked} width={900} height={600} />);
    await waitFor(() => expect(unit('behavior:std-modal')).toBeDefined());
    fireEvent.click(unit('behavior:std-modal')!);
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ id: 'behavior:std-modal', traits: ['Form'] }));
  });

  it('an embedding host can leave out the toolbar', async () => {
    render(<FlowCanvas schema={flowSchema} initialLevel="trait-expanded" initialOrbital="Shop" toolbar={false} width={900} height={600} />);
    await waitFor(() => expect(unit('trait:Persistor')).toBeDefined());
    expect(screen.queryByTestId('flow-canvas-toolbar')).toBeNull();
  });

  it('refits when its frame resizes, if asked (a column that grows on hover)', async () => {
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class { observe(el: Element) { observed.push(el); } unobserve() {} disconnect() {} });
    render(<FlowCanvas schema={flowSchema} initialLevel="trait-expanded" initialOrbital="Shop" fitOnResize width={900} height={600} />);
    await waitFor(() => expect(unit('trait:Persistor')).toBeDefined());
    expect(observed).toContain(screen.getByTestId('flow-canvas-frame'));
  });

  it('control: without it the frame is not watched, so a user\'s pan and zoom survive a resize', async () => {
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class { observe(el: Element) { observed.push(el); } unobserve() {} disconnect() {} });
    render(<FlowCanvas schema={flowSchema} initialLevel="trait-expanded" initialOrbital="Shop" width={900} height={600} />);
    await waitFor(() => expect(unit('trait:Persistor')).toBeDefined());
    expect(observed).not.toContain(screen.getByTestId('flow-canvas-frame'));
  });

  it('control: the toolbar shows by default', async () => {
    render(<FlowCanvas schema={flowSchema} initialLevel="trait-expanded" initialOrbital="Shop" width={900} height={600} />);
    expect(await screen.findByTestId('flow-canvas-toolbar')).toBeInTheDocument();
  });

  it('control: without a host selection nothing is lit', async () => {
    render(<FlowCanvas schema={flowSchema} initialLevel="trait-expanded" initialOrbital="Shop" flowSelection={null} width={900} height={600} />);
    await waitFor(() => expect(unit('trait:Persistor')).toBeDefined());
    expect(screen.getAllByTestId('avl-dependency-node').map((n) => n.getAttribute('data-role'))).not.toContain('selected');
  });
});
