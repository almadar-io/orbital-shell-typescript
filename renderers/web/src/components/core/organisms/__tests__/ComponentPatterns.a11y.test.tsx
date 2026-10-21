import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IconButtonPattern } from '../ComponentPatterns';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

function wrap(node: React.ReactNode) {
  return render(<EventBusProvider debug={false}>{node}</EventBusProvider>);
}

describe('IconButtonPattern accessible name', () => {
  it('ariaLabel names the button', async () => {
    const { container } = wrap(<IconButtonPattern icon="x" ariaLabel="Close" />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('a schema aria-label reaches the button', async () => {
    const { container } = wrap(<IconButtonPattern icon="x" aria-label="Dismiss" />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('a schema label reaches the button', () => {
    wrap(<IconButtonPattern icon="x" label="Remove" />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('ariaLabel wins over aria-label and label', () => {
    wrap(<IconButtonPattern icon="x" ariaLabel="A" aria-label="B" label="C" />);
    expect(screen.getByRole('button', { name: 'A' })).toBeTruthy();
  });

  it('control: no name at all is flagged by axe', async () => {
    const { container } = wrap(<IconButtonPattern icon="x" />);
    expect((await axeViolations(container)).map((v) => v.id)).toContain('button-name');
  });
});
