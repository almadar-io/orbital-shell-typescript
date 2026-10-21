import { describe, it, expect } from 'vitest';
import {
  allDesignClasses,
  sizingOf,
  withSizing,
  spacingOf,
  withSpacing,
  snapToSpacingStep,
  tokenOfDesignClass,
  layoutOf,
  withLayout,
  sizeLimitOf,
  withSizeLimit,
  positionOf,
  withPosition,
  withPositioningContext,
  spacingTokenOf,
  isArbitraryClass,
  DESIGN_COLOR_TOKENS,
} from '../../src/lib/design-classes';

describe('tokenOfDesignClass', () => {
  it('maps color classes to their color token', () => {
    expect(tokenOfDesignClass('bg-primary')).toEqual({ group: 'colors', key: 'primary' });
    expect(tokenOfDesignClass('text-muted-foreground')).toEqual({ group: 'colors', key: 'muted-foreground' });
    expect(tokenOfDesignClass('border-border')).toEqual({ group: 'colors', key: 'border' });
  });

  it('maps radius classes to their radius token', () => {
    expect(tokenOfDesignClass('rounded-lg')).toEqual({ group: 'radii', key: 'lg' });
  });

  it('reads through variant prefixes', () => {
    expect(tokenOfDesignClass('hover:bg-primary')).toEqual({ group: 'colors', key: 'primary' });
    expect(tokenOfDesignClass('md:dark:text-accent')).toEqual({ group: 'colors', key: 'accent' });
  });

  it('spacing classes on steps 0–12 read their --space-N token', () => {
    expect(tokenOfDesignClass('w-10')).toEqual({ group: 'spacing', key: '10' });
    expect(tokenOfDesignClass('p-4')).toEqual({ group: 'spacing', key: '4' });
    expect(tokenOfDesignClass('gap-2')).toEqual({ group: 'spacing', key: '2' });
    expect(tokenOfDesignClass('pt-0')).toEqual({ group: 'spacing', key: '0' });
    expect(tokenOfDesignClass('md:px-3')).toEqual({ group: 'spacing', key: '3' });
  });

  it('rem spacing steps, sizing modes, arbitrary and unknown classes have no token', () => {
    for (const c of ['w-60', 'p-3.5', 'h-14', 'w-fit', 'w-full', 'bg-[#e14b2a]', 'bg-red-500', 'rounded-3xl', 'text-center', 'flex', '']) {
      expect(tokenOfDesignClass(c)).toBeNull();
    }
  });

  it('text-foreground is a color token, not a partial match of another', () => {
    expect(tokenOfDesignClass('text-foreground')).toEqual({ group: 'colors', key: 'foreground' });
  });
});

describe('snapToSpacingStep', () => {
  it('snaps to the nearest step', () => {
    expect(snapToSpacingStep(240)).toBe(60);
    expect(snapToSpacingStep(243)).toBe(60);
    expect(snapToSpacingStep(250)).toBe(64);
    expect(snapToSpacingStep(6)).toBe(1.5);
  });

  it('clamps below zero and past the scale', () => {
    expect(snapToSpacingStep(-20)).toBe(0);
    expect(snapToSpacingStep(10_000)).toBe(96);
  });

  it('breaks ties toward the smaller step', () => {
    expect(snapToSpacingStep(232)).toBe(56);
  });

  it('snaps against what each step really renders at (theme --space-N tokens are not linear)', () => {
    // The base theme: --space-4 = 14px, --space-8 = 44px, --space-10 = 60px.
    const theme: Record<number, number> = { 0: 0, 1: 4, 2: 6, 3: 10, 4: 14, 5: 20, 6: 28, 7: 36, 8: 44, 9: 52, 10: 60, 11: 68, 12: 80 };
    const pxOf = (step: number) => theme[step] ?? step * 4;
    // Step 3.5 (0.875rem) also renders 14px; the token-backed step wins the tie.
    expect(snapToSpacingStep(14, pxOf)).toBe(4);
    expect(snapToSpacingStep(42, pxOf)).toBe(8);
    expect(snapToSpacingStep(40, pxOf)).toBe(7);
    expect(snapToSpacingStep(60, pxOf)).toBe(10);
    expect(snapToSpacingStep(40)).toBe(10);
  });
});

