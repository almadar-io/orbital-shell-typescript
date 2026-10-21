import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterPill } from '../../../../core';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const wrap = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

describe('FilterPill', () => {
  it('exposes aria-pressed on the body and keeps remove as a sibling button', async () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    const { container } = wrap(<FilterPill label="Open" onClick={onClick} onRemove={onRemove} aria-pressed />);
    const body = screen.getByRole('button', { name: 'Open' });
    expect(body).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(body, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('is plain text with no pressed state when there is no click handler', () => {
    const { container } = wrap(<FilterPill label="Static" aria-pressed />);
    expect(container.querySelector('[aria-pressed]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
