/**
 * A search box offers the suggestions its program hands it while the viewer types: arrows move through them,
 * Enter or a click picks one (the `suggestionEvent`), Enter with none chosen searches at once, and clearing the
 * box searches for nothing so a filtered list is restored.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SearchInput } from '../SearchInput';
import { EventBusProvider, useEventBus } from '../../../../core';

function Listen({ type, fn }: { type: string; fn: (e: { payload?: Record<string, unknown> }) => void }): null {
  const bus = useEventBus();
  React.useEffect(() => bus.on(type, fn), [bus, type, fn]);
  return null;
}

const suggestions = [
  { label: 'Rust', value: 'p1' },
  { label: 'Rust ownership', value: 'p2' },
];

function setup(props: Partial<React.ComponentProps<typeof SearchInput>> = {}) {
  const picked = vi.fn();
  const searched = vi.fn();
  render(
    <EventBusProvider debug={false}>
      <Listen type="UI:PICK_PATH" fn={picked} />
      <Listen type="UI:FILTER_SEARCH" fn={searched} />
      <SearchInput event="FILTER_SEARCH" suggestionEvent="PICK_PATH" suggestions={suggestions} debounceMs={50} value="Ru" {...props} />
    </EventBusProvider>,
  );
  const input = screen.getByRole('combobox');
  return { picked, searched, input };
}

describe('SearchInput suggestions', () => {
  it('lists the suggestions while focused and picks the one the arrows reach with Enter', () => {
    const { picked, input } = setup();
    fireEvent.focus(input);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Rust', 'Rust ownership']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ payload: { value: 'p2', label: 'Rust ownership' } }));
  });

  it('a click on a suggestion picks it', () => {
    const { picked, input } = setup();
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText('Rust'));
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ payload: { value: 'p1', label: 'Rust' } }));
  });

  it('Enter with no suggestion chosen searches at once', () => {
    const { searched, picked, input } = setup();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(searched).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ searchTerm: 'Ru' }) }));
    expect(picked).not.toHaveBeenCalled();
  });

  it('Escape closes the list', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('clearing the box searches for nothing', async () => {
    vi.useFakeTimers();
    const { searched } = setup({ suggestions: [] });
    const clear = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clear);
    await act(async () => { vi.advanceTimersByTime(100); });
    vi.useRealTimers();
    expect(searched).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ searchTerm: '' }) }));
  });

  it('control: with no suggestions there is no list', () => {
    const { input } = setup({ suggestions: [] });
    fireEvent.focus(input);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
