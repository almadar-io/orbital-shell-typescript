// @vitest-environment jsdom
/**
 * A canvas card is paused by default: clicking inside it selects the element
 * for editing and never drives the card's trait machine. Play makes it live.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import type { OrbitalSchema, Trait } from '@almadar/core';
import { OrbPreviewNode, PatternSelectionContext, CanvasToolsContext, CanvasStatePickerContext, type CanvasStatePicker, type SelectedPattern } from '../OrbPreviewNode';
import { stateOptionsOf, LIVE_STATE } from '../../../../lib/avl-preview-converter';
import { CANVAS_TOOLS, type CanvasTool } from '../../../../lib/canvas-tools';
import { CanvasDndProvider } from '../../../../hooks/useCanvasDnd';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import type { EventPayload } from '@almadar/core';
import { type PreviewNodeData } from '../../../../lib/avl-preview-converter';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// jsdom has no PointerEvent, so pointer coordinates would be dropped.
class PointerEventStub extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}
(globalThis as { PointerEvent?: unknown }).PointerEvent ??= PointerEventStub;

function schema(): OrbitalSchema {
  return {
    name: 'pause-app',
    version: '1.0.0',
    orbitals: [
      {
        name: 'Counter',
        entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'Clicker',
            linkedEntity: 'Item',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }, { name: 'done' }],
              events: [],
              transitions: [
                { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'button', label: 'Go', action: 'GO' }]] },
                { from: 'idle', to: 'done', event: 'GO', effects: [['render-ui', 'main', { type: 'typography', content: 'Went' }]] },
              ],
            },
          },
        ],
        pages: [{ name: 'Main', path: '/main', traits: [{ ref: 'Clicker' }] }],
      },
    ],
  } as OrbitalSchema;
}

function nodeProps(data: PreviewNodeData): NodeProps {
  return {
    id: 'card-1',
    type: 'orbPreview',
    data,
    selected: false,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

function renderCard(extra: Partial<PreviewNodeData> = {}) {
  const select = vi.fn();
  const data: PreviewNodeData = { orbitalName: 'Counter', patterns: [], eventSources: [], _fullSchema: schema(), ...extra };
  render(
    <ReactFlowProvider>
      <CanvasDndProvider>
        <PatternSelectionContext.Provider value={{ selected: null, select }}>
          <OrbPreviewNode {...nodeProps(data)} />
        </PatternSelectionContext.Provider>
      </CanvasDndProvider>
    </ReactFlowProvider>,
  );
  return { select };
}

/** Lets any dispatch the click caused settle before asserting it didn't happen. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('OrbPreviewNode — pause / play', () => {
  it('starts paused and still renders its first frame', async () => {
    renderCard();
    expect(await screen.findByText('Go')).toBeTruthy();
    expect(screen.getByTestId('orb-preview-play-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('paused: a click selects the element and never fires its event', async () => {
    const { select } = renderCard();
    fireEvent.click(await screen.findByText('Go'));
    await settle();
    expect(screen.queryByText('Went')).toBeNull();
    expect(screen.getByText('Go')).toBeTruthy();
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ patternType: expect.any(String) }));
  });

  it('paused: Enter on a focused control never fires its event either', async () => {
    renderCard();
    const button = await screen.findByText('Go');
    fireEvent.keyDown(button, { key: 'Enter' });
    await settle();
    expect(screen.queryByText('Went')).toBeNull();
  });

  it('playing: the same click drives the trait machine', async () => {
    renderCard();
    await screen.findByText('Go');
    fireEvent.click(screen.getByTestId('orb-preview-play-toggle'));
    expect(screen.getByTestId('orb-preview-play-toggle').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('Go'));
    await waitFor(() => expect(screen.getByText('Went')).toBeTruthy());
  });

  it('pausing again stops interaction', async () => {
    renderCard();
    await screen.findByText('Go');
    fireEvent.click(screen.getByTestId('orb-preview-play-toggle'));
    fireEvent.click(screen.getByTestId('orb-preview-play-toggle'));
    fireEvent.click(screen.getByText('Go'));
    await settle();
    expect(screen.queryByText('Went')).toBeNull();
  });
});

describe('OrbPreviewNode — header state picker', () => {
  function renderWithPicker(chosen: string) {
    const choose = vi.fn();
    const picker: CanvasStatePicker = {
      optionsOf: (orbital) => stateOptionsOf(schema(), orbital, 'screens'),
      chosen: () => chosen,
      choose,
    };
    render(
      <ReactFlowProvider>
        <CanvasDndProvider>
          <CanvasStatePickerContext.Provider value={picker}>
            <OrbPreviewNode {...nodeProps({ orbitalName: 'Counter', patterns: [], eventSources: [], _fullSchema: schema() })} />
          </CanvasStatePickerContext.Provider>
        </CanvasDndProvider>
      </ReactFlowProvider>,
    );
    return { choose, select: screen.getByTestId('canvas-state-Counter') as HTMLSelectElement };
  }

  it('a card is labelled by its orbital and lists the live orbital plus its render-ui states', () => {
    const { select } = renderWithPicker(LIVE_STATE);
    expect(screen.getByText('Counter')).toBeTruthy();
    expect(Array.from(select.options).map((o) => o.value)).toEqual([LIVE_STATE, ...stateOptionsOf(schema(), 'Counter', 'screens').own.map((o) => o.id)]);
    expect(select.value).toBe(LIVE_STATE);
  });

  it('picking a state asks the canvas to show it', () => {
    const { select, choose } = renderWithPicker(LIVE_STATE);
    const first = stateOptionsOf(schema(), 'Counter', 'screens').own[0];
    fireEvent.change(select, { target: { value: first.id } });
    expect(choose).toHaveBeenCalledWith('Counter', first.id);
  });

  it('without a canvas picker there is no dropdown', () => {
    renderCard();
    expect(screen.queryByTestId('canvas-state-Counter')).toBeNull();
  });
});

function stackSchema(className: string): OrbitalSchema {
  const base = schema();
  const trait = base.orbitals[0].traits[0];
  if (typeof trait === 'string' || !('stateMachine' in trait) || !trait.stateMachine) throw new Error('fixture');
  trait.stateMachine.transitions[0].effects = [
    ['render-ui', 'main', { type: 'stack', children: [{ type: 'button', label: 'Go', action: 'GO', className }] }],
  ];
  return base;
}

function BusSpy({ event, onEvent }: { event: string; onEvent: (payload: EventPayload | undefined) => void }): null {
  const { on } = useEventBus();
  React.useEffect(() => on(event, (e) => onEvent(e.payload)), [on, event, onEvent]);
  return null;
}

function renderL2Card(className = 'px-3 w-40') {
  const propChange = vi.fn();
  const deleted = vi.fn();
  const data: PreviewNodeData = {
    orbitalName: 'Counter', traitName: 'Clicker', transitionEvent: 'INIT', fromState: 'idle', toState: 'idle',
    patterns: [], eventSources: [], _fullSchema: stackSchema(className),
  };
  render(
    <EventBusProvider debug={false}>
      <BusSpy event="UI:PROP_CHANGE" onEvent={propChange} />
      <BusSpy event="UI:DELETE_PATTERN" onEvent={deleted} />
      <ReactFlowProvider>
        <CanvasDndProvider>
          <PatternSelectionContext.Provider value={{ selected: null, select: () => {} }}>
            <OrbPreviewNode {...nodeProps(data)} />
          </PatternSelectionContext.Provider>
        </CanvasDndProvider>
      </ReactFlowProvider>
    </EventBusProvider>,
  );
  return { propChange, deleted };
}

describe('OrbPreviewNode — selection frame (paused L2 card)', () => {
  // jsdom lays everything out at 0×0; give every element a real 80×30 box.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 10, left: 10, right: 90, bottom: 40, width: 80, height: 30, x: 10, y: 10, toJSON: () => ({}) },
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('selecting an element shows resize handles and its size', async () => {
    renderL2Card();
    fireEvent.click(await screen.findByText('Go'));
    expect(screen.getByTestId('orb-preview-selection')).toBeTruthy();
    expect(screen.getByTestId('design-resize-e')).toBeTruthy();
    expect(screen.getByTestId('design-resize-se')).toBeTruthy();
    expect(screen.getByTestId('orb-preview-size-label').textContent).toBe('80 × Hug');
  });

  it('dragging the right handle writes a snapped width class, keeping the rest', async () => {
    const { propChange } = renderL2Card('px-3 w-40');
    fireEvent.click(await screen.findByText('Go'));
    const handle = screen.getByTestId('design-resize-e');
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 40, pointerId: 1 });
    expect(screen.getByTestId('orb-preview-size-label').textContent).toBe('180 × 30');
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 40, pointerId: 1 });
    expect(propChange).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: 'local',
      propName: 'className',
      value: 'px-3 w-44',
      selection: expect.objectContaining({ patternPath: 'root.children.0', traitName: 'Clicker', transitionEvent: 'INIT' }),
    }));
  });

  it('the corner handle writes width and height', async () => {
    const { propChange } = renderL2Card('');
    fireEvent.click(await screen.findByText('Go'));
    const handle = screen.getByTestId('design-resize-se');
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 240, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(propChange).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'w-80 h-16' }));
  });

  // FlowCanvas owns Delete (document keydown → onPatternDelete); the card must
  // let it through rather than swallow it or emit a second delete.
  it('Delete reaches the canvas-level handler and the card emits no delete of its own', async () => {
    const { deleted } = renderL2Card();
    const docKeys = vi.fn();
    const onDocKey = (e: KeyboardEvent) => docKeys(e.key);
    document.addEventListener('keydown', onDocKey);
    const go = await screen.findByText('Go');
    fireEvent.click(go);
    fireEvent.keyDown(go, { key: 'Delete' });
    fireEvent.keyDown(go, { key: 'Backspace' });
    document.removeEventListener('keydown', onDocKey);
    expect(docKeys.mock.calls.map(([k]) => k)).toEqual(['Delete', 'Backspace']);
    expect(deleted).not.toHaveBeenCalled();
  });

  it('Esc with nothing selected reaches the canvas (level navigation)', async () => {
    renderL2Card();
    const docKeys = vi.fn();
    const onDocKey = (e: KeyboardEvent) => docKeys(e.key);
    document.addEventListener('keydown', onDocKey);
    fireEvent.keyDown(await screen.findByText('Go'), { key: 'Escape' });
    document.removeEventListener('keydown', onDocKey);
    expect(docKeys).toHaveBeenCalledWith('Escape');
  });

  // The card's paused click handler runs in the capture phase; a click on the
  // overlay's own controls must not read as a click on empty canvas.
  it('clicking the overlay controls keeps the selection', async () => {
    renderL2Card();
    fireEvent.click(await screen.findByText('Go'));
    fireEvent.click(screen.getByTestId('design-resize-e'));
    fireEvent.doubleClick(screen.getByTestId('design-resize-e'));
    expect(screen.getByTestId('orb-preview-selection')).toBeTruthy();
  });

  it('typing into the overlay spacing field is not swallowed by the card', async () => {
    renderL2Card();
    const go = await screen.findByText('Go');
    fireEvent.click(go);
    fireEvent.keyDown(go, { key: 'Escape' });
    const band = screen.getByTestId('design-padding-top');
    fireEvent.pointerDown(band, { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerUp(band, { clientX: 1, clientY: 1, pointerId: 1 });
    const field = screen.getByTestId('design-spacing-input');
    expect(fireEvent.keyDown(field, { key: '5' })).toBe(true);
  });

  it('a playing card shows the selection but no handles', async () => {
    renderL2Card();
    await screen.findByText('Go');
    fireEvent.click(screen.getByTestId('orb-preview-play-toggle'));
    fireEvent.click(screen.getByText('Go'));
    expect(screen.queryByTestId('design-resize-e')).toBeNull();
  });
});

describe('OrbPreviewNode — insertion line while dragging', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 10, left: 10, right: 90, bottom: 40, width: 80, height: 30, x: 10, y: 10, toJSON: () => ({}) },
    );
  });
  afterEach(() => vi.restoreAllMocks());

  function DragEmitter({ onReady }: { onReady: (emit: (type: string, payload: Record<string, string>) => void) => void }): null {
    const bus = useEventBus();
    React.useEffect(() => onReady((type, payload) => bus.emit(type, payload)), [bus, onReady]);
    return null;
  }

  it('shows where a dragged pattern would land, and clears when the drag ends', async () => {
    let emit: (type: string, payload: Record<string, string>) => void = () => {};
    const data: PreviewNodeData = {
      orbitalName: 'Counter', traitName: 'Clicker', transitionEvent: 'INIT', fromState: 'idle', toState: 'idle',
      patterns: [], eventSources: [], _fullSchema: stackSchema('px-3'),
    };
    render(
      <EventBusProvider debug={false}>
        <DragEmitter onReady={(fn) => { emit = fn; }} />
        <ReactFlowProvider>
          <CanvasDndProvider>
            <PatternSelectionContext.Provider value={{ selected: null, select: () => {} }}>
              <OrbPreviewNode {...nodeProps(data)} />
            </PatternSelectionContext.Provider>
          </CanvasDndProvider>
        </ReactFlowProvider>
      </EventBusProvider>,
    );
    const go = await screen.findByText('Go');
    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [go];
    try {
      act(() => emit('UI:DRAG_START', { kind: 'pattern' }));
      fireEvent.pointerMove(go, { clientX: 50, clientY: 20, pointerId: 1 });
      expect(screen.getByTestId('orb-preview-insertion-line')).toBeTruthy();
      act(() => emit('UI:DRAG_END', {}));
      expect(screen.queryByTestId('orb-preview-insertion-line')).toBeNull();
    } finally {
      document.elementsFromPoint = originalElementsFromPoint;
    }
  });
});

function threeButtonSchema(): OrbitalSchema {
  const base = schema();
  const trait = base.orbitals[0].traits[0];
  if (typeof trait === 'string' || !('stateMachine' in trait) || !trait.stateMachine) throw new Error('fixture');
  trait.stateMachine.transitions[0].effects = [
    ['render-ui', 'main', { type: 'stack', className: 'gap-4 p-2', children: [
      { type: 'button', label: 'One', action: 'A' },
      { type: 'button', label: 'Two', action: 'B' },
      { type: 'button', label: 'Three', action: 'C' },
    ] }],
  ];
  return base;
}

describe('OrbPreviewNode — keyboard (Figma selection + reorder)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 10, left: 10, right: 90, bottom: 40, width: 80, height: 30, x: 10, y: 10, toJSON: () => ({}) },
    );
  });
  afterEach(() => vi.restoreAllMocks());

  function mountThree(tools: readonly CanvasTool[] = CANVAS_TOOLS) {
    const moved = vi.fn();
    const duplicated = vi.fn();
    const wrapped = vi.fn();
    const pasted = vi.fn();
    const deleted = vi.fn();
    const selected = vi.fn<(p: SelectedPattern | null) => void>();
    const data: PreviewNodeData = {
      orbitalName: 'Counter', traitName: 'Clicker', transitionEvent: 'INIT', fromState: 'idle', toState: 'idle',
      patterns: [], eventSources: [], _fullSchema: threeButtonSchema(),
    };
    render(
      <EventBusProvider debug={false}>
        <BusSpy event="UI:PATTERN_MOVE" onEvent={moved} />
        <BusSpy event="UI:PATTERN_DUPLICATE" onEvent={duplicated} />
        <BusSpy event="UI:PATTERN_WRAP" onEvent={wrapped} />
        <BusSpy event="UI:PATTERN_PASTE" onEvent={pasted} />
        <BusSpy event="UI:DELETE_PATTERN" onEvent={deleted} />
        <ReactFlowProvider>
          <CanvasDndProvider>
            <CanvasToolsContext.Provider value={tools}>
              <PatternSelectionContext.Provider value={{ selected: null, select: selected }}>
                <OrbPreviewNode {...nodeProps(data)} />
              </PatternSelectionContext.Provider>
            </CanvasToolsContext.Provider>
          </CanvasDndProvider>
        </ReactFlowProvider>
      </EventBusProvider>,
    );
    return { moved, duplicated, wrapped, selected, pasted, deleted };
  }

  const LOC = { orbitalName: 'Counter', traitName: 'Clicker', transitionEvent: 'INIT' };

  // A real keypress goes to the focused element; clicking text focuses
  // nothing, so the card must take focus itself or its keys never fire.
  it('selecting an element focuses the card, so keys pressed next reach it', async () => {
    mountThree();
    const two = await screen.findByText('Two');
    fireEvent.click(two);
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
    expect(focused?.closest('.orb-preview-live')).toBeTruthy();
  });

  it('shift-click adds elements to the selection; the last one is primary', async () => {
    const { selected } = mountThree();
    fireEvent.click(await screen.findByText('One'));
    fireEvent.click(screen.getByText('Three'), { shiftKey: true });
    expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({ patternId: 'root.children.2', selection: ['root.children.0', 'root.children.2'] }));
    expect(screen.getAllByTestId('orb-preview-selection-extra')).toHaveLength(1);
  });

  it('shift-click on a selected element takes it out', async () => {
    const { selected } = mountThree();
    fireEvent.click(await screen.findByText('One'));
    fireEvent.click(screen.getByText('Two'), { shiftKey: true });
    fireEvent.click(screen.getByText('Two'), { shiftKey: true });
    expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({ patternId: 'root.children.0', selection: ['root.children.0'] }));
    expect(screen.queryByTestId('orb-preview-selection-extra')).toBeNull();
  });

  it('a plain click replaces the selection', async () => {
    const { selected } = mountThree();
    fireEvent.click(await screen.findByText('One'));
    fireEvent.click(screen.getByText('Two'), { shiftKey: true });
    fireEvent.click(screen.getByText('Three'));
    expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({ selection: ['root.children.2'] }));
  });

  it('without the multi-select tool, shift-click just selects', async () => {
    const { selected } = mountThree(['designHandles']);
    fireEvent.click(await screen.findByText('One'));
    fireEvent.click(screen.getByText('Three'), { shiftKey: true });
    expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({ selection: ['root.children.2'] }));
  });

  it('⌘D and ⇧A act on every selected element', async () => {
    const { duplicated, wrapped } = mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.click(screen.getByText('Two'), { shiftKey: true });
    fireEvent.keyDown(one, { key: 'd', metaKey: true });
    expect(duplicated).toHaveBeenLastCalledWith(expect.objectContaining({ paths: ['root.children.0', 'root.children.1'], loc: LOC }));
    fireEvent.click(one);
    fireEvent.click(screen.getByText('Two'), { shiftKey: true });
    fireEvent.keyDown(one, { key: 'A', shiftKey: true });
    expect(wrapped).toHaveBeenLastCalledWith(expect.objectContaining({ paths: ['root.children.0', 'root.children.1'], loc: LOC }));
  });

  it('without the design-handles tool the selection is outlined but has no handles', async () => {
    mountThree(['multiSelect', 'clipboard', 'inlineText', 'zoomToSelection']);
    fireEvent.click(await screen.findByText('One'));
    expect(screen.getByTestId('orb-preview-selection')).toBeTruthy();
    expect(screen.queryByTestId('design-resize-e')).toBeNull();
  });

  // A fake clipboard the copy/cut/paste events carry, as the browser's does.
  function clipboard(initial: Record<string, string> = {}) {
    const store: Record<string, string> = { ...initial };
    return {
      store,
      clipboardData: {
        setData: (type: string, value: string) => { store[type] = value; },
        getData: (type: string) => store[type] ?? '',
      },
    };
  }
  const MIME = 'application/x-almadar-patterns';

  it('⌘C copies the selected elements as stored in the schema', async () => {
    mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.click(screen.getByText('Three'), { shiftKey: true });
    const board = clipboard();
    fireEvent.copy(one, { clipboardData: board.clipboardData });
    expect(JSON.parse(board.store[MIME])).toEqual([
      { type: 'button', label: 'One', action: 'A' },
      { type: 'button', label: 'Three', action: 'C' },
    ]);
    expect(board.store['text/plain']).toBeTruthy();
  });

  it('⌘V pastes after the selected element', async () => {
    const { pasted } = mountThree();
    const two = await screen.findByText('Two');
    fireEvent.click(two);
    fireEvent.paste(two, { clipboardData: clipboard({ [MIME]: JSON.stringify([{ type: 'badge', label: 'N' }]) }).clipboardData });
    expect(pasted).toHaveBeenCalledWith({ loc: LOC, parentPath: 'root', index: 2, patternsJson: JSON.stringify([{ type: 'badge', label: 'N' }]) });
  });

  it('⌘V with a container selected pastes at its end', async () => {
    const { pasted } = mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.keyDown(one, { key: 'Escape' });
    fireEvent.paste(one, { clipboardData: clipboard({ [MIME]: JSON.stringify([{ type: 'badge', label: 'N' }]) }).clipboardData });
    expect(pasted).toHaveBeenCalledWith(expect.objectContaining({ parentPath: 'root', index: 3 }));
  });

  it('other clipboard content is not pasted', async () => {
    const { pasted } = mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.paste(one, { clipboardData: clipboard({ 'text/plain': 'hello' }).clipboardData });
    fireEvent.paste(one, { clipboardData: clipboard({ [MIME]: 'not json' }).clipboardData });
    expect(pasted).not.toHaveBeenCalled();
  });

  it('⌘X copies and removes the selected elements', async () => {
    const { deleted } = mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.click(screen.getByText('Two'), { shiftKey: true });
    const board = clipboard();
    fireEvent.cut(one, { clipboardData: board.clipboardData });
    expect(JSON.parse(board.store[MIME])).toHaveLength(2);
    expect(deleted).toHaveBeenCalledWith({
      patternIds: ['root.children.0', 'root.children.1'],
      elements: [
        { orbital: 'Counter', trait: 'Clicker', transition: 'INIT', slot: 'main', path: 'root.children.0' },
        { orbital: 'Counter', trait: 'Clicker', transition: 'INIT', slot: 'main', path: 'root.children.1' },
      ],
    });
  });

  // The browser only fires copy/cut/paste if the shortcut's keydown isn't cancelled.
  it('⌘C, ⌘X and ⌘V keydowns reach the browser', async () => {
    mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    for (const key of ['c', 'x', 'v']) {
      expect(fireEvent.keyDown(one, { key, metaKey: true })).toBe(true);
      expect(fireEvent.keyDown(one, { key, ctrlKey: true })).toBe(true);
    }
  });

  it('double-clicking a label edits it in place; typing reaches it and Enter saves', async () => {
    mountThree();
    const label = await screen.findByText('Two');
    fireEvent.doubleClick(label);
    expect(label.getAttribute('contenteditable')).toBe('true');
    // The card's own key handling leaves the edited text alone.
    expect(fireEvent.keyDown(label, { key: 'x' })).toBe(true);
    label.textContent = 'Deux';
    fireEvent.keyDown(label, { key: 'Enter' });
    expect(label.getAttribute('contenteditable')).toBeNull();
  });

  it('without the inline-text tool, double-click does not edit', async () => {
    mountThree(['designHandles']);
    const label = await screen.findByText('Two');
    fireEvent.doubleClick(label);
    expect(label.getAttribute('contenteditable')).toBeNull();
  });

  it('⇧1 / ⇧2 are the canvas zoom shortcuts only with the zoom tool', async () => {
    mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    expect(fireEvent.keyDown(one, { key: '@', code: 'Digit2', shiftKey: true })).toBe(false);
    expect(fireEvent.keyDown(one, { key: '!', code: 'Digit1', shiftKey: true })).toBe(false);
  });

  it('without the clipboard tool nothing is copied or pasted', async () => {
    const { pasted } = mountThree(['designHandles']);
    const one = await screen.findByText('One');
    fireEvent.click(one);
    const board = clipboard();
    fireEvent.copy(one, { clipboardData: board.clipboardData });
    expect(board.store[MIME]).toBeUndefined();
    fireEvent.paste(one, { clipboardData: clipboard({ [MIME]: JSON.stringify([{ type: 'badge' }]) }).clipboardData });
    expect(pasted).not.toHaveBeenCalled();
  });

  it('⌘D and Ctrl+D duplicate the selection', async () => {
    const { duplicated } = mountThree();
    const two = await screen.findByText('Two');
    fireEvent.click(two);
    fireEvent.keyDown(two, { key: 'd', metaKey: true });
    fireEvent.keyDown(two, { key: 'd', ctrlKey: true });
    expect(duplicated).toHaveBeenCalledTimes(2);
    expect(duplicated).toHaveBeenCalledWith(expect.objectContaining({ paths: ['root.children.1'], loc: LOC }));
  });

  it('⇧A wraps the selection in an auto-layout stack', async () => {
    const { wrapped } = mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.keyDown(one, { key: 'A', shiftKey: true });
    expect(wrapped).toHaveBeenCalledWith(expect.objectContaining({ paths: ['root.children.0'], loc: LOC }));
  });

  it('plain d and plain a do nothing; nothing selected does nothing', async () => {
    const { duplicated, wrapped } = mountThree();
    const one = await screen.findByText('One');
    fireEvent.keyDown(one, { key: 'd', metaKey: true });
    fireEvent.keyDown(one, { key: 'A', shiftKey: true });
    fireEvent.click(one);
    fireEvent.keyDown(one, { key: 'd' });
    fireEvent.keyDown(one, { key: 'a' });
    expect(duplicated).not.toHaveBeenCalled();
    expect(wrapped).not.toHaveBeenCalled();
  });

  it('the tree root is neither duplicated nor wrapped', async () => {
    const { duplicated, wrapped } = mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.keyDown(one, { key: 'Escape' });
    fireEvent.keyDown(one, { key: 'd', metaKey: true });
    fireEvent.keyDown(one, { key: 'A', shiftKey: true });
    expect(duplicated).not.toHaveBeenCalled();
    expect(wrapped).not.toHaveBeenCalled();
  });

  it('⌘D keeps the browser from bookmarking the page', async () => {
    mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    const notCancelled = fireEvent.keyDown(one, { key: 'd', metaKey: true });
    expect(notCancelled).toBe(false);
  });

  it('Esc selects the parent container (with spacing handles); Enter goes back into its first child', async () => {
    mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.keyDown(one, { key: 'Escape' });
    expect(screen.getByTestId('design-padding-top')).toBeTruthy();
    fireEvent.keyDown(one, { key: 'Enter' });
    expect(screen.queryByTestId('design-padding-top')).toBeNull();
  });

  it('ArrowDown moves the selected element one place later among its siblings', async () => {
    const { moved } = mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    expect(moved).toHaveBeenCalledWith(expect.objectContaining({ fromPath: 'root.children.0', toParentPath: 'root', toIndex: 2 }));
  });

  it('ArrowUp on the first child does nothing', async () => {
    const { moved } = mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.keyDown(one, { key: 'ArrowUp' });
    expect(moved).not.toHaveBeenCalled();
  });

  it('ArrowUp on a later child moves it one place earlier', async () => {
    const { moved } = mountThree();
    const three = await screen.findByText('Three');
    fireEvent.click(three);
    fireEvent.keyDown(three, { key: 'ArrowUp' });
    expect(moved).toHaveBeenCalledWith(expect.objectContaining({ fromPath: 'root.children.2', toIndex: 1 }));
  });

  it('Esc on the root clears the selection', async () => {
    mountThree();
    const one = await screen.findByText('One');
    fireEvent.click(one);
    fireEvent.keyDown(one, { key: 'Escape' });
    fireEvent.keyDown(one, { key: 'Escape' });
    expect(screen.queryByTestId('orb-preview-selection')).toBeNull();
  });
});

/** A card whose stack embeds two behaviors' frames (`@trait.X` in its children) — how real apps are built. */
function embeddedSchema(): OrbitalSchema {
  const base = schema();
  const orbital = base.orbitals[0];
  const button = (name: string, label: string): Trait => ({
    name, linkedEntity: 'Item',
    stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'button', label, action: 'GO' }]] }] },
  });
  const card = orbital.traits[0];
  if (typeof card === 'string' || !('stateMachine' in card) || !card.stateMachine) throw new Error('fixture');
  card.stateMachine.transitions[0].effects = [['render-ui', 'main', { type: 'stack', children: [{ type: 'typography', content: 'Own text' }, '@trait.SaveButton', '@trait.HelpButton'] }]];
  orbital.traits.push(button('SaveButton', 'Save'), button('HelpButton', 'Help'));
  orbital.pages = [{ name: 'Main', path: '/main', traits: [{ ref: 'Clicker' }, { ref: 'SaveButton' }, { ref: 'HelpButton' }] }];
  return base;
}

