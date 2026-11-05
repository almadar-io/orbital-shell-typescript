import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBusProvider } from '../../../../core';
import { GameAudioToggle } from '../GameAudioToggle';

describe('GameAudioToggle loading contract', () => {
  it('passes authored loading state to the shared button', () => {
    render(
      <EventBusProvider>
        <GameAudioToggle muted={false} soundOnLabel="Sound on" isLoading />
      </EventBusProvider>,
    );
    expect(screen.getByRole('button', { name: 'Sound on' })).toHaveAttribute('aria-busy', 'true');
  });
});
