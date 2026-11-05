import React, { useRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useInAppLinkInterceptor } from '../inAppLinks';

const Box: React.FC<{ onPath: (path: string) => void; isolated?: boolean; children: React.ReactNode; label: string }> = ({ onPath, isolated = false, children, label }) => {
  const ref = useRef<HTMLDivElement>(null);
  useInAppLinkInterceptor(ref, { enabled: true, isolated, hostHrefBase: '/', onPath });
  return <div ref={ref} aria-label={label}>{children}</div>;
};

describe('useInAppLinkInterceptor', () => {
  it('a link inside a nested box is the nested box\'s navigation, never the outer box\'s', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Box label="outer" onPath={outer}>
        <Box label="inner" isolated onPath={inner}>
          <a href="/people">People</a>
        </Box>
      </Box>,
    );
    const click = fireEvent.click(screen.getByText('People'));
    expect(inner).toHaveBeenCalledWith('/people');
    expect(outer).not.toHaveBeenCalled();
    expect(click).toBe(false);
  });

  it('control: a link directly in the outer box is the outer box\'s navigation', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Box label="outer" onPath={outer}>
        <a href="/home">Home</a>
        <Box label="inner" isolated onPath={inner}>
          <span>guest</span>
        </Box>
      </Box>,
    );
    fireEvent.click(screen.getByText('Home'));
    expect(outer).toHaveBeenCalledWith('/home');
    expect(inner).not.toHaveBeenCalled();
  });

  it('an intercepted link still runs its own click handler (a drawer link closes its drawer) while the box navigates', () => {
    const inner = vi.fn();
    const closed = vi.fn();
    render(
      <Box label="outer" onPath={vi.fn()}>
        <Box label="inner" isolated onPath={inner}>
          <a href="/people" onClick={closed}>People</a>
        </Box>
      </Box>,
    );
    const click = fireEvent.click(screen.getByText('People'));
    expect(inner).toHaveBeenCalledWith('/people');
    expect(closed).toHaveBeenCalledTimes(1);
    expect(click).toBe(false);
  });

  it('edge: an external link in a nested isolated box opens nowhere in the host and reaches no onPath', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <Box label="outer" onPath={outer}>
        <Box label="inner" isolated onPath={inner}>
          <a href="https://example.com/x">Out</a>
        </Box>
      </Box>,
    );
    const click = fireEvent.click(screen.getByText('Out'));
    expect(click).toBe(false);
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
    expect(outer).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
