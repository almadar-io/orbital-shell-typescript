import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RelationSelect } from '../RelationSelect';
import { EventBusProvider } from '../../../../core';

const OPTIONS = [
  { value: 'a', label: 'Acme' },
  { value: 'b', label: 'Bolt', disabled: true },
  { value: 'c', label: 'Crane' },
];

function open(onChange = vi.fn(), value?: string) {
  render(
    <EventBusProvider debug={false}>
      <RelationSelect options={OPTIONS} onChange={onChange} value={value} />
    </EventBusProvider>,
  );
  act(() => { fireEvent.click(screen.getAllByRole('button')[0]); });
  return onChange;
}

describe('RelationSelect combobox (APG)', () => {
  it('the search field is a combobox controlling a listbox of options', () => {
    open();
    const combo = screen.getByRole('combobox');
    const listbox = screen.getByRole('listbox');
    expect(combo.getAttribute('aria-expanded')).toBe('true');
    expect(combo.getAttribute('aria-controls')).toBe(listbox.id);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Acme', 'Bolt', 'Crane']);
  });

  it('ArrowDown moves the active option, skipping disabled ones; Enter selects it', () => {
    const onChange = open();
    const combo = screen.getByRole('combobox');
    act(() => { fireEvent.keyDown(combo, { key: 'ArrowDown' }); });
    expect(combo.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Acme' }).id);
    act(() => { fireEvent.keyDown(combo, { key: 'ArrowDown' }); });
    expect(combo.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Crane' }).id);
    act(() => { fireEvent.keyDown(combo, { key: 'Enter' }); });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('ArrowUp wraps to the last enabled option', () => {
    open();
    const combo = screen.getByRole('combobox');
    act(() => { fireEvent.keyDown(combo, { key: 'ArrowUp' }); });
    expect(combo.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Crane' }).id);
  });

  it('marks the current value selected and disabled options disabled', () => {
    open(vi.fn(), 'a');
    expect(screen.getByRole('option', { name: 'Acme' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: 'Bolt' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('control: Enter with no active option selects nothing when several match', () => {
    const onChange = open();
    act(() => { fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }); });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('RelationSelect clear control', () => {
  it('is its own button, not nested inside the trigger', () => {
    const onChange = vi.fn();
    render(
      <EventBusProvider debug={false}>
        <RelationSelect options={OPTIONS} value="a" clearable onChange={onChange} />
      </EventBusProvider>,
    );
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear.parentElement?.closest('button')).toBeNull();
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('control: not rendered without a value', () => {
    render(
      <EventBusProvider debug={false}>
        <RelationSelect options={OPTIONS} clearable />
      </EventBusProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });
});
