/**
 * `renderItem-unresolved` names a list that has rows and nothing to draw them with, as DataGrid's does: a list drawn
 * from its `fields` is not one (G-CROSS-789, the Orb docs notes list warned on every render).
 */
import React from 'react';
import { afterEach, describe, it, expect, vi, type MockInstance } from 'vitest';
import { render } from '@testing-library/react';
import { DataList } from '../DataList';
import { EventBusProvider } from '../../../../core';

const rows = [{ id: 'n1', title: 'First note' }];
const unresolvedWarnings = (spy: MockInstance<typeof console.warn>) =>  spy.mock.calls.filter((args: unknown[]) => args.some((a: unknown) => typeof a === 'string' && a.includes('renderItem-unresolved')));

afterEach(() => vi.restoreAllMocks());

describe('DataList renderItem-unresolved diagnostic', () => {
  it('a list drawn from its fields does not warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<EventBusProvider debug={false}><DataList entity={rows} fields={[{ name: 'title', variant: 'h4' }]} /></EventBusProvider>);
    expect(unresolvedWarnings(warn)).toEqual([]);
  });

  it('control: a list with rows, no fields and no renderer warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<EventBusProvider debug={false}><DataList entity={rows} /></EventBusProvider>);
    expect(unresolvedWarnings(warn).length).toBeGreaterThan(0);
  });
});
