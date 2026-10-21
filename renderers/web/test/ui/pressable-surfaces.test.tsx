import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { Card } from '../../src/core';
import { Avatar } from '../../src/core';
import { DayCell } from '../../src/core';
import { TimeSlotCell } from '../../src/core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('clickable surfaces are keyboard-operable', () => {
  it('Card with onClick: button role, Enter activates', () => {
    const onClick = vi.fn();
    wrap(<Card onClick={onClick}>Body</Card>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('control: a Card without an action is not a button', () => {
    wrap(<Card>Body</Card>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Avatar with onClick: named button, Space activates', () => {
    const onClick = vi.fn();
    wrap(<Avatar name="Ada Lovelace" onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Ada Lovelace' });
    fireEvent.keyDown(btn, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('DayCell with onClick: named by its date, Enter activates', () => {
    const onClick = vi.fn();
    const date = new Date(2026, 8, 30);
    wrap(<DayCell date={date} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button', { name: new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(date) }), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith(date);
  });

  it('TimeSlotCell with onClick: named by its time, Enter activates', () => {
    const onClick = vi.fn();
    wrap(<TimeSlotCell time="09:00" onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button', { name: '09:00' }), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith('09:00');
  });
});

describe('a Box with a declared action is a control', () => {
  it('is a keyboard-operable button that emits its action', async () => {
    const { Box } = await import('../../src/core');
    const { useEventBus } = await import('../../src/core');
    const spy = vi.fn();
    function Listen() {
      const bus = useEventBus();
      React.useEffect(() => bus.on('UI:OPEN_THING', () => spy()), [bus]);
      return null;
    }
    wrap(<><Listen /><Box action="OPEN_THING">Thing</Box></>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Thing' }), { key: 'Enter' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('control: a caller-given role wins, and a plain Box is not a control', async () => {
    const { Box } = await import('../../src/core');
    wrap(<><Box action="X" role="none">A</Box><Box>B</Box></>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