describe('allDesignClasses', () => {
  const all = allDesignClasses();

  it('covers every color token on every color utility', () => {
    for (const token of DESIGN_COLOR_TOKENS) {
      expect(all).toContain(`bg-${token}`);
      expect(all).toContain(`text-${token}`);
      expect(all).toContain(`border-${token}`);
    }
  });

  it('covers radius and the spacing scale', () => {
    expect(all).toEqual(expect.arrayContaining(['rounded-lg', 'rounded-full', 'w-60', 'h-0.5', 'gap-96', 'px-3']));
  });

  it('has no duplicates', () => {
    expect(new Set(all).size).toBe(all.length);
  });
});


describe('sizing modes (Figma Fixed / Hug / Fill → Tailwind)', () => {
  it('reads the mode of an axis', () => {
    expect(sizingOf(['p-4', 'w-60'], 'w')).toEqual({ mode: 'fixed', step: 60 });
    expect(sizingOf(['w-fit'], 'w')).toEqual({ mode: 'hug' });
    expect(sizingOf(['h-full'], 'h')).toEqual({ mode: 'fill' });
    expect(sizingOf(['p-4'], 'w')).toEqual({ mode: 'hug' });
  });

  it('variant-prefixed classes do not decide the base mode', () => {
    expect(sizingOf(['md:w-60'], 'w')).toEqual({ mode: 'hug' });
  });

  it('writes a mode, replacing only the same axis and keeping variants', () => {
    expect(withSizing(['p-4', 'w-60', 'h-10', 'md:w-96'], 'w', { mode: 'hug' })).toEqual(['p-4', 'h-10', 'md:w-96', 'w-fit']);
    expect(withSizing(['w-fit'], 'w', { mode: 'fill' })).toEqual(['w-full']);
    expect(withSizing(['w-full'], 'w', { mode: 'fixed', step: 24 })).toEqual(['w-24']);
    expect(withSizing([], 'h', { mode: 'fixed', step: 0.5 })).toEqual(['h-0.5']);
  });
});