describe('OrbPreviewNode — elements drawn by embedded behaviors', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 10, left: 10, right: 90, bottom: 40, width: 80, height: 30, x: 10, y: 10, toJSON: () => ({}) },
    );
  });
  afterEach(() => vi.restoreAllMocks());

  function mountEmbedded() {
    const structure = vi.fn();
    const duplicated = vi.fn();
    const moved = vi.fn();
    const selected = vi.fn<(p: SelectedPattern | null) => void>();
    const data: PreviewNodeData = {
      orbitalName: 'Counter', traitName: 'Clicker', transitionEvent: 'INIT', fromState: 'idle', toState: 'idle',
      patterns: [], eventSources: [], _fullSchema: embeddedSchema(),
    };
    render(
      <EventBusProvider debug={false}>
        <BusSpy event="UI:STRUCTURE_EDIT" onEvent={structure} />
        <BusSpy event="UI:PATTERN_DUPLICATE" onEvent={duplicated} />
        <BusSpy event="UI:PATTERN_MOVE" onEvent={moved} />
        <ReactFlowProvider>
          <CanvasDndProvider>
            <PatternSelectionContext.Provider value={{ selected: null, select: selected }}>
              <OrbPreviewNode {...nodeProps(data)} />
            </PatternSelectionContext.Provider>
          </CanvasDndProvider>
        </ReactFlowProvider>
      </EventBusProvider>,
    );
    return { structure, duplicated, moved, selected };
  }

  const help = { orbital: 'Counter', trait: 'HelpButton', transition: 'INIT', slot: 'main', path: 'root' };
  const save = { ...help, trait: 'SaveButton' };

  it("a click selects the element at its own address (the embedded behavior's trait, not the card's)", async () => {
    const { selected } = mountEmbedded();
    fireEvent.click(await screen.findByText('Help'));
    expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({ focus: expect.objectContaining({ trait: 'HelpButton', path: 'root', slot: 'main' }) }));
  });

  it('two embedded behaviors (both at their own root) are two selected elements', async () => {
    const { selected } = mountEmbedded();
    fireEvent.click(await screen.findByText('Save'));
    fireEvent.click(screen.getByText('Help'), { shiftKey: true });
    const last = selected.mock.calls[selected.mock.calls.length - 1][0];
    expect(last?.elements?.map((e) => e.trait)).toEqual(['SaveButton', 'HelpButton']);
    fireEvent.click(screen.getByText('Save'), { shiftKey: true });
    const after = selected.mock.calls[selected.mock.calls.length - 1][0];
    expect(after?.elements?.map((e) => e.trait)).toEqual(['HelpButton']);
  });

  it('⌘D on an embedded behavior is a structure edit at its address, not a path edit on the card', async () => {
    const { structure, duplicated } = mountEmbedded();
    const button = await screen.findByText('Help');
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'd', metaKey: true });
    expect(structure).toHaveBeenCalledWith({ op: 'duplicate', elements: [help] });
    expect(duplicated).not.toHaveBeenCalled();
  });

  it('the arrow keys move an embedded behavior among its container by one place', async () => {
    const { structure, moved } = mountEmbedded();
    const button = await screen.findByText('Help');
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    expect(structure).toHaveBeenCalledWith({ op: 'move', elements: [help], by: -1 });
    expect(moved).not.toHaveBeenCalled();
  });

  it('⇧A on two embedded siblings wraps them, as one structure edit', async () => {
    const { structure } = mountEmbedded();
    fireEvent.click(await screen.findByText('Save'));
    const button = screen.getByText('Help');
    fireEvent.click(button, { shiftKey: true });
    fireEvent.keyDown(button, { key: 'A', shiftKey: true });
    expect(structure).toHaveBeenCalledWith({ op: 'wrap', elements: [save, help] });
  });

  it("the card's own node keeps the path edit, and says which element it is", async () => {
    const { duplicated, structure } = mountEmbedded();
    const own = await screen.findByText('Own text');
    fireEvent.click(own);
    fireEvent.keyDown(own, { key: 'd', metaKey: true });
    expect(duplicated).toHaveBeenCalledWith(expect.objectContaining({
      paths: ['root.children.0'],
      elements: [{ orbital: 'Counter', trait: 'Clicker', transition: 'INIT', slot: 'main', path: 'root.children.0' }],
    }));
    expect(structure).not.toHaveBeenCalled();
  });
});

