/**
 * A controlled hover popover closed by its host (BehaviorCard closes its preview
 * on pointerdown) unmounts after its exit — the click-trigger inner-control
 * lookup must not re-render a hover popover on every pass.
 */
import React, { useState } from 'react';
import { it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Popover } from '../Popover';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div onPointerDownCapture={() => setOpen(false)}>
      <Popover trigger="hover" open={open} onOpenChange={setOpen} content={<div data-testid="live-preview">p</div>}>
        <div data-testid="body"><button>Use</button></div>
      </Popover>
    </div>
  );
}

it('a controlled hover popover closed on pointerdown unmounts', async () => {
  render(<Harness />);
  fireEvent.mouseEnter(screen.getByTestId('body'));
  expect(await screen.findByTestId('live-preview')).toBeTruthy();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Use' }));
  await waitFor(() => expect(screen.queryByTestId('live-preview')).toBeNull(), { timeout: 2000 });
});
