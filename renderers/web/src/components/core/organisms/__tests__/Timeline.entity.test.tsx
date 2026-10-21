// @vitest-environment jsdom
/**
 * An entity-bound timeline renders its records. The `ui-timeline` wrapper
 * always forwards its default `items: []`, which must not hide the rows.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Timeline } from '../Timeline';

const rows = [
  { id: 'a', title: 'Elevated EU storage latency', description: 'Resolved in 38 minutes.', date: '2026-09-21', status: 'complete' },
  { id: 'b', title: 'Webhook delivery delays', description: 'Resolved in 12 minutes.', date: '2026-09-03', status: 'active' },
];

describe('Timeline entity rows', () => {
  it('renders entity rows when items is the empty default', () => {
    render(<Timeline entity={rows} items={[]} fields={['title', 'description', 'date', 'status']} titleField="title" descriptionField="description" dateField="date" statusField="status" />);
    expect(screen.getByText('Elevated EU storage latency')).toBeTruthy();
    expect(screen.getByText('Webhook delivery delays')).toBeTruthy();
  });

  it('renders entity rows when items is omitted', () => {
    render(<Timeline entity={rows} fields={['title', 'description', 'date']} titleField="title" descriptionField="description" dateField="date" statusField="status" />);
    expect(screen.getByText('Resolved in 12 minutes.')).toBeTruthy();
  });

  it('prefers explicit non-empty items over entity rows', () => {
    render(<Timeline entity={rows} items={[{ id: 'x', title: 'Hand-authored step' }]} fields={['title']} />);
    expect(screen.getByText('Hand-authored step')).toBeTruthy();
    expect(screen.queryByText('Elevated EU storage latency')).toBeNull();
  });

  it('renders nothing from an empty entity with empty items', () => {
    const { container } = render(<Timeline entity={[]} items={[]} fields={['title']} />);
    expect(container.textContent).not.toContain('Elevated EU storage latency');
  });
});
