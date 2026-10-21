// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextHighlight } from '../../../../core';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('TextHighlight accessibility', () => {
  it('reports the active highlight as pressed, not only ring-styled', async () => {
    const { container } = wrap(
      <>
        <TextHighlight highlightType="note" isActive>one</TextHighlight>
        <TextHighlight highlightType="question">two</TextHighlight>
      </>,
    );
    expect(screen.getByRole('button', { name: 'one' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'two' }).getAttribute('aria-pressed')).toBe('false');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('keeps Enter/Space activation (control)', () => {
    const onClick = vi.fn();
    wrap(<TextHighlight highlightType="note" onClick={onClick}>x</TextHighlight>);
    const el = screen.getByRole('button', { name: 'x' });
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.keyDown(el, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('forwards aria-label and lang to the span', () => {
    wrap(<TextHighlight highlightType="note" aria-label="Note on clause 3" lang="ar">x</TextHighlight>);
    const el = screen.getByRole('button', { name: 'Note on clause 3' });
    expect(el.getAttribute('lang')).toBe('ar');
  });
});
