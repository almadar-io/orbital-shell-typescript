// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { Alert } from '../../src/components/core/molecules/Alert';
import { Container } from '../../src/components/core/molecules/Container';
import { Flex } from '../../src/components/core/molecules/Flex';
import { Grid } from '../../src/components/core/molecules/Grid';
import { Section } from '../../src/components/core/molecules/Section';
import { Skeleton } from '../../src/components/core/molecules/Skeleton';
import { SimpleGrid } from '../../src/components/core/molecules/SimpleGrid';
import { ErrorState } from '../../src/components/core/molecules/ErrorState';
import { LoadingState } from '../../src/components/core/molecules/LoadingState';
import { ConnectionBlock } from '../../src/components/core/molecules/ConnectionBlock';
import { Breadcrumb } from '../../src/components/core/molecules/Breadcrumb';
import { Pagination } from '../../src/components/core/molecules/Pagination';
import { Toast } from '../../src/components/core/molecules/Toast';
import { Split } from '../../src/components/core/molecules/Split';
import { Accordion } from '../../src/components/core/molecules/Accordion';
import { VoteStack } from '../../src/components/core/molecules/VoteStack';
import { FlipCard } from '../../src/components/core/molecules/FlipCard';
import { Tabs } from '../../src/components/core/molecules/Tabs';
import { ChangeList } from '../../src/components/core/molecules/ChangeList';

type A11y = { 'aria-label'?: string; lang?: string; role?: 'region' };
type Case = { name: string; element: (a: A11y) => React.ReactElement; roleOverridable?: boolean };

const cases: Case[] = [
  { name: 'Container', element: (a) => <Container {...a}>x</Container>, roleOverridable: true },
  { name: 'Flex', element: (a) => <Flex {...a}>x</Flex>, roleOverridable: true },
  { name: 'Grid', element: (a) => <Grid {...a}>x</Grid>, roleOverridable: true },
  { name: 'Section', element: (a) => <Section {...a}>x</Section>, roleOverridable: true },
  { name: 'SimpleGrid', element: (a) => <SimpleGrid {...a}>x</SimpleGrid>, roleOverridable: true },
  { name: 'Split', element: (a) => <Split {...a}>{[<span key="a">a</span>, <span key="b">b</span>]}</Split>, roleOverridable: true },
  { name: 'Alert', element: (a) => <Alert message="m" {...a} /> },
  { name: 'ErrorState', element: (a) => <ErrorState message="m" {...a} />, roleOverridable: true },
  { name: 'LoadingState', element: (a) => <LoadingState {...a} />, roleOverridable: true },
  { name: 'ConnectionBlock', element: (a) => <ConnectionBlock content="c" {...a} />, roleOverridable: true },
  { name: 'Breadcrumb', element: (a) => <Breadcrumb items={[{ label: 'Home' }]} {...a} /> },
  { name: 'Pagination', element: (a) => <Pagination currentPage={1} totalPages={3} {...a} /> },
  { name: 'Toast', element: (a) => <Toast message="m" {...a} /> },
  { name: 'Accordion', element: (a) => <Accordion items={[{ id: 'a', header: 'H', content: 'C' }]} {...a} />, roleOverridable: true },
  { name: 'VoteStack', element: (a) => <VoteStack count={2} {...a} /> },
  { name: 'FlipCard', element: (a) => <FlipCard front="f" back="b" {...a} />, roleOverridable: true },
  { name: 'Tabs', element: (a) => <Tabs items={[{ id: 't', label: 'T', content: 'c' }]} {...a} />, roleOverridable: true },
  { name: 'ChangeList', element: (a) => <ChangeList changes={[]} {...a} />, roleOverridable: true },
  { name: 'Skeleton', element: (a) => <Skeleton variant="text" {...a} /> },
];

function root(element: React.ReactElement): Element {
  const { container } = render(<EventBusProvider debug={false}>{element}</EventBusProvider>);
  const el = container.firstElementChild;
  if (!el) throw new Error('nothing rendered');
  return el;
}

describe('A11yProps opt-in: core molecules forward to the root element', () => {
  it.each(cases)('$name forwards aria-label and lang to its root', ({ element }) => {
    const el = root(element({ 'aria-label': 'custom name', lang: 'ar' }));
    expect(el.getAttribute('aria-label')).toBe('custom name');
    expect(el.getAttribute('lang')).toBe('ar');
  });

  it.each(cases.filter((c) => c.roleOverridable))('$name forwards role to its root', ({ element }) => {
    const el = root(element({ role: 'region' }));
    expect(el.getAttribute('role')).toBe('region');
  });

  it.each(cases)('$name leaves lang off when no a11y props are given', ({ element }) => {
    const el = root(element({}));
    expect(el.hasAttribute('lang')).toBe(false);
    expect(el.getAttribute('aria-label')).not.toBe('custom name');
  });

  it('keeps essential semantics: Alert role stays computed, Breadcrumb default name yields to the caller', () => {
    expect(root(<Alert message="m" variant="error" />).getAttribute('role')).toBe('alert');
    const plain = root(<Breadcrumb items={[{ label: 'Home' }]} />);
    expect(plain.getAttribute('aria-label')).toBeTruthy();
    expect(plain.getAttribute('aria-label')).not.toBe('Trail');
    expect(root(<Breadcrumb items={[{ label: 'Home' }]} aria-label="Trail" />).getAttribute('aria-label')).toBe('Trail');
  });

  it('paired control: non-A11y props are not forwarded to the DOM', () => {
    const el = root(<Container size="lg" padding="sm" center={false}>x</Container>);
    expect(el.hasAttribute('size')).toBe(false);
    expect(el.hasAttribute('padding')).toBe(false);
    expect(el.hasAttribute('center')).toBe(false);
  });
});
