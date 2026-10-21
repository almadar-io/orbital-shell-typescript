import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageHeader } from '../PageHeader';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('PageHeader actions while loading', () => {
  it('a focused action keeps focus and ignores activation when the header is loading', () => {
    const onClick = vi.fn();
    const actions = [{ label: 'Save', onClick }];
    const view = wrap(<PageHeader title="T" actions={actions} />);
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    view.rerender(
      <EventBusProvider debug={false}>
        <PageHeader title="T" actions={actions} isLoading />
      </EventBusProvider>,
    );
    const busy = screen.getByRole('button', { name: /Save/ });
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('control: an action that is declared disabled stays natively disabled', () => {
    wrap(<PageHeader title="T" actions={[{ label: 'Save', onClick: () => {}, disabled: true }]} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
