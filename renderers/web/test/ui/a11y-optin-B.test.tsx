// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { StatCard } from '../../src/components/core/organisms/StatCard';
import { Timeline } from '../../src/components/core/organisms/Timeline';
import { MediaGallery } from '../../src/components/core/organisms/MediaGallery';
import { CodeRunnerPanel } from '../../src/components/core/organisms/CodeRunnerPanel';
import { SubagentTracePanel } from '../../src/components/core/organisms/SubagentTracePanel';
import { DashboardGrid } from '../../src/components/core/organisms/layout/DashboardGrid';
import { SplitPane } from '../../src/components/core/organisms/layout/SplitPane';
import { MasterDetailLayout } from '../../src/components/core/organisms/layout/MasterDetailLayout';
import { GenericAppTemplate } from '../../src/components/core/templates/GenericAppTemplate';
import { CounterTemplate } from '../../src/components/core/templates/CounterTemplate';

type A11y = { 'aria-label'?: string; lang?: string };
type Case = { name: string; element: (a: A11y) => React.ReactElement };

const counter = { id: 'c1', count: 1, decrementLabel: '-', incrementLabel: '+', resetLabel: 'reset' };

const cases: Case[] = [
  { name: 'StatCard', element: (a) => <StatCard label="Users" value={3} {...a} /> },
  { name: 'StatCard loading branch', element: (a) => <StatCard label="Users" value={3} isLoading {...a} /> },
  { name: 'Timeline', element: (a) => <Timeline items={[{ id: '1', title: 'x' }]} {...a} /> },
  { name: 'Timeline loading branch', element: (a) => <Timeline items={[]} isLoading {...a} /> },
  { name: 'MediaGallery', element: (a) => <MediaGallery items={[{ id: '1', src: 'a.png' }]} {...a} /> },
  { name: 'CodeRunnerPanel', element: (a) => <CodeRunnerPanel code="1" language="javascript" {...a} /> },
  { name: 'SubagentTracePanel', element: (a) => <SubagentTracePanel subagents={[]} disclosureLevel={1} open {...a} /> },
  { name: 'DashboardGrid', element: (a) => <DashboardGrid cells={[]} {...a} /> },
  { name: 'SplitPane', element: (a) => <SplitPane left={<span>l</span>} right={<span>r</span>} {...a} /> },
  { name: 'MasterDetailLayout', element: (a) => <MasterDetailLayout master={<span>m</span>} detail={<span>d</span>} {...a} /> },
  { name: 'GenericAppTemplate', element: (a) => <GenericAppTemplate entity={[]} title="T" {...a}>body</GenericAppTemplate> },
  { name: 'CounterTemplate minimal', element: (a) => <CounterTemplate entity={counter} variant="minimal" {...a} /> },
  { name: 'CounterTemplate standard', element: (a) => <CounterTemplate entity={counter} {...a} /> },
];

function root(element: React.ReactElement): Element {
  const { container } = render(<EventBusProvider debug={false}>{element}</EventBusProvider>);
  const el = container.firstElementChild;
  if (!el) throw new Error('nothing rendered');
  return el;
}

describe('A11yProps opt-in: core organisms and templates forward to the root element', () => {
  it.each(cases)('$name forwards aria-label and lang to its root', ({ element }) => {
    const el = root(element({ 'aria-label': 'custom name', lang: 'ar' }));
    expect(el.getAttribute('aria-label')).toBe('custom name');
    expect(el.getAttribute('lang')).toBe('ar');
  });

  it.each(cases)('$name leaves the root unlabelled when no a11y props are given', ({ element }) => {
    const el = root(element({}));
    expect(el.hasAttribute('lang')).toBe(false);
    expect(el.getAttribute('aria-label')).not.toBe('custom name');
  });
});
