/**
 * CanvasDndProvider's handleDragEnd — payload-kind branching.
 *
 * A `'pattern-instance'` drop (reorder of an already-placed pattern, see
 * OrbPreviewNode's L2 drag source) must emit the MOVE-shaped `UI:PATTERN_MOVE`
 * — not the insert-shaped `UI:PATTERN_DROP` a `'pattern'` (palette tile) drop
 * still emits unchanged. `@dnd-kit/core`'s `DndContext` is mocked to capture
 * `onDragEnd` so the branch can be exercised directly with a hand-built
 * `DragEndEvent`, without simulating a real pointer drag under jsdom.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { DragEndEvent, DragStartEvent, Active, Over } from '@dnd-kit/core';
import {
  CanvasDndProvider,
  type CanvasDragPayload,
  type CanvasDropTarget,
} from '../useCanvasDnd';
import { type BusEvent } from '@almadar/core';
import { useEventBus } from '../../core';

let capturedOnDragEnd: ((event: DragEndEvent) => void) | undefined;
let capturedOnDragStart: ((event: DragStartEvent) => void) | undefined;

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: (props: {
      children: React.ReactNode;
      onDragStart?: (event: DragStartEvent) => void;
      onDragEnd?: (event: DragEndEvent) => void;
    }) => {
      capturedOnDragStart = props.onDragStart;
      capturedOnDragEnd = props.onDragEnd;
      return props.children;
    },
  };
});

function makeActive(payload: CanvasDragPayload): Active {
  return {
    id: 'active-1',
    data: { current: { payload } },
    rect: { current: { initial: null, translated: null } },
  };
}

function makeOver(target: CanvasDropTarget, accepts: readonly string[]): Over {
  return {
    id: 'over-1',
    rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
    disabled: false,
    data: { current: { target, accepts } },
  };
}

function makeDragStartEvent(active: Active): DragStartEvent {
  return {
    active,
    activatorEvent: new MouseEvent('pointerdown', { clientX: 10, clientY: 10 }),
  };
}

function makeDragEndEvent(active: Active, over: Over | null): DragEndEvent {
  return {
    active,
    over,
    collisions: null,
    delta: { x: 40, y: 0 },
    activatorEvent: new MouseEvent('pointerdown', { clientX: 10, clientY: 10 }),
  };
}

/** Mounted inside the provider to observe the bus it emits on. */
function Listener({ onEvent }: { onEvent: (event: BusEvent) => void }): null {
  const { on } = useEventBus();
  React.useEffect(() => {
    const unsubMove = on('UI:PATTERN_MOVE', onEvent);
    const unsubDrop = on('UI:PATTERN_DROP', onEvent);
    return () => {
      unsubMove();
      unsubDrop();
    };
  }, [on, onEvent]);
  return null;
}

describe('CanvasDndProvider handleDragEnd', () => {
  afterEach(() => {
    capturedOnDragEnd = undefined;
    capturedOnDragStart = undefined;
    cleanup();
  });

  it('emits move-shaped UI:PATTERN_MOVE for a pattern-instance drop', () => {
    const events: BusEvent[] = [];
    render(
      <CanvasDndProvider>
        <Listener onEvent={(e) => events.push(e)} />
      </CanvasDndProvider>,
    );
    expect(capturedOnDragEnd).toBeDefined();

    const target: CanvasDropTarget = {
      level: 'l2',
      containerNode: { orbitalName: 'Widgets' },
      resolvePath: () => ({ parentPath: 'root', index: 2 }),
    };
    const payload: CanvasDragPayload = {
      kind: 'pattern-instance',
      data: {
        fromPath: 'root.children.0',
        loc: { orbitalName: 'Widgets', traitName: 'WidgetsList', transitionEvent: 'LOAD' },
      },
    };

    const active = makeActive(payload);
    capturedOnDragStart?.(makeDragStartEvent(active));
    capturedOnDragEnd?.(
      makeDragEndEvent(active, makeOver(target, ['pattern', 'pattern-instance'])),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('UI:PATTERN_MOVE');
    expect(events[0].payload).toEqual({
      fromPath: 'root.children.0',
      loc: { orbitalName: 'Widgets', traitName: 'WidgetsList', transitionEvent: 'LOAD' },
      toParentPath: 'root',
      toIndex: 2,
    });
  });

  it('still emits insert-shaped UI:PATTERN_DROP for a plain pattern (palette) drop', () => {
    const events: BusEvent[] = [];
    render(
      <CanvasDndProvider>
        <Listener onEvent={(e) => events.push(e)} />
      </CanvasDndProvider>,
    );

    const target: CanvasDropTarget = {
      level: 'l2',
      containerNode: { orbitalName: 'Widgets' },
      resolvePath: () => ({ parentPath: 'root', index: 1 }),
    };
    const payload: CanvasDragPayload = {
      kind: 'pattern',
      data: { type: 'typography' },
    };

    const active = makeActive(payload);
    capturedOnDragStart?.(makeDragStartEvent(active));
    capturedOnDragEnd?.(
      makeDragEndEvent(active, makeOver(target, ['pattern', 'pattern-instance'])),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('UI:PATTERN_DROP');
    expect(events[0].payload).toEqual({
      patternType: 'typography',
      containerNode: { orbitalName: 'Widgets' },
      parentPath: 'root',
      index: 1,
    });
  });

  it('drops a pattern-instance payload missing fromPath without emitting', () => {
    const events: BusEvent[] = [];
    render(
      <CanvasDndProvider>
        <Listener onEvent={(e) => events.push(e)} />
      </CanvasDndProvider>,
    );

    const target: CanvasDropTarget = {
      level: 'l2',
      containerNode: { orbitalName: 'Widgets' },
      resolvePath: () => ({ parentPath: 'root', index: 0 }),
    };
    const payload: CanvasDragPayload = {
      kind: 'pattern-instance',
      data: { loc: { orbitalName: 'Widgets' } },
    };

    const active = makeActive(payload);
    capturedOnDragStart?.(makeDragStartEvent(active));
    capturedOnDragEnd?.(
      makeDragEndEvent(active, makeOver(target, ['pattern', 'pattern-instance'])),
    );

    expect(events).toHaveLength(0);
  });
});
