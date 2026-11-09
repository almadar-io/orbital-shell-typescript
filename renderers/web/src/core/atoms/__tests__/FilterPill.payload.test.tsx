import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EventPayload } from '@almadar/core';
import { FilterPill } from '../../index';
import { EventBusProvider } from '../../index';
import { useEventBus } from '../../index';

function Recorder({ into }: { into: EventPayload[] }): null {
  const { on } = useEventBus();
  React.useEffect(() => on('UI:PICK', (e) => { into.push(e.payload ?? {}); }), [on, into]);
  return null;
}

describe('FilterPill clickPayload', () => {
  it('a click emits the declared event with its payload beside the label', () => {
    const seen: EventPayload[] = [];
    render(<EventBusProvider debug={false}><Recorder into={seen} /><FilterPill label="Dokument" clickEvent="PICK" clickPayload={{ templateId: 'dokument' }} /></EventBusProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Dokument' }));
    expect(seen).toEqual([{ label: 'Dokument', templateId: 'dokument' }]);
  });

  it('control: without a payload the click carries the label alone', () => {
    const seen: EventPayload[] = [];
    render(<EventBusProvider debug={false}><Recorder into={seen} /><FilterPill label="Dokument" clickEvent="PICK" /></EventBusProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Dokument' }));
    expect(seen).toEqual([{ label: 'Dokument' }]);
  });

  it('edge: Enter on the focused pill emits the same payload', () => {
    const seen: EventPayload[] = [];
    render(<EventBusProvider debug={false}><Recorder into={seen} /><FilterPill label="Zbirka" clickEvent="PICK" clickPayload={{ templateId: 'zbirka' }} /></EventBusProvider>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Zbirka' }), { key: 'Enter' });
    expect(seen).toEqual([{ label: 'Zbirka', templateId: 'zbirka' }]);
  });
});
