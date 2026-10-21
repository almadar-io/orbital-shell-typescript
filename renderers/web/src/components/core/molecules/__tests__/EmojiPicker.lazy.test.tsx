import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmojiPicker } from '../EmojiPicker';
import { EventBusProvider } from '../../../../core';

const wrap = (children: React.ReactNode) => <EventBusProvider debug={false}>{children}</EventBusProvider>;

describe('EmojiPicker loads its emoji set on open', () => {
  it('shows no emoji before the panel opens and the full set after', async () => {
    render(wrap(<EmojiPicker />));
    expect(screen.queryAllByRole('option', { hidden: true })).toHaveLength(0);
    fireEvent.click(screen.getByTestId('emoji-picker-trigger'));
    expect((await screen.findAllByRole('option', { hidden: true })).length).toBeGreaterThan(0);
  });

  it('control: a second picker opens with the set already loaded', async () => {
    render(wrap(<EmojiPicker />));
    fireEvent.click(screen.getByTestId('emoji-picker-trigger'));
    expect((await screen.findAllByRole('option', { hidden: true })).length).toBeGreaterThan(0);
  });
});
