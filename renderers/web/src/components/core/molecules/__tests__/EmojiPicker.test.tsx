/**
 * EmojiPicker Component Tests
 *
 * Tests for the emoji chooser: trigger/panel behavior and event bus integration.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmojiPicker } from '../EmojiPicker';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EventBusProvider debug={false}>{children}</EventBusProvider>
);

describe('EmojiPicker', () => {
  it('renders the trigger button with its accessible label', () => {
    render(
      <TestWrapper>
        <EmojiPicker />
      </TestWrapper>
    );

    expect(screen.getByTestId('emoji-picker-trigger')).toBeInTheDocument();
    expect(screen.getByLabelText('Add emoji')).toBeInTheDocument();
  });

  it('opens the panel on trigger click', () => {
    render(
      <TestWrapper>
        <EmojiPicker />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('emoji-picker-trigger'));

    expect(screen.getByPlaceholderText('Search emoji…')).toBeInTheDocument();
  });

  it('emits UI:{pickEvent} with the glyph when a cell is clicked', () => {
    const eventListener = vi.fn();

    const EventListener: React.FC = () => {
      const eventBus = useEventBus();
      React.useEffect(() => {
        const unsubscribe = eventBus.on('UI:EMOJI_PICKED', eventListener);
        return unsubscribe;
      }, [eventBus]);
      return null;
    };

    render(
      <TestWrapper>
        <EventListener />
        <EmojiPicker pickEvent="EMOJI_PICKED" />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('emoji-picker-trigger'));
    const cell = screen.getByRole('option', { name: '100' });
    fireEvent.click(cell);

    expect(eventListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UI:EMOJI_PICKED',
        payload: { emoji: '💯' },
      })
    );
  });

  it('does NOT emit when pickEvent is not provided', () => {
    const eventListener = vi.fn();

    const EventListener: React.FC = () => {
      const eventBus = useEventBus();
      React.useEffect(() => {
        const unsubscribe = eventBus.on('UI:EMOJI_PICKED', eventListener);
        return unsubscribe;
      }, [eventBus]);
      return null;
    };

    render(
      <TestWrapper>
        <EventListener />
        <EmojiPicker />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('emoji-picker-trigger'));
    fireEvent.click(screen.getByRole('option', { name: '100' }));

    expect(eventListener).not.toHaveBeenCalled();
  });

  it('filters cells by emojilib keywords, not only the label', () => {
    render(
      <TestWrapper>
        <EmojiPicker />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('emoji-picker-trigger'));
    const search = screen.getByPlaceholderText('Search emoji…');
    fireEvent.change(search, { target: { value: 'perfect' } });

    expect(screen.getByRole('option', { name: '100' })).toBeInTheDocument();
  });
});
