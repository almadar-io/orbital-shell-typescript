import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Badge } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

describe('Badge a11y', () => {
  it('a plain badge is not interactive', async () => {
    const { container } = render(<Badge label="New" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('a badge with onClick is a named button that fires on click', async () => {
    const onClick = vi.fn();
    const { container } = render(<Badge label="Open" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('a removable badge names its remove button after the value and does not trigger onClick', async () => {
    const onRemove = vi.fn();
    const onClick = vi.fn();
    const { container } = render(<Badge label="status: open" onRemove={onRemove} onClick={onClick} />);
    const remove = screen.getByRole('button', { name: 'Remove: status: open' });
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('uses a custom removeLabel and amount text, and forwards aria props', () => {
    render(<Badge amount={3} label="Errors" removeLabel="Clear" onRemove={() => {}} aria-label="error count" />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
    expect(screen.getByLabelText('error count')).toBeTruthy();
  });

  it('remove button with an icon-only badge keeps a bare name', () => {
    render(<Badge icon="star" onRemove={() => {}} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});
