// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AvlGlyph, AVL_GLYPH_KINDS } from '../AvlGlyph';

describe('AvlGlyph', () => {
  it('draws every notation symbol standalone in its own svg with a caption', () => {
    for (const kind of AVL_GLYPH_KINDS) {
      const { unmount } = render(<AvlGlyph kind={kind} />);
      const root = screen.getByTestId('avl-glyph');
      expect(root.dataset.kind).toBe(kind);
      expect(root.querySelector('svg g')?.childElementCount, kind).toBeGreaterThan(0);
      expect(screen.getByTestId('avl-glyph-caption').textContent, kind).not.toBe('');
      unmount();
    }
  });

  it('uses the label as the caption when given (control: kind name otherwise)', () => {
    const { unmount } = render(<AvlGlyph kind="state" label="checkout" />);
    expect(screen.getByTestId('avl-glyph-caption').textContent).toBe('checkout');
    unmount();
    render(<AvlGlyph kind="state" />);
    expect(screen.getByTestId('avl-glyph-caption').textContent).toBe('State');
  });

  it('hides the caption when asked', () => {
    render(<AvlGlyph kind="guard" showCaption={false} />);
    expect(screen.queryByTestId('avl-glyph-caption')).toBeNull();
  });

  it('passes subtypes through to the symbol', () => {
    render(<AvlGlyph kind="operator" label="+" namespace="arithmetic" />);
    expect(screen.getByTestId('avl-glyph').querySelector('svg')?.textContent).toContain('+');
  });
});
