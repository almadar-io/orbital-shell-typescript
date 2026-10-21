// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Timeline } from '../Timeline';

const rows = [
  { id: 'a', headline: 'Deploy shipped', summary: 'All regions', happenedAt: '2026-09-21', phase: 'complete', title: 'WRONG TITLE' },
];

describe('Timeline declared slots', () => {
  it('reads title, description, date and status from the declared fields', () => {
    const { container } = render(
      <Timeline
        entity={rows}
        fields={['headline', 'summary', 'happenedAt', 'phase']}
        titleField="headline"
        descriptionField="summary"
        dateField="happenedAt"
        statusField="phase"
      />,
    );
    expect(screen.getByText('Deploy shipped')).toBeTruthy();
    expect(screen.getByText('All regions')).toBeTruthy();
    expect(screen.queryByText('WRONG TITLE')).toBeNull();
    expect(screen.getByText(/2026/)).toBeTruthy();
    expect(container.querySelector('.text-success')).toBeTruthy();
  });

  it('does not treat the first field as the title when none is declared', () => {
    render(<Timeline entity={rows} fields={['headline', 'summary']} />);
    expect(screen.queryByText('Deploy shipped')).toBeNull();
    expect(screen.queryByText('All regions')).toBeNull();
  });

  it('does not pick a date or status column by its name', () => {
    const named = [{ id: 'n', title: 'T', date: '2026-01-02', status: 'complete' }];
    const { container } = render(
      <Timeline entity={named} fields={['title', 'date', 'status']} titleField="title" />,
    );
    expect(screen.queryByText(/2026/)).toBeNull();
    expect(container.querySelector('.text-success')).toBeNull();
  });
});
