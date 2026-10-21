import React, { useRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useOnScreen } from '../useOnScreen';

let drive: (intersecting: boolean) => void = () => undefined;
function stubObserver() {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) { drive = (i) => cb([{ isIntersecting: i }]); }
    observe() { /* driven by the test */ }
    disconnect() { /* nothing to release */ }
  });
}

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const on = useOnScreen(ref);
  return <div ref={ref}>{on ? 'on' : 'off'}</div>;
}

afterEach(() => vi.unstubAllGlobals());

describe('useOnScreen', () => {
  it('turns off when the element scrolls away and back on when it returns', () => {
    stubObserver();
    render(<Probe />);
    expect(screen.getByText('on')).toBeTruthy();
    act(() => drive(false));
    expect(screen.getByText('off')).toBeTruthy();
    act(() => drive(true));
    expect(screen.getByText('on')).toBeTruthy();
  });

  it('turns off while the tab is hidden', () => {
    stubObserver();
    render(<Probe />);
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByText('off')).toBeTruthy();
    state.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByText('on')).toBeTruthy();
  });

  it('control: stays on when nothing changes', () => {
    stubObserver();
    render(<Probe />);
    expect(screen.getByText('on')).toBeTruthy();
  });
});
