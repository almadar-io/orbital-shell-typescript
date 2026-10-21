import React, { useRef, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useDialogBehavior } from '../../core';

function Dialog({ open, onEscape, label, closeOnEscape = true, modal = true, children }: {
  open: boolean; onEscape: () => void; label: string; closeOnEscape?: boolean; modal?: boolean; children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior({ open, containerRef: ref, onEscape, closeOnEscape, modal });
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-label={label}>
      <button>{label} first</button>
      <button>{label} last</button>
      {children}
    </div>
  );
}

describe('useDialogBehavior', () => {
  it('focuses the first focusable element on open', () => {
    render(<Dialog open onEscape={vi.fn()} label="A" />);
    expect(document.activeElement).toBe(screen.getByText('A first'));
  });

  it('traps Tab: from the last element it wraps to the first', () => {
    render(<Dialog open onEscape={vi.fn()} label="A" />);
    screen.getByText('A last').focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('A first'));
  });

  it('traps Shift+Tab: from the first element it wraps to the last', () => {
    render(<Dialog open onEscape={vi.fn()} label="A" />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('A last'));
  });

  it('control: Tab between middle elements is left to the browser', () => {
    render(<Dialog open onEscape={vi.fn()} label="A" />);
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    screen.getByText('A first').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('Escape closes only the top-most of stacked dialogs', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog open onEscape={outer} label="Outer" />
        <Dialog open onEscape={inner} label="Inner" />
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('after the top dialog closes, Escape reaches the one beneath', () => {
    const outer = vi.fn();
    function Stack() {
      const [innerOpen, setInnerOpen] = useState(true);
      return (
        <>
          <Dialog open onEscape={outer} label="Outer" />
          <Dialog open={innerOpen} onEscape={() => setInnerOpen(false)} label="Inner" />
        </>
      );
    }
    render(<Stack />);
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(outer).not.toHaveBeenCalled();
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('control: a top dialog with closeOnEscape=false swallows Escape instead of closing the one beneath', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog open onEscape={outer} label="Outer" />
        <Dialog open onEscape={inner} label="Inner" closeOnEscape={false} />
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it('returns focus to the opener on close', () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <Dialog open={open} onEscape={() => setOpen(false)} label="A" />
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByText('Open');
    opener.focus();
    act(() => { fireEvent.click(opener); });
    expect(document.activeElement).toBe(screen.getByText('A first'));
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(document.activeElement).toBe(opener);
  });

  it('control: a closed dialog neither traps nor handles Escape', () => {
    const onEscape = vi.fn();
    render(<Dialog open={false} onEscape={onEscape} label="A" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('non-modal: joins the Escape stack above an open modal', () => {
    const modal = vi.fn();
    const popover = vi.fn();
    render(
      <>
        <Dialog open onEscape={modal} label="Modal" />
        <Dialog open onEscape={popover} label="Pop" modal={false} />
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(popover).toHaveBeenCalledTimes(1);
    expect(modal).not.toHaveBeenCalled();
  });

  it('non-modal: does not take focus on open and does not trap Tab', () => {
    render(
      <>
        <button>Outside</button>
        <Dialog open onEscape={vi.fn()} label="Pop" modal={false} />
      </>,
    );
    const outside = screen.getByText('Outside');
    outside.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    outside.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it('non-modal: control — closing with focus outside leaves focus where the user put it', () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(false)}>Elsewhere</button>
          <Dialog open={open} onEscape={() => setOpen(false)} label="Pop" modal={false} />
        </>
      );
    }
    render(<Host />);
    const elsewhere = screen.getByText('Elsewhere');
    elsewhere.focus();
    act(() => { fireEvent.click(elsewhere); });
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('useDialogBehavior returnFocusRef', () => {
  function WithTrigger() {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    useDialogBehavior({ open, containerRef: panel, onEscape: () => setOpen(false), modal: false, returnFocusRef: trigger });
    return (
      <>
        <button ref={trigger} onClick={() => setOpen(true)}>Trigger</button>
        {open && <div ref={panel}><button>Inside</button></div>}
      </>
    );
  }

  it('returns focus to the declared trigger even when the click never focused it', () => {
    render(<WithTrigger />);
    act(() => { fireEvent.click(screen.getByText('Trigger')); });
    screen.getByText('Inside').focus();
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(document.activeElement).toBe(screen.getByText('Trigger'));
  });
});

describe('useDialogBehavior nesting', () => {
  it('a dialog nested inside another, mounted in the same commit, is on top', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Dialog open onEscape={outer} label="Outer">
        <Dialog open onEscape={inner} label="Inner" />
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
