import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeRunnerPanel, type CodeSimulationOutput } from '../CodeRunnerPanel';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import type { EventPayload } from '@almadar/core';

const result: CodeSimulationOutput = { stdout: 'ok', stderr: '', exitCode: 0, testResults: [] };

function Listen({ event, onEvent }: { event: string; onEvent: (payload: EventPayload | undefined) => void }) {
  const bus = useEventBus();
  React.useEffect(() => bus.on(`UI:${event}`, (e) => onEvent(e.payload)), [bus, event, onEvent]);
  return null;
}

function renderPanel(props: Partial<React.ComponentProps<typeof CodeRunnerPanel>>, listen?: { event: string; onEvent: (p: EventPayload | undefined) => void }) {
  return render(
    <EventBusProvider debug={false}>
      {listen ? <Listen {...listen} /> : null}
      <CodeRunnerPanel code="print(1)" language="python" {...props} />
    </EventBusProvider>,
  );
}

describe('CodeRunnerPanel run contract (declared events + bound result)', () => {
  it('Run emits the declared runEvent with the code, language and runId as the request', () => {
    const onEvent = vi.fn();
    renderPanel({ runnable: true, runEvent: 'RUN_LESSON_CODE', runId: 'seg-3' }, { event: 'RUN_LESSON_CODE', onEvent });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onEvent).toHaveBeenCalledWith({ code: 'print(1)', language: 'python', runId: 'seg-3' });
  });

  it('renders the bound output: stdout, exit badge and test rows', () => {
    renderPanel({ runnable: true, output: { ...result, testResults: [{ input: '1', expectedOutput: '1', actualOutput: '1', passed: true }] } });
    expect(screen.getByText('ok')).toBeTruthy();
    expect(screen.getByText('Exit 0')).toBeTruthy();
    expect(screen.getByText('Test 1: passed')).toBeTruthy();
  });

  it('a bound running flag shows the busy Run, which keeps focus', () => {
    const { rerender } = renderPanel({ runnable: true });
    const run = screen.getByRole('button', { name: 'Run' });
    run.focus();
    rerender(
      <EventBusProvider debug={false}>
        <CodeRunnerPanel code="print(1)" language="python" runnable running />
      </EventBusProvider>,
    );
    const busyRun = screen.getAllByRole('button').find((b) => b.getAttribute('aria-busy') === 'true');
    expect(busyRun).toBeDefined();
    expect(document.activeElement).toBe(busyRun);
  });

  it('a bound error replaces the output body', () => {
    renderPanel({ runnable: true, error: 'SyntaxError: bad input' });
    expect(screen.getByText('SyntaxError: bad input')).toBeTruthy();
  });

  it('Reset restores the authored code and emits the declared resetEvent', () => {
    const onEvent = vi.fn();
    renderPanel({ runnable: true, resetEvent: 'RESET_LESSON_CODE', runId: 'seg-3' }, { event: 'RESET_LESSON_CODE', onEvent });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onEvent).toHaveBeenCalledWith({ runId: 'seg-3' });
  });

  it('control: without runnable the panel is a read-only code block with no Run button', () => {
    renderPanel({});
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });
});
