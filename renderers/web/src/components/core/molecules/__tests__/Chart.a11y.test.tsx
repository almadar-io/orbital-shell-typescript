import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Chart } from '../Chart';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const series = [
  { name: 'Revenue', data: [{ label: 'Jan', value: 10 }, { label: 'Feb', value: 20 }] },
  { name: 'Cost', data: [{ label: 'Jan', value: 5 }, { label: 'Feb', value: 8 }] },
];
const single = [{ label: 'A', value: 3 }, { label: 'B', value: 7 }];

function Wrap({ children, onDrill }: { children: React.ReactNode; onDrill?: (p: unknown) => void }) {
  const bus = useEventBus();
  React.useEffect(() => (onDrill ? bus.on('UI:DRILL', (e) => onDrill(e.payload)) : undefined), [bus, onDrill]);
  return <>{children}</>;
}

const renderChart = (ui: React.ReactElement, onDrill?: (p: unknown) => void) =>
  render(
    <EventBusProvider debug={false}>
      <Wrap onDrill={onDrill}>{ui}</Wrap>
    </EventBusProvider>,
  );

describe('Chart a11y', () => {
  it('drillable bars are named buttons built from category, series and value, and Enter/Space drills', async () => {
    const onDrill = vi.fn();
    const { container } = renderChart(<Chart series={series} look="bar-vertical" drillEvent="DRILL" aria-label="Sales" />, onDrill);
    const bar = screen.getByRole('button', { name: 'Jan, Revenue: 10' });
    expect(bar.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(bar, { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Feb, Cost: 8' }), { key: ' ' });
    expect(onDrill).toHaveBeenCalledTimes(2);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: without drillEvent nothing is a button and bars carry no stray aria-label', async () => {
    const { container } = renderChart(<Chart series={series} look="bar-vertical" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect([...container.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label'))).toEqual(['Chart']);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('pie segments and line points are keyboard-operable named buttons', async () => {
    const onDrill = vi.fn();
    const pie = renderChart(<Chart data={single} look="pie" drillEvent="DRILL" />, onDrill);
    const seg = screen.getByRole('button', { name: 'A: 3' });
    fireEvent.keyDown(seg, { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledTimes(1);
    expect(describeViolations(await axeViolations(pie.container))).toEqual([]);
    pie.unmount();

    renderChart(<Chart series={series} look="line" drillEvent="DRILL" />, onDrill);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Feb, Revenue: 20' }), { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledTimes(2);
  });

  it('scatter points use the point label, falling back to coordinates', () => {
    renderChart(
      <Chart look="scatter" scatterData={[{ x: 1, y: 2, label: 'P1' }, { x: 3, y: 4 }]} drillEvent="DRILL" />,
    );
    expect(screen.getByRole('button', { name: 'P1: 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '(3, 4): 4' })).toBeTruthy();
  });

  it('forwards aria-label to the chart root', () => {
    renderChart(<Chart data={single} look="bar-vertical" aria-label="Sales chart" />);
    expect(screen.getByLabelText('Sales chart')).toBeTruthy();
  });
});