describe('spacing (Figma gap / padding → Tailwind)', () => {
  it('reads gap and per-side padding, most specific class winning', () => {
    const classes = ['gap-4', 'p-2', 'px-6', 'pt-8'];
    expect(spacingOf(classes)).toEqual({ gap: 4, top: 8, right: 6, bottom: 2, left: 6 });
    expect(spacingOf([])).toEqual({ gap: 0, top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('writes the smallest class set for the result', () => {
    expect(withSpacing(['flex', 'gap-4'], { gap: 6 })).toEqual(['flex', 'gap-6']);
    expect(withSpacing(['p-2'], { top: 8 })).toEqual(['pt-8', 'pr-2', 'pb-2', 'pl-2']);
    expect(withSpacing(['pt-8', 'pr-2', 'pb-2', 'pl-2'], { top: 2 })).toEqual(['p-2']);
    expect(withSpacing(['p-2'], { left: 4, right: 4 })).toEqual(['px-4', 'py-2']);
    expect(withSpacing(['gap-4', 'p-2'], { gap: 0 })).toEqual(['p-2']);
  });

  it('keeps variant-prefixed spacing untouched', () => {
    expect(withSpacing(['md:p-8', 'p-2'], { top: 4 })).toEqual(['md:p-8', 'pt-4', 'pr-2', 'pb-2', 'pl-2']);
  });

  it('every class these helpers can write is in the vocabulary (so it compiles)', () => {
    const all = new Set(allDesignClasses());
    for (const c of ['w-fit', 'w-full', 'h-fit', 'h-full', 'pt-8', 'pr-3.5', 'pb-96', 'pl-0', 'px-4', 'py-2', 'gap-6']) {
      expect(all.has(c)).toBe(true);
    }
  });
});

describe('auto layout (Figma direction + alignment grid → Tailwind)', () => {
  it('reads direction, alignment and wrap from the classes, null where none is set', () => {
    expect(layoutOf(['flex', 'flex-row', 'items-center', 'justify-end'])).toEqual({ direction: 'horizontal', align: 'center', justify: 'end', wrap: false });
    expect(layoutOf(['p-4'])).toEqual({ direction: null, align: null, justify: null, wrap: false });
    expect(layoutOf(['flex-col', 'items-stretch', 'justify-between'])).toEqual({ direction: 'vertical', align: null, justify: 'between', wrap: false });
    expect(layoutOf(['flex-row', 'flex-wrap'])).toEqual({ direction: 'horizontal', align: null, justify: null, wrap: true });
  });

  it('variant-prefixed classes do not decide the base layout', () => {
    expect(layoutOf(['md:flex-row', 'hover:items-center', 'md:justify-between', 'md:flex-wrap'])).toEqual({ direction: null, align: null, justify: null, wrap: false });
  });

  it('writes one class per changed axis, replacing the old one and keeping variants', () => {
    expect(withLayout(['p-4', 'flex-col', 'md:flex-row'], { direction: 'horizontal' })).toEqual(['p-4', 'md:flex-row', 'flex-row']);
    expect(withLayout(['items-stretch', 'justify-between'], { align: 'center', justify: 'start' })).toEqual(['items-center', 'justify-start']);
    expect(withLayout(['flex-row-reverse'], { direction: 'vertical' })).toEqual(['flex-col']);
    expect(withLayout(['items-end'], { justify: 'center' })).toEqual(['items-end', 'justify-center']);
  });

  it('space-between replaces the main-axis alignment, and a grid position replaces space-between', () => {
    expect(withLayout(['justify-center', 'md:justify-end'], { justify: 'between' })).toEqual(['md:justify-end', 'justify-between']);
    expect(withLayout(['justify-between'], { justify: 'start' })).toEqual(['justify-start']);
  });

  it('wrap on adds flex-wrap once; wrap off removes it and a stray flex-nowrap, keeping variants', () => {
    expect(withLayout(['flex-row'], { wrap: true })).toEqual(['flex-row', 'flex-wrap']);
    expect(withLayout(['flex-row', 'flex-wrap'], { wrap: true })).toEqual(['flex-row', 'flex-wrap']);
    expect(withLayout(['flex-wrap', 'flex-nowrap', 'md:flex-wrap'], { wrap: false })).toEqual(['md:flex-wrap']);
  });

  it('every class it can write is in the vocabulary (so it compiles)', () => {
    const all = new Set(allDesignClasses());
    for (const c of ['flex-row', 'flex-col', 'items-start', 'items-center', 'items-end', 'justify-start', 'justify-center', 'justify-end', 'justify-between', 'flex-wrap']) {
      expect(all.has(c)).toBe(true);
    }
  });
});

describe('min / max size (Figma min/max width and height → Tailwind)', () => {
  it('reads each limit per axis, null when unset; w-* and variants never count', () => {
    const classes = ['w-40', 'min-w-10', 'max-w-96', 'md:min-h-4', 'max-h-60'];
    expect(sizeLimitOf(classes, 'w', 'min')).toBe(10);
    expect(sizeLimitOf(classes, 'w', 'max')).toBe(96);
    expect(sizeLimitOf(classes, 'h', 'min')).toBeNull();
    expect(sizeLimitOf(classes, 'h', 'max')).toBe(60);
    expect(sizeLimitOf(['min-w-[120px]'], 'w', 'min')).toBeNull();
  });

  it('writes, replaces and clears one limit without touching the size or the other limits', () => {
    expect(withSizeLimit(['w-40', 'min-w-10'], 'w', 'min', 12)).toEqual(['w-40', 'min-w-12']);
    expect(withSizeLimit(['w-40', 'min-w-[120px]'], 'w', 'min', 4)).toEqual(['w-40', 'min-w-4']);
    expect(withSizeLimit(['h-full', 'max-h-60', 'min-h-4'], 'h', 'max', null)).toEqual(['h-full', 'min-h-4']);
    expect(withSizeLimit(['md:max-w-4'], 'w', 'max', 8)).toEqual(['md:max-w-4', 'max-w-8']);
  });

  it('limits are token-backed spacing like W/H, and in the vocabulary', () => {
    expect(tokenOfDesignClass('min-w-4')).toEqual({ group: 'spacing', key: '4' });
    expect(tokenOfDesignClass('max-h-12')).toEqual({ group: 'spacing', key: '12' });
    const all = new Set(allDesignClasses());
    for (const c of ['min-w-0', 'max-w-96', 'min-h-0.5', 'max-h-12']) expect(all.has(c)).toBe(true);
  });
});

describe('absolute position + constraints (Figma → Tailwind)', () => {
  it('an element with no position classes is in the flow', () => {
    expect(positionOf(['p-4'])).toEqual({
      absolute: false,
      x: { constraint: 'start', start: 0, end: 0 },
      y: { constraint: 'start', start: 0, end: 0 },
    });
  });

  it('left/top pin to the start, right/bottom to the end, both sides stretch', () => {
    expect(positionOf(['absolute', 'left-[12px]', 'bottom-[8px]'])).toEqual({
      absolute: true,
      x: { constraint: 'start', start: 12, end: 0 },
      y: { constraint: 'end', start: 0, end: 8 },
    });
    expect(positionOf(['absolute', 'left-0', 'right-[20px]', 'top-3'])).toEqual({
      absolute: true,
      x: { constraint: 'both', start: 0, end: 20 },
      y: { constraint: 'start', start: 12, end: 0 },
    });
  });

  it('center and scale are read from their class pairs', () => {
    expect(positionOf(['absolute', 'left-1/2', '-translate-x-1/2', 'top-[10%]', 'bottom-[25%]'])).toEqual({
      absolute: true,
      x: { constraint: 'center', start: 0, end: 0 },
      y: { constraint: 'scale', start: 10, end: 25 },
    });
  });

  it('center carries an offset from the centre (Figma), written as a calc and read back', () => {
    expect(positionOf(['absolute', 'left-[calc(50%+12px)]', '-translate-x-1/2', 'top-[calc(50%-8px)]', '-translate-y-1/2'])).toEqual({
      absolute: true,
      x: { constraint: 'center', start: 12, end: 0 },
      y: { constraint: 'center', start: -8, end: 0 },
    });
    expect(withPosition([], {
      absolute: true,
      x: { constraint: 'center', start: 12.4, end: 0 },
      y: { constraint: 'center', start: -8, end: 0 },
    })).toEqual(['absolute', 'left-[calc(50%+12px)]', '-translate-x-1/2', 'top-[calc(50%-8px)]', '-translate-y-1/2']);
    expect(withPosition(['absolute', 'left-[calc(50%+3px)]', '-translate-x-1/2'], {
      absolute: true,
      x: { constraint: 'start', start: 5, end: 0 },
      y: { constraint: 'start', start: 0, end: 0 },
    })).toEqual(['absolute', 'left-[5px]', 'top-0']);
    expect(isArbitraryClass('left-[calc(50%+12px)]')).toBe(true);
  });

  it('writes the smallest class set per constraint, replacing every old position class', () => {
    const base = ['p-4', 'absolute', 'left-[3px]', 'top-1/2', '-translate-y-1/2', 'md:left-4'];
    expect(withPosition(base, {
      absolute: true,
      x: { constraint: 'end', start: 0, end: 16 },
      y: { constraint: 'both', start: 0, end: 4.4 },
    })).toEqual(['p-4', 'md:left-4', 'absolute', 'right-[16px]', 'top-0', 'bottom-[4px]']);
    expect(withPosition(['absolute', 'right-0'], {
      absolute: true,
      x: { constraint: 'center', start: 0, end: 0 },
      y: { constraint: 'scale', start: 12.34, end: 0 },
    })).toEqual(['absolute', 'left-1/2', '-translate-x-1/2', 'top-[12.3%]', 'bottom-0']);
  });

  it('turning absolute off removes every position class, and leaves other classes alone', () => {
    expect(withPosition(['w-40', 'absolute', 'left-[3px]', 'top-[4px]', 'hover:top-2'], {
      absolute: false,
      x: { constraint: 'start', start: 3, end: 0 },
      y: { constraint: 'start', start: 4, end: 0 },
    })).toEqual(['w-40', 'hover:top-2']);
  });

  it('negative offsets (an element dragged past its parent) are written as negative arbitrary values', () => {
    expect(withPosition([], {
      absolute: true,
      x: { constraint: 'start', start: -6, end: 0 },
      y: { constraint: 'start', start: 0, end: 0 },
    })).toEqual(['absolute', 'left-[-6px]', 'top-0']);
    expect(positionOf(['absolute', 'left-[-6px]']).x).toEqual({ constraint: 'start', start: -6, end: 0 });
  });

  it('the parent of an absolute child becomes its positioning context, once', () => {
    expect(withPositioningContext(['flex', 'gap-2'])).toEqual(['flex', 'gap-2', 'relative']);
    expect(withPositioningContext(['relative', 'flex'])).toEqual(['relative', 'flex']);
    expect(withPositioningContext(['absolute'])).toEqual(['absolute']);
  });

  it('the fixed position classes are in the vocabulary', () => {
    const all = new Set(allDesignClasses());
    for (const c of ['absolute', 'relative', 'left-1/2', 'top-1/2', '-translate-x-1/2', '-translate-y-1/2', 'left-0', 'right-0', 'top-0', 'bottom-0']) {
      expect(all.has(c)).toBe(true);
    }
  });
});

describe('spacingTokenOf', () => {
  it('names the theme token behind steps 0–12 (the preset reads them)', () => {
    expect(spacingTokenOf(0)).toBe('--space-0');
    expect(spacingTokenOf(12)).toBe('--space-12');
  });

  it('fractional and larger steps have no token (Tailwind rem)', () => {
    expect(spacingTokenOf(0.5)).toBeNull();
    expect(spacingTokenOf(14)).toBeNull();
  });
});
