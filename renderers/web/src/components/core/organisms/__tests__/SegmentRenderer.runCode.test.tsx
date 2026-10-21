import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EventPayload } from '@almadar/core';
import { SegmentRenderer } from '../SegmentRenderer';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

function Listen({ event, onEvent }: { event: string; onEvent: (payload: EventPayload | undefined) => void }) {
  const bus = useEventBus();
  React.useEffect(() => bus.on(`UI:${event}`, (e) => onEvent(e.payload)), [bus, event, onEvent]);
  return null;
}

const segments = [
  { type: 'markdown' as const, content: 'Intro' },
  { type: 'code' as const, language: 'python', content: 'print(2)', runnable: true },
];

describe('SegmentRenderer runnable code (declared run contract)', () => {
  it('a runnable block emits runCodeEvent with its segment runId and shows that segment’s bound output', () => {
    const onEvent = vi.fn();
    render(
      <EventBusProvider debug={false}>
        <Listen event="RUN_LESSON_CODE" onEvent={onEvent} />
        <SegmentRenderer
          segments={segments}
          runCodeEvent="RUN_LESSON_CODE"
          codeOutputs={{ '1': { stdout: '2', stderr: '', exitCode: 0, testResults: [] } }}
        />
      </EventBusProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onEvent).toHaveBeenCalledWith({ code: 'print(2)', language: 'python', runId: '1' });
    expect(screen.getByText('Exit 0')).toBeTruthy();
  });

  it('control: without runCodeEvent a runnable block is read-only', () => {
    render(
      <EventBusProvider debug={false}>
        <SegmentRenderer segments={segments} />
      </EventBusProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });
});
