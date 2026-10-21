// @vitest-environment jsdom
/**
 * A control never leaves the tab order while it holds focus: an author-set
 * `disabled` on a focused Button becomes aria-disabled (activation ignored)
 * until focus leaves, then native `disabled`.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { Button } from '../../src/core';

function Harness({ onNext }: { onNext: () => void }) {
  const [last, setLast] = useState(false);
  return (
    <EventBusProvider debug={false}>
      <Button label="Next" disabled={last} onClick={() => { onNext(); setLast(true); }} />
      <Button label="Other" />
    </EventBusProvider>
  );
}

describe('Button keeps focus when disabled while focused', () => {
  it('a focused button that becomes disabled keeps focus and is aria-disabled', () => {
    const onNext = vi.fn();
    render(<Harness onNext={onNext} />);
    const next = screen.getByRole('button', { name: 'Next' });
    act(() => next.focus());
    fireEvent.click(next);
    expect(document.activeElement).toBe(next);
    expect(next.hasAttribute('disabled')).toBe(false);
    expect(next.getAttribute('aria-disabled')).toBe('true');
  });

  it('activation is ignored while focused and disabled', () => {
    const onNext = vi.fn();
    render(<Harness onNext={onNext} />);
    const next = screen.getByRole('button', { name: 'Next' });
    act(() => next.focus());
    fireEvent.click(next);
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('once focus leaves, the disabled button becomes natively disabled', () => {
    render(<Harness onNext={vi.fn()} />);
    const next = screen.getByRole('button', { name: 'Next' });
    act(() => next.focus());
    fireEvent.click(next);
    act(() => screen.getByRole('button', { name: 'Other' }).focus());
    expect(next.hasAttribute('disabled')).toBe(true);
  });

  it('control: an unfocused disabled button is natively disabled from the start', () => {
    render(<EventBusProvider debug={false}><Button label="Save" disabled /></EventBusProvider>);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('edge: a caller onFocus/onBlur still runs', () => {
    const onFocus = vi.fn(); const onBlur = vi.fn();
    render(<EventBusProvider debug={false}><Button label="A" onFocus={onFocus} onBlur={onBlur} /><Button label="B" /></EventBusProvider>);
    act(() => screen.getByRole('button', { name: 'A' }).focus());
    act(() => screen.getByRole('button', { name: 'B' }).focus());
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
