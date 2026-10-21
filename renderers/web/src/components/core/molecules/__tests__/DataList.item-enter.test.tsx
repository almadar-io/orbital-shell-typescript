import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataList } from '../DataList';
import { EventBusProvider } from '../../../../core';
import { enterClassName } from '../../../../lib/enter';

const rows = [{ id: 'a', title: 'Approve the new supplier' }, { id: 'b', title: 'Book the offsite' }];
const fields = [{ name: 'title', variant: 'h4' as const }];

describe('DataList itemEnter', () => {
  it('gives every row the entrance animation class, so a card arriving in a list animates in', () => {
    const { container } = render(<EventBusProvider debug={false}><DataList entity={rows} fields={fields} itemEnter="rise" /></EventBusProvider>);
    const cls = enterClassName('rise') ?? '';
    const rowEls = container.querySelectorAll('[data-entity-row]');
    expect(rowEls.length).toBe(2);
    rowEls.forEach((r) => expect(r.className).toContain(cls.split(' ')[0]));
  });

  it('control: rows carry no entrance class without itemEnter', () => {
    const { container } = render(<EventBusProvider debug={false}><DataList entity={rows} fields={fields} /></EventBusProvider>);
    const cls = (enterClassName('rise') ?? '').split(' ')[0];
    container.querySelectorAll('[data-entity-row]').forEach((r) => expect(r.className).not.toContain(cls));
  });
});
