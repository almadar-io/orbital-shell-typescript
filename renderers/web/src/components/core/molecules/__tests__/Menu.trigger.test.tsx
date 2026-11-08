import React, { useLayoutEffect, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Menu, type MenuItem } from '../Menu';
import { EventBusProvider } from '../../../../core';

const ITEMS: MenuItem[] = [{ id: 'admin', label: 'Admin', description: 'Dana Reyes' }];

// A parent that renders again after every commit, up to `rounds` times, with a new trigger element each time.
function Rerendering({ rounds, wrapped }: { rounds: number; wrapped: boolean }) {
  const [round, setRound] = useState(0);
  useLayoutEffect(() => {
    if (round < rounds) setRound(round + 1);
  });
  const control = <button key={round}>Viewing as</button>;
  return (
    <EventBusProvider debug={false}>
      <Menu trigger={wrapped ? [control] : control} items={ITEMS} />
    </EventBusProvider>
  );
}

describe('Menu trigger', () => {
  it('a wrapped trigger lends its inner control the menu-button semantics, not the wrapper', () => {
    render(<Rerendering rounds={0} wrapped />);
    const control = screen.getByRole('button', { name: 'Viewing as' });
    expect(control.getAttribute('aria-haspopup')).toBe('menu');
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(control.parentElement?.getAttribute('role')).toBeNull();
    act(() => { fireEvent.click(control); });
    expect(control.getAttribute('aria-expanded')).toBe('true');
  });

  it('a trigger replaced on every render settles instead of looping (React error #185)', () => {
    expect(() => render(<Rerendering rounds={30} wrapped />)).not.toThrow();
    expect(() => render(<Rerendering rounds={30} wrapped={false} />)).not.toThrow();
    const controls = screen.getAllByRole('button', { name: 'Viewing as' });
    expect(controls.every((c) => c.getAttribute('aria-haspopup') === 'menu')).toBe(true);
  });

  it('an item with a description shows it as a second line under the label', () => {
    render(<Rerendering rounds={0} wrapped={false} />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Viewing as' })); });
    const item = screen.getByRole('menuitem');
    expect(item.textContent).toContain('Admin');
    expect(item.textContent).toContain('Dana Reyes');
  });

  it('control: an item without a description shows only its label', () => {
    render(
      <EventBusProvider debug={false}>
        <Menu trigger={<button>Open</button>} items={[{ id: 'a', label: 'Only label' }]} />
      </EventBusProvider>,
    );
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open' })); });
    expect(screen.getByRole('menuitem').textContent).toBe('Only label');
  });
});
