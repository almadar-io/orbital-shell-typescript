import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { Button } from '../../src/core';
import { axeViolations, describeViolations } from './axe';

describe('axe helper', () => {
  it('reports an unnamed icon-only button', async () => {
    const { container } = render(<EventBusProvider debug={false}><Button icon="x" /></EventBusProvider>);
    const ids = (await axeViolations(container)).map((v) => v.id);
    expect(ids).toContain('button-name');
  });

  it('control: a labelled button has no violations', async () => {
    const { container } = render(<EventBusProvider debug={false}><Button label="Close" icon="x" /></EventBusProvider>);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });
});
