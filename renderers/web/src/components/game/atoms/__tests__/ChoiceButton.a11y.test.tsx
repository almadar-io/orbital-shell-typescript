import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChoiceButton } from '../ChoiceButton';
import { EventBusProvider, useEventBus } from '../../../../core';
import type { BusEvent } from '@almadar/core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const wrap = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

function CaptureChoice({ onChoice }: { onChoice: (payload: BusEvent['payload']) => void }): null {
  const bus = useEventBus();
  React.useEffect(() => bus.on('UI:CHOOSE', (event: BusEvent) => onChoice(event.payload)), [bus, onChoice]);
  return null;
}

describe('ChoiceButton', () => {
  it('reflects selected as aria-pressed', async () => {
    const { container } = wrap(
      <>
        <ChoiceButton text="Yes" selected />
        <ChoiceButton text="No" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'false');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('lets an explicit aria-label override', () => {
    wrap(<ChoiceButton text="Go" aria-label="Proceed" />);
    expect(screen.getByRole('button', { name: 'Proceed' })).toBeInTheDocument();
  });

  it('emits an empty object when no action payload is authored', () => {
    const onChoice = vi.fn();
    wrap(<><CaptureChoice onChoice={onChoice} /><ChoiceButton text="Open" action="CHOOSE" /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onChoice).toHaveBeenCalledWith({});
  });
});
