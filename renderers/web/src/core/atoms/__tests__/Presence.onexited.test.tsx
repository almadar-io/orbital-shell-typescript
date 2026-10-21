// @vitest-environment jsdom
/**
 * `onExited` fires after EVERY exit — including when motion is off, where the
 * element unmounts immediately (the slot presence releases on it).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { usePresence } from '../../index';

function Probe({ show, animate, onExited }: { show: boolean; animate: boolean; onExited: () => void }) {
  const { mounted, className, onAnimationEnd } = usePresence(show, { animation: 'modal', animate, onExited });
  return mounted ? <span data-testid="el" className={className} onAnimationEnd={onAnimationEnd} /> : null;
}

describe('usePresence onExited', () => {
  it('motion off: an exit unmounts at once and still fires onExited', () => {
    const onExited = vi.fn();
    const { rerender, queryByTestId } = render(<Probe show animate={false} onExited={onExited} />);
    rerender(<Probe show={false} animate={false} onExited={onExited} />);
    expect(queryByTestId('el')).toBeNull();
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('control: motion on fires onExited only after the exit animation ends', () => {
    const onExited = vi.fn();
    const { rerender, getByTestId, queryByTestId } = render(<Probe show animate onExited={onExited} />);
    rerender(<Probe show={false} animate onExited={onExited} />);
    expect(onExited).not.toHaveBeenCalled();
    act(() => { fireEvent.animationEnd(getByTestId('el')); });
    expect(queryByTestId('el')).toBeNull();
    expect(onExited).toHaveBeenCalledTimes(1);
  });
});
