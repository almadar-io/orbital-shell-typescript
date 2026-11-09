import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useDialogBehavior } from '../../src/core/hooks/useDialogBehavior';

function Dialog({ open }: { open: boolean }): React.ReactElement | null {
  const ref = React.useRef<HTMLDivElement>(null);
  useDialogBehavior({ open, containerRef: ref, onEscape: () => {} });
  return open ? <div ref={ref} role="dialog"><button>inside</button></div> : <div ref={ref} />;
}

describe('a dialog moves focus without scrolling the page behind it', () => {
  it('handing focus back to the opener on close does not scroll', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const spy = vi.spyOn(opener, 'focus');
    const { rerender } = render(<Dialog open />);
    rerender(<Dialog open={false} />);
    expect(spy).toHaveBeenCalledWith({ preventScroll: true });
    opener.remove();
  });

  it('control: focus does return to the opener', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<Dialog open />);
    rerender(<Dialog open={false} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
