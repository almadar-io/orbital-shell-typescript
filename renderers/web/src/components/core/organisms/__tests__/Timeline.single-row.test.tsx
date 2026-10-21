// @vitest-environment jsdom
/**
 * Before its fetch lands, an instance-bound timeline's first paint receives
 * `@entity` as ONE default row, not a collection. It must render that row
 * (or nothing), never crash the page (`y.map is not a function`).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Timeline } from '../Timeline';

const fields = ['title', 'description', 'date', 'status'];

describe('Timeline with a single-row entity', () => {
  it('renders a lone row instead of throwing', () => {
    render(<Timeline entity={{ id: 's1', title: 'Build', description: '2m 41s', status: 'complete' }} items={[]} fields={fields} titleField="title" descriptionField="description" statusField="status" />);
    expect(screen.getByText('Build')).toBeTruthy();
  });

  it('control: a collection still renders every row', () => {
    render(<Timeline entity={[{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }]} items={[]} fields={fields} titleField="title" />);
    expect(screen.getByText('One')).toBeTruthy();
    expect(screen.getByText('Two')).toBeTruthy();
  });

  it('edge: the first-paint default row (no id, empty strings) does not throw', () => {
    expect(() =>
      render(<Timeline entity={{ description: '', date: '', status: 'pending' }} items={[]} fields={fields} titleField="title" descriptionField="description" dateField="date" statusField="status" />),
    ).not.toThrow();
  });
});
