// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ActionTile } from '../ActionTile';

const action = { id: 'jump', name: 'Jump', category: 'move', iconEmoji: '⬆️' };

afterEach(cleanup);

describe('ActionTile shared contract', () => {
  it('renders the authored action, category colors, and drag payload', () => {
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: '' };
    const { container } = render(
      <ActionTile
        action={action}
        categoryColors={{ move: { bg: 'rgb(1, 2, 3)', border: 'rgb(4, 5, 6)' } }}
      />,
    );
    const tile = container.querySelector('[draggable]');
    expect(tile).not.toBeNull();
    expect(tile?.getAttribute('draggable')).toBe('true');
    expect(tile?.getAttribute('style')).toContain('background-color: rgb(1, 2, 3)');
    expect(tile?.getAttribute('style')).toContain('border-color: rgb(4, 5, 6)');
    fireEvent.dragStart(tile!, { dataTransfer });
    expect(setData).toHaveBeenCalledWith('application/x-almadar-slot-item', JSON.stringify(action));
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('does not start dragging when disabled', () => {
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: '' };
    const { container } = render(<ActionTile action={action} disabled />);
    const tile = container.querySelector('[draggable]');
    expect(tile?.getAttribute('draggable')).toBe('false');
    fireEvent.dragStart(tile!, { dataTransfer });
    expect(setData).not.toHaveBeenCalled();
  });

  it('keeps authored accessibility and locale on the tile', () => {
    const { container } = render(
      <ActionTile action={action} aria-label="Jump action" role="button" lang="ar" dir="rtl" tabIndex={0} />,
    );
    const tile = container.querySelector('[draggable]');
    expect(tile?.getAttribute('aria-label')).toBe('Jump action');
    expect(tile?.getAttribute('role')).toBe('button');
    expect(tile?.getAttribute('lang')).toBe('ar');
    expect(tile?.getAttribute('dir')).toBe('rtl');
    expect(tile?.getAttribute('tabindex')).toBe('0');
  });
});
