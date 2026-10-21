import { describe, it, expect } from 'vitest';
import { placePopover } from '../Popover';

const rect = (left: number, top: number, width = 100, height = 40) => ({ left, top, right: left + width, bottom: top + height, width, height });
const VIEW = { width: 1000, height: 800 };
const PANEL = { width: 300, height: 200 };

describe('placePopover — the panel stays on screen', () => {
  it('control: a right panel that fits sits right of the trigger, centred on it', () => {
    expect(placePopover('right', rect(100, 300), PANEL, VIEW)).toEqual({ side: 'right', left: 208, top: 220 });
  });

  it('flips to the left when the right side would overflow', () => {
    expect(placePopover('right', rect(800, 300), PANEL, VIEW)).toEqual({ side: 'left', left: 492, top: 220 });
  });

  it('flips to the right when the left side would overflow', () => {
    expect(placePopover('left', rect(50, 300), PANEL, VIEW).side).toBe('right');
  });

  it('clamps inside the viewport when neither side fits', () => {
    const p = placePopover('right', rect(400, 300, 200), { width: 700, height: 200 }, VIEW);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 700).toBeLessThanOrEqual(1000 - 8);
  });

  it('clamps vertically near the bottom edge', () => {
    const p = placePopover('right', rect(100, 760), PANEL, VIEW);
    expect(p.top + PANEL.height).toBeLessThanOrEqual(800 - 8);
  });

  it('flips a top panel below the trigger when there is no room above', () => {
    expect(placePopover('top', rect(400, 20), PANEL, VIEW)).toMatchObject({ side: 'bottom', top: 68 });
  });

  it('control: a bottom panel that fits stays below, centred and clamped horizontally', () => {
    expect(placePopover('bottom', rect(950, 300, 40), PANEL, VIEW)).toEqual({ side: 'bottom', left: 692, top: 348 });
  });
});
