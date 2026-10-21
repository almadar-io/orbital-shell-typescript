import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UploadDropZone } from '../UploadDropZone';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

function setup(readAs?: 'dataUrl' | 'text') {
  const listener = vi.fn();
  const Listener: React.FC = () => {
    const bus = useEventBus();
    React.useEffect(() => bus.on('UI:LESSON_DROPPED', listener), [bus]);
    return null;
  };
  render(
    <EventBusProvider debug={false}>
      <Listener />
      <UploadDropZone action="LESSON_DROPPED" readAs={readAs} />
    </EventBusProvider>,
  );
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
  const file = new File(['# Lesson\n\nHello'], 'lesson.md', { type: 'text/markdown' });
  fireEvent.change(input, { target: { files: [file] } });
  return listener;
}

describe('UploadDropZone readAs', () => {
  it('text mode delivers the file text and name in the payload', async () => {
    const listener = setup('text');
    await waitFor(() => expect(listener).toHaveBeenCalled());
    const files = listener.mock.calls[0][0].payload.files;
    expect(files[0].name).toBe('lesson.md');
    expect(files[0].content).toBe('# Lesson\n\nHello');
  });

  it('control: default mode still delivers a base64 data URL', async () => {
    const listener = setup();
    await waitFor(() => expect(listener).toHaveBeenCalled());
    const files = listener.mock.calls[0][0].payload.files;
    expect(files[0].content.startsWith('data:text/markdown;base64,')).toBe(true);
  });

  it('control: explicit dataUrl equals the default', async () => {
    const listener = setup('dataUrl');
    await waitFor(() => expect(listener).toHaveBeenCalled());
    expect(listener.mock.calls[0][0].payload.files[0].content).toMatch(/^data:/);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
