/**
 * RED BY DESIGN (H1, G-ORBITAL-SHELL-TYPESCRIPT-108): the program orders and groups rows, the host paints them as
 * given. Each `it.fails` passes while the host still sorts or buckets, and turns red the moment it stops, which is
 * the cue to delete the marker.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataList, type DataListField } from '../DataList';
import { EventBusProvider } from '../../../../core';

const fields: readonly DataListField[] = [{ name: 'title', variant: 'h3' }];
const kernelOrdered = [
  { id: 'r1', title: 'Charlie', kind: 'x' },
  { id: 'r2', title: 'Alpha', kind: 'y' },
  { id: 'r3', title: 'Bravo', kind: 'x' },
];
const paintedTitles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-entity-row]')).map((row) => row.textContent?.trim());

describe('G-ORBITAL-SHELL-TYPESCRIPT-108 red: DataList paints rows as the kernel ordered them', () => {
  it.fails('does not reorder rows by a sortBy prop', () => {
    const { container } = render(
      <EventBusProvider debug={false}>
        <DataList entity={kernelOrdered} fields={fields} sortBy="title" sortDirection="asc" />
      </EventBusProvider>,
    );
    expect(paintedTitles(container)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it.fails('does not regroup rows by a groupBy prop', () => {
    const { container } = render(
      <EventBusProvider debug={false}>
        <DataList entity={kernelOrdered} fields={fields} groupBy="kind" />
      </EventBusProvider>,
    );
    expect(paintedTitles(container)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });
});