// In the canvas's local view cards aren't draggable, and React Flow then pans
// the pane on any drag that starts on a card — unless the content opts out.
// The live area must own its pointer gestures (reorder, marquee, absolute
// drag, drop-at-index) in both views; the header stays a drag/pan handle.
describe('OrbPreviewNode — the live area owns its gestures', () => {
  it('the live preview area opts out of both node dragging and canvas panning', async () => {
    renderCard();
    await screen.findByText('Go');
    const live = document.querySelector('.orb-preview-live');
    expect(live?.classList.contains('nodrag')).toBe(true);
    expect(live?.classList.contains('nopan')).toBe(true);
  });

  it('control: the card header is not opted out (it still drags / pans)', async () => {
    renderCard();
    await screen.findByText('Go');
    const toggle = screen.getByTestId('orb-preview-play-toggle');
    expect(toggle.closest('.nopan')).toBeNull();
  });
});

describe('OrbPreviewNode — status marks', () => {
  it('a card whose orbital has problems carries an error badge with its own label', async () => {
    renderCard({ status: 'error' });
    await screen.findByText('Go');
    const badge = screen.getByTestId('orb-preview-error-badge');
    expect(badge.getAttribute('title')).toBeTruthy();
    expect(badge.getAttribute('title')).not.toBe(badge.getAttribute('data-testid'));
  });

  it('control: an idle card has no badge', async () => {
    renderCard({ status: 'idle' });
    await screen.findByText('Go');
    expect(screen.queryByTestId('orb-preview-error-badge')).toBeNull();
  });

  it('edge: a running card shows the spinner, not the error badge', async () => {
    renderCard({ status: 'running' });
    await screen.findByText('Go');
    expect(screen.queryByTestId('orb-preview-error-badge')).toBeNull();
  });
});
