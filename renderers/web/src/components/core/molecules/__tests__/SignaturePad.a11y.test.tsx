import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignaturePad } from '../SignaturePad';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

afterEach(() => vi.restoreAllMocks());

function mount(props: React.ComponentProps<typeof SignaturePad>) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  return render(<EventBusProvider debug={false}><SignaturePad {...props} /></EventBusProvider>);
}

describe('SignaturePad a11y', () => {
  it('names the drawing canvas from its label', async () => {
    const { container } = mount({ label: 'Customer signature' });
    expect(screen.getByRole('img', { name: 'Customer signature' })).toBeTruthy();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: aria-label overrides the label and readOnly still names the canvas', () => {
    mount({ label: 'Sign', 'aria-label': 'Initial here', readOnly: true });
    expect(screen.getByRole('img', { name: 'Initial here' })).toBeTruthy();
  });
});
