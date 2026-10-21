import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { useEventBus } from '../../src/core';
import { DataList } from '../../src/components/core/molecules/DataList';
import { CalendarGrid } from '../../src/components/core/molecules/CalendarGrid';
import { StatDisplay } from '../../src/components/core/molecules/StatDisplay';
import { ProgressDots } from '../../src/components/core/molecules/ProgressDots';
import { FilterPill } from '../../src/core';
import { FlipContainer } from '../../src/core';
import { Chart } from '../../src/components/core/molecules/Chart';

const Listen: React.FC<{ event: string; spy: (p: unknown) => void }> = ({ event, spy }) => {
  const bus = useEventBus();
  React.useEffect(() => bus.on(event, (e) => spy(e.payload)), [bus, event, spy]);
  return null;
};

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('DataList row', () => {
  const rows = [{ id: '1', title: 'Task One' }];
  const fields = [{ name: 'title', variant: 'h4' as const }];

  it('with itemClickEvent: button role, Enter emits the row event', () => {
    const spy = vi.fn();
    wrap(
      <>
        <Listen event="UI:OPEN_ROW" spy={spy} />
        <DataList entity={rows} fields={fields} itemClickEvent="OPEN_ROW" />
      </>,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ id: '1' });
  });

  it('control: no click event and no actions means no button role', () => {
    wrap(<DataList entity={rows} fields={fields} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('CalendarGrid event chip', () => {
  const events = [{ id: 'e1', title: 'Standup', startTime: '2026-09-28T09:00:00', endTime: '2026-09-28T09:30:00' }];
  const weekStart = new Date(2026, 8, 28);

  it('with onEventClick: named button, Enter invokes it with the event', () => {
    const onEventClick = vi.fn();
    wrap(<CalendarGrid weekStart={weekStart} events={events} onEventClick={onEventClick} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Standup' }), { key: 'Enter' });
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0][0]).toMatchObject({ id: 'e1' });
  });

  it('control: without onEventClick the chip is not a button', () => {
    wrap(<CalendarGrid weekStart={weekStart} events={events} />);
    expect(screen.queryByRole('button', { name: 'Standup' })).toBeNull();
  });
});

describe('StatDisplay', () => {
  it('with clickEvent: button role, Space emits metricLabel', () => {
    const spy = vi.fn();
    wrap(
      <>
        <Listen event="UI:OPEN_STAT" spy={spy} />
        <StatDisplay label="Revenue" value={42} clickEvent="OPEN_STAT" />
      </>,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(spy).toHaveBeenCalledWith({ metricLabel: 'Revenue' });
  });

  it('control: without clickEvent it is not a button', () => {
    wrap(<StatDisplay label="Revenue" value={42} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ProgressDots', () => {
  it('with onDotClick: each dot is a named 24px button, Enter selects it', () => {
    const onDotClick = vi.fn();
    wrap(<ProgressDots count={3} currentIndex={0} onDotClick={onDotClick} />);
    const dots = screen.getAllByRole('button');
    expect(dots).toHaveLength(3);
    expect(dots[1].style.minWidth).toBe('24px');
    expect(dots[1].style.minHeight).toBe('24px');
    fireEvent.keyDown(dots[1], { key: 'Enter' });
    expect(onDotClick).toHaveBeenCalledWith(1);
  });

  it('control: without onDotClick there are no buttons', () => {
    wrap(<ProgressDots count={3} currentIndex={0} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('FilterPill', () => {
  it('with clickEvent: button role, Enter emits', () => {
    const spy = vi.fn();
    wrap(
      <>
        <Listen event="UI:PICK" spy={spy} />
        <FilterPill label="Open" clickEvent="PICK" />
      </>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open' }), { key: 'Enter' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('control: a plain pill is not a button', () => {
    wrap(<FilterPill label="Open" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('FlipContainer', () => {
  it('with onClick: button role, Enter flips', () => {
    const onClick = vi.fn();
    wrap(<FlipContainer flipped={false} onClick={onClick}>Card</FlipContainer>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('control: without onClick it is not a button', () => {
    wrap(<FlipContainer flipped={false}>Card</FlipContainer>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Chart bars', () => {
  const data = [{ label: 'Jan', value: 5 }];

  it('with drillEvent: bars are named buttons, Enter emits the drill event', () => {
    const spy = vi.fn();
    wrap(
      <>
        <Listen event="UI:DRILL" spy={spy} />
        <Chart chartType="bar" data={data} drillEvent="DRILL" />
      </>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Jan: 5' }), { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith({ label: 'Jan', value: 5, seriesLabel: undefined });
  });

  it('control: without drillEvent bars are not buttons', () => {
    wrap(<Chart chartType="bar" data={data} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
