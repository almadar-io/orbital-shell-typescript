// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COMPONENT_REGISTRY } from '../component-registry.generated';

describe('the component registry loads AVL components on first render', () => {
  it('an AVL pattern renders through its lazy chunk', async () => {
    const Glyph = COMPONENT_REGISTRY['AvlGlyph'];
    expect(Glyph).toBeDefined();
    render(<Glyph kind="state" label="checkout" />);
    expect((await screen.findByTestId('avl-glyph-caption')).textContent).toBe('checkout');
  });

  it('control: a core pattern is a plain component and renders in the same pass', () => {
    const Box = COMPONENT_REGISTRY['Box'];
    const { container } = render(<Box className="probe">x</Box>);
    expect(container.querySelector('.probe')).not.toBeNull();
  });
});
