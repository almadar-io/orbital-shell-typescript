/**
 * An open drawer covers the page's floating chrome (tool strips, chat pills —
 * z-50), like SidePanel does.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Drawer } from '../Drawer';

describe('Drawer layer', () => {
  it('its panel sits above z-50 floating chrome', () => {
    render(<Drawer isOpen onClose={() => undefined} title="Menu"><div data-testid="content" /></Drawer>);
    const panel = screen.getByTestId('content').closest('.fixed') as HTMLElement;
    expect(panel.className).toMatch(/z-\[60\]/);
  });
});
