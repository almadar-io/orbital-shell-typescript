// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { Spinner } from '../../src/core';
import { StatusDot } from '../../src/core';
import { TrendIndicator } from '../../src/core';
import { Card } from '../../src/core';
import { Aside } from '../../src/core';
import { Center } from '../../src/core';
import { Divider } from '../../src/core';
import { Image } from '../../src/core';
import { Avatar } from '../../src/core';
import { ProgressBar } from '../../src/core';
import { SectionHeader } from '../../src/core';
import { DayCell } from '../../src/core';
import { TimeSlotCell } from '../../src/core';
import { SvgNode } from '../../src/core';
import { SvgRing } from '../../src/core';
import { Sparkline } from '../../src/core';
import { RangeSlider } from '../../src/core';

type A11y = { 'aria-label': string; lang: string; role?: 'region' };
type Case = { name: string; role?: 'region'; element: (a: A11y) => React.ReactElement };

const cases: Case[] = [
  { name: 'Spinner', element: (a) => <Spinner {...a} /> },
  { name: 'StatusDot', element: (a) => <StatusDot {...a} /> },
  { name: 'TrendIndicator', element: (a) => <TrendIndicator value={3} {...a} /> },
  { name: 'Card', role: 'region', element: (a) => <Card {...a}>x</Card> },
  { name: 'Aside', role: 'region', element: (a) => <Aside {...a}>x</Aside> },
  { name: 'Center', role: 'region', element: (a) => <Center {...a}>x</Center> },
  { name: 'Divider horizontal', element: (a) => <Divider {...a} /> },
  { name: 'Divider labelled', element: (a) => <Divider label="Section" {...a} /> },
  { name: 'Divider vertical', element: (a) => <Divider orientation="vertical" {...a} /> },
  { name: 'Image', element: (a) => <Image src="https://example.test/a.png" alt="pic" {...a} /> },
  { name: 'Avatar', role: 'region', element: (a) => <Avatar name="Ada Lovelace" {...a} /> },
  { name: 'ProgressBar linear', element: (a) => <ProgressBar value={40} {...a} /> },
  { name: 'ProgressBar circular', element: (a) => <ProgressBar value={40} progressType="circular" {...a} /> },
  { name: 'SectionHeader', role: 'region', element: (a) => <SectionHeader title="T" {...a} /> },
  { name: 'DayCell', role: 'region', element: (a) => <DayCell date={new Date(2026, 0, 5)} {...a} /> },
  { name: 'TimeSlotCell', role: 'region', element: (a) => <TimeSlotCell time="09:00" {...a} /> },
  { name: 'SvgNode', role: 'region', element: (a) => <SvgNode {...a} /> },
  { name: 'SvgRing', role: 'region', element: (a) => <SvgRing {...a} /> },
  { name: 'Sparkline', element: (a) => <Sparkline data={[1, 2, 3]} {...a} /> },
  { name: 'RangeSlider', role: 'region', element: (a) => <RangeSlider {...a} /> },
];

function root(element: React.ReactElement): Element {
  const { container } = render(<EventBusProvider debug={false}>{element}</EventBusProvider>);
  const el = container.firstElementChild;
  if (!el) throw new Error('nothing rendered');
  return el;
}

describe('A11yProps opt-in: core atoms forward to the root element', () => {
  it.each(cases)('$name forwards aria-label and lang to its root', ({ element }) => {
    const el = root(element({ 'aria-label': 'custom name', lang: 'ar' }));
    expect(el.getAttribute('aria-label')).toBe('custom name');
    expect(el.getAttribute('lang')).toBe('ar');
  });

  it.each(cases.filter((c) => c.role))('$name forwards role to its root', ({ element }) => {
    const el = root(element({ 'aria-label': 'custom name', lang: 'ar', role: 'region' }));
    expect(el.getAttribute('role')).toBe('region');
  });

  it('a non-A11y prop is not forwarded to the DOM', () => {
    const el = root(<Divider variant="dashed" {...{ foo: 'bar' }} />);
    expect(el.hasAttribute('foo')).toBe(false);
  });

  it('Divider keeps its separator role even when a caller passes another', () => {
    const el = root(<Divider role="region" />);
    expect(el.getAttribute('role')).toBe('separator');
  });

  it('DayCell: caller aria-label wins over the default date label', () => {
    const el = root(<DayCell date={new Date(2026, 0, 5)} onClick={() => undefined} aria-label="Mon" />);
    expect(el.getAttribute('aria-label')).toBe('Mon');
  });
});
