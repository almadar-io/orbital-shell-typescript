/**
 * A Gantt row opens its task from the task name as well as from the bar: the
 * name column is the larger target, and Project Friday's reviewer clicked it.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { EventPayload } from '@almadar/core';
import { EventBusProvider, useEventBus } from '../../../../core/index';
import { Gantt } from '../Gantt';

function Recorder({ into }: { into: EventPayload[] }): null {
  const { on } = useEventBus();
  React.useEffect(() => on('UI:OPEN_TASK', (e) => { into.push(e.payload ?? {}); }), [on, into]);
  return null;
}

const tasks = [{ id: 'a', title: 'A', start: '2026-10-05', end: '2026-10-07' }];

describe('Gantt label click', () => {
  it('clicking a task name emits the bar click event with that task id', () => {
    const seen: EventPayload[] = [];
    const { container } = render(<EventBusProvider debug={false}><Recorder into={seen} /><Gantt tasks={tasks} barClickEvent="OPEN_TASK" showToday={false} /></EventBusProvider>);
    const label = container.querySelector('[data-gantt-label="a"]');
    expect(label).not.toBeNull();
    fireEvent.click(label as Element);
    expect(seen).toEqual([{ id: 'a' }]);
  });

  it('control: without a bar click event the name emits nothing', () => {
    const seen: EventPayload[] = [];
    const { container } = render(<EventBusProvider debug={false}><Recorder into={seen} /><Gantt tasks={tasks} showToday={false} /></EventBusProvider>);
    fireEvent.click(container.querySelector('[data-gantt-label="a"]') as Element);
    expect(seen).toEqual([]);
  });
});
