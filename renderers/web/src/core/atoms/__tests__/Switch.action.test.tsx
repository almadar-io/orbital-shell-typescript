import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EventPayload } from '@almadar/core';
import { Switch } from '../../index';
import { EventBusProvider } from '../../index';
import { useEventBus } from '../../index';

function Recorder({ into }: { into: EventPayload[] }): null {
  const { on } = useEventBus();
  React.useEffect(() => on('UI:TOGGLE', (e) => { into.push(e.payload ?? {}); }), [on, into]);
  return null;
}

describe('Switch action', () => {
  it('a toggle emits the declared action with its payload and the new checked value', () => {
    const seen: EventPayload[] = [];
    render(<EventBusProvider debug={false}><Recorder into={seen} /><Switch label="Vim" checked={false} action="TOGGLE" actionPayload={{ behavior: 'vim-mode' }} /></EventBusProvider>);
    fireEvent.click(screen.getByRole('switch'));
    expect(seen).toEqual([{ behavior: 'vim-mode', checked: true }]);
  });

  it('turning it off sends checked false', () => {
    const seen: EventPayload[] = [];
    render(<EventBusProvider debug={false}><Recorder into={seen} /><Switch label="Vim" checked action="TOGGLE" actionPayload={{ behavior: 'vim-mode' }} /></EventBusProvider>);
    fireEvent.click(screen.getByRole('switch'));
    expect(seen).toEqual([{ behavior: 'vim-mode', checked: false }]);
  });

  it('control: no action, nothing is emitted', () => {
    const seen: EventPayload[] = [];
    render(<EventBusProvider debug={false}><Recorder into={seen} /><Switch label="Vim" checked={false} /></EventBusProvider>);
    fireEvent.click(screen.getByRole('switch'));
    expect(seen).toEqual([]);
  });

  it('edge: a disabled switch emits nothing', () => {
    const seen: EventPayload[] = [];
    render(<EventBusProvider debug={false}><Recorder into={seen} /><Switch label="Vim" checked={false} disabled action="TOGGLE" /></EventBusProvider>);
    fireEvent.click(screen.getByRole('switch'));
    expect(seen).toEqual([]);
  });
});
