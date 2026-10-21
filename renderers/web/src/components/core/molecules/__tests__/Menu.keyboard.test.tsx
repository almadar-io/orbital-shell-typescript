import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Menu, type MenuItem } from '../Menu';
import { EventBusProvider } from '../../../../core';

const ITEMS: MenuItem[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'dup', label: 'Duplicate' },
  { type: 'divider', label: '' },
  { id: 'del', label: 'Delete', variant: 'danger' },
];

function renderMenu(items: MenuItem[] = ITEMS, trigger: React.ReactNode = <button>Actions</button>) {
  return render(
    <EventBusProvider debug={false}>
      <Menu trigger={trigger} items={items} />
    </EventBusProvider>,
  );
}

const open = () => act(() => { fireEvent.click(screen.getByRole('button', { name: 'Actions' })); });
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: k, ...init }); });

describe('Menu keyboard + semantics (APG menu button)', () => {
  it('the trigger announces a menu and its state', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    open();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(screen.getByRole('menu').id);
  });

  it('items are menuitems and the first takes focus on open', () => {
    renderMenu();
    open();
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Edit', 'Duplicate', 'Delete']);
    expect(document.activeElement).toBe(items[0]);
  });

  it('ArrowDown / ArrowUp move focus and wrap; Home / End jump', () => {
    renderMenu();
    open();
    const items = screen.getAllByRole('menuitem');
    key('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key('ArrowDown');
    expect(document.activeElement).toBe(items[2]);
    key('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    key('ArrowUp');
    expect(document.activeElement).toBe(items[2]);
    key('Home');
    expect(document.activeElement).toBe(items[0]);
    key('End');
    expect(document.activeElement).toBe(items[2]);
  });

  it('Escape closes and returns focus to the trigger', () => {
    renderMenu();
    open();
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions' }));
  });

  it('Tab closes the menu', () => {
    renderMenu();
    open();
    key('Tab');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ArrowDown on the trigger opens the menu', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    key('ArrowDown');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('a text trigger is a keyboard-operable button', () => {
    renderMenu(ITEMS, 'Build');
    const trigger = screen.getByRole('button', { name: 'Build' });
    expect(trigger.getAttribute('tabindex')).toBe('0');
    trigger.focus();
    key('Enter');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('ArrowRight opens a submenu and focuses its first item; ArrowLeft returns', () => {
    const onClick = vi.fn();
    renderMenu([{ id: 'share', label: 'Share', subMenu: [{ id: 'mail', label: 'Email', onClick }, { id: 'link', label: 'Copy link' }] }]);
    open();
    const share = screen.getByRole('menuitem', { name: 'Share' });
    expect(share.getAttribute('aria-haspopup')).toBe('menu');
    key('ArrowRight');
    expect(document.activeElement?.textContent).toBe('Email');
    key('ArrowLeft');
    expect(document.activeElement).toBe(share);
  });

  it('control: a disabled item is focusable but not activated', () => {
    const onClick = vi.fn();
    renderMenu([{ id: 'x', label: 'Locked', disabled: true, onClick }]);
    open();
    const item = screen.getByRole('menuitem', { name: 'Locked' });
    expect(document.activeElement).toBe(item);
    act(() => { fireEvent.click(item); });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Menu dividers are declared', () => {
  it('control: an item whose label is "divider" is an ordinary item', () => {
    renderMenu([{ id: 'a', label: 'divider' }]);
    open();
    expect(screen.getByRole('menuitem', { name: 'divider' })).toBeTruthy();
  });
});
