import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Popover } from '../Popover';

describe('Popover dialog semantics', () => {
  it('announces its state on the trigger and links to the panel', () => {
    render(<Popover content="Details here"><button>More</button></Popover>);
    const trigger = screen.getByRole('button', { name: 'More' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    act(() => { fireEvent.click(trigger); });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('dialog', { hidden: true });
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('closes on Escape', () => {
    render(<Popover content="Details here"><button>More</button></Popover>);
    const trigger = screen.getByRole('button', { name: 'More' });
    act(() => { fireEvent.click(trigger); });
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('control: a string popover is named by its content', () => {
    render(<Popover content="Details here" open><button>More</button></Popover>);
    expect(screen.getByRole('dialog', { hidden: true }).getAttribute('aria-label')).toBe('Details here');
  });

  it('a hover popover adds no dialog semantics to its trigger (a tooltip is not a dialog)', () => {
    render(<Popover trigger="hover" content="Value 42"><span>214</span></Popover>);
    const trigger = screen.getByText('214');
    expect(trigger.getAttribute('aria-haspopup')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBeNull();
  });

  it('a click popover around plain text gets a focusable button trigger carrying the dialog semantics', () => {
    render(<Popover content="Details here">More</Popover>);
    const trigger = screen.getByRole('button', { name: 'More' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('tabindex')).toBe('0');
  });

  it('a wrapped trigger that already holds a control puts the dialog semantics on that control, not the wrapper', () => {
    render(<Popover content="Pick dates">{[<button key="b">Date range</button>]}</Popover>);
    const trigger = screen.getByRole('button', { name: 'Date range' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const wrapper = trigger.parentElement!;
    expect(wrapper.getAttribute('aria-haspopup')).toBeNull();
    act(() => { fireEvent.click(trigger); });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(screen.getByRole('dialog', { hidden: true }).id);
  });
});
