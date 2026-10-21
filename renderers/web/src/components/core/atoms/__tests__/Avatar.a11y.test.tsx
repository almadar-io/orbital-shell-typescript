import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

describe('Avatar a11y', () => {
  it('a status dot is a named image and passes axe', async () => {
    const { container } = render(<Avatar name="Sam Lee" status="online" />);
    expect(screen.getByRole('img', { name: /online/i })).toBeTruthy();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: no status, no status image', async () => {
    const { container } = render(<Avatar name="Sam Lee" />);
    expect(screen.queryByRole('img', { name: /online/i })).toBeNull();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });
});
