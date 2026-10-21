/**
 * A hover popover stays open while the pointer crosses from its trigger into the
 * panel (to read, scroll or copy what it shows), closes once the pointer has left
 * both, and opens for keyboard focus too.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Popover, HOVER_CLOSE_DELAY_MS } from '../Popover';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup() {
  render(
    <Popover trigger="hover" content={<div data-testid="panel-body">(set @entity.open true)</div>}>
      <span data-testid="glyph" tabIndex={0}>set</span>
    </Popover>,
  );
  return { glyph: screen.getByTestId('glyph') };
}

describe('Popover hover is sticky', () => {
  it('stays open while the pointer moves from the trigger into the panel', async () => {
    const { glyph } = setup();
    fireEvent.mouseEnter(glyph);
    const body = await screen.findByTestId('panel-body');
    fireEvent.mouseLeave(glyph);
    fireEvent.mouseEnter(body.closest('[role="dialog"]')!);
    await wait(HOVER_CLOSE_DELAY_MS * 2);
    expect(screen.getByTestId('panel-body')).toBeTruthy();
    expect(glyph.getAttribute('data-popover-open')).toBe('true');
  });

  it('closes once the pointer has left both, not before the grace delay', async () => {
    const { glyph } = setup();
    fireEvent.mouseEnter(glyph);
    await screen.findByTestId('panel-body');
    fireEvent.mouseLeave(glyph);
    expect(glyph.getAttribute('data-popover-open')).toBe('true');
    await waitFor(() => expect(glyph.getAttribute('data-popover-open')).toBe('false'), { timeout: HOVER_CLOSE_DELAY_MS * 4 });
  });

  it('opens on keyboard focus and closes on blur', async () => {
    const { glyph } = setup();
    fireEvent.focus(glyph);
    expect(await screen.findByTestId('panel-body')).toBeTruthy();
    fireEvent.blur(glyph);
    await waitFor(() => expect(glyph.getAttribute('data-popover-open')).toBe('false'), { timeout: HOVER_CLOSE_DELAY_MS * 4 });
  });
});
