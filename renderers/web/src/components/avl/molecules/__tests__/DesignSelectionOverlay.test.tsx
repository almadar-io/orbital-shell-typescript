// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { DesignSelectionOverlay } from '../DesignSelectionOverlay';
import { type DesignAlignment, type DesignJustify } from '../../../../lib/design-classes';

class PointerEventStub extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}
(globalThis as { PointerEvent?: unknown }).PointerEvent ??= PointerEventStub;

const rect = { top: 10, left: 10, width: 80, height: 30 };
const rowChildren = [
  { top: 18, left: 18, width: 20, height: 14 },
  { top: 18, left: 54, width: 20, height: 14 },
];

function mount(classes: string[] | null, container = false) {
  const onChange = vi.fn();
  render(
    <DesignSelectionOverlay
      rect={rect}
      childRects={container ? rowChildren : []}
      axis={container ? 'horizontal' : null}
      classes={classes}
      zoom={1}
      onChange={onChange}
    />,
  );
  return { onChange };
}

function drag(testId: string, dx: number, dy: number, init: PointerEventInit = {}) {
  const el = screen.getByTestId(testId);
  fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1, ...init });
  fireEvent.pointerMove(el, { clientX: dx, clientY: dy, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: dx, clientY: dy, pointerId: 1 });
}

describe('DesignSelectionOverlay — resize (Figma Fixed / Hug / Fill)', () => {
  it('dragging the right edge sets a Fixed width snapped to the scale', () => {
    const { onChange } = mount(['px-3', 'w-fit']);
    drag('design-resize-e', 100, 40);
    expect(onChange).toHaveBeenCalledWith(['px-3', 'w-44']);
  });

  it('the corner sets both axes', () => {
    const { onChange } = mount([]);
    drag('design-resize-se', 240, 40);
    expect(onChange).toHaveBeenCalledWith(['w-80', 'h-16']);
  });

  it('double-clicking an edge sets Hug; ⌥-double-click sets Fill', () => {
    const { onChange } = mount(['w-60', 'h-10']);
    fireEvent.doubleClick(screen.getByTestId('design-resize-e'));
    expect(onChange).toHaveBeenLastCalledWith(['h-10', 'w-fit']);
    fireEvent.doubleClick(screen.getByTestId('design-resize-s'), { altKey: true });
    expect(onChange).toHaveBeenLastCalledWith(['w-60', 'h-full']);
  });

  it('the size label names the mode per axis', () => {
    mount(['w-fit', 'h-full']);
    expect(screen.getByTestId('orb-preview-size-label').textContent).toBe('Hug × Fill');
  });

  it('a Fixed axis shows its pixel size', () => {
    mount(['w-20']);
    expect(screen.getByTestId('orb-preview-size-label').textContent).toBe('80 × Hug');
  });
});

describe('DesignSelectionOverlay — spacing handles', () => {
  it('a layout container gets one gap handle per gap and four padding bands', () => {
    mount(['flex', 'gap-4', 'p-2'], true);
    expect(screen.getByTestId('design-gap-0')).toBeTruthy();
    expect(screen.queryByTestId('design-gap-1')).toBeNull();
    for (const side of ['top', 'right', 'bottom', 'left']) expect(screen.getByTestId(`design-padding-${side}`)).toBeTruthy();
  });

  it('dragging a gap handle along the flow changes gap', () => {
    const { onChange } = mount(['flex', 'gap-4'], true);
    drag('design-gap-0', 8, 0);
    expect(onChange).toHaveBeenCalledWith(['flex', 'gap-6']);
  });

  it('dragging a padding band changes that side; ⌥ mirrors the opposite side', () => {
    const { onChange } = mount(['p-2'], true);
    drag('design-padding-top', 0, 16);
    expect(onChange).toHaveBeenLastCalledWith(['pt-6', 'pr-2', 'pb-2', 'pl-2']);
    drag('design-padding-left', 8, 0, { altKey: true });
    expect(onChange).toHaveBeenLastCalledWith(['px-4', 'py-2']);
  });

  it('a non-container element gets resize handles but no spacing handles', () => {
    mount(['w-10']);
    expect(screen.getByTestId('design-resize-e')).toBeTruthy();
    expect(screen.queryByTestId('design-gap-0')).toBeNull();
    expect(screen.queryByTestId('design-padding-top')).toBeNull();
  });

  it('a className bound to an expression shows the frame but offers no edits', () => {
    mount(null, true);
    expect(screen.getByTestId('orb-preview-selection')).toBeTruthy();
    expect(screen.queryByTestId('design-resize-e')).toBeNull();
    expect(screen.queryByTestId('design-gap-0')).toBeNull();
  });
});

describe('DesignSelectionOverlay — auto layout (direction + alignment grid)', () => {
  function mountLayout(
    classes: string[] | null,
    axis: 'horizontal' | 'vertical' | null,
    measured: { align: DesignAlignment | null; justify: DesignJustify | null } = { align: null, justify: null },
  ) {
    const onChange = vi.fn();
    render(
      <DesignSelectionOverlay
        rect={rect}
        childRects={axis ? rowChildren : []}
        axis={axis}
        alignment={measured}
        classes={classes}
        zoom={1}
        onChange={onChange}
      />,
    );
    return { onChange };
  }

  it('a layout container gets a direction toggle and a 3×3 grid; anything else gets neither', () => {
    mountLayout(['p-2'], 'horizontal');
    expect(screen.getByTestId('design-layout-direction-vertical')).toBeTruthy();
    expect(screen.getAllByTestId(/^design-align-\d-\d$/)).toHaveLength(9);
  });

  it('no controls on a non-container or when className is a binding', () => {
    mountLayout(['p-2'], null);
    expect(screen.queryByTestId('design-align-0-0')).toBeNull();
  });

  it('no controls when className is a binding', () => {
    mountLayout(null, 'horizontal');
    expect(screen.queryByTestId('design-align-0-0')).toBeNull();
  });

  it('horizontal: columns are the main axis (justify), rows the cross axis (items)', () => {
    const { onChange } = mountLayout(['p-2'], 'horizontal');
    fireEvent.click(screen.getByTestId('design-align-0-2'));
    expect(onChange).toHaveBeenLastCalledWith(['p-2', 'items-start', 'justify-end']);
  });

  it('vertical: rows are the main axis (justify), columns the cross axis (items)', () => {
    const { onChange } = mountLayout(['p-2'], 'vertical');
    fireEvent.click(screen.getByTestId('design-align-2-1'));
    expect(onChange).toHaveBeenLastCalledWith(['p-2', 'items-center', 'justify-end']);
  });

  it('the direction toggle writes flex-row / flex-col', () => {
    const { onChange } = mountLayout(['p-2'], 'horizontal');
    fireEvent.click(screen.getByTestId('design-layout-direction-vertical'));
    expect(onChange).toHaveBeenLastCalledWith(['p-2', 'flex-col']);
  });

  it('the current alignment is marked: classes first, else what the element renders', () => {
    mountLayout(['items-end', 'justify-center'], 'horizontal', { align: 'start', justify: 'start' });
    expect(screen.getByTestId('design-align-2-1').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('design-align-0-0').getAttribute('aria-pressed')).toBe('false');
  });

  it('falls back to the rendered alignment when no class sets it', () => {
    mountLayout(['p-2'], 'vertical', { align: 'center', justify: 'start' });
    expect(screen.getByTestId('design-align-0-1').getAttribute('aria-pressed')).toBe('true');
  });

  it('space-between toggles on (justify-between) and off (back to start)', () => {
    const { onChange } = mountLayout(['p-2', 'justify-center'], 'horizontal');
    const toggle = screen.getByTestId('design-layout-space-between');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(['p-2', 'justify-between']);
  });

  it('with space-between on, the toggle is pressed and turning it off writes justify-start', () => {
    const { onChange } = mountLayout(['justify-between'], 'horizontal');
    const toggle = screen.getByTestId('design-layout-space-between');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(['justify-start']);
  });

  it('with space-between on, the grid sets only the cross axis, and marks the whole cross-axis line', () => {
    const { onChange } = mountLayout(['justify-between', 'items-end'], 'horizontal');
    expect(screen.getByTestId('design-align-2-0').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('design-align-2-2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('design-align-0-0').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('design-align-1-2'));
    expect(onChange).toHaveBeenLastCalledWith(['justify-between', 'items-center']);
  });

  it('space-between rendered by props (no class) still reads as on', () => {
    mountLayout(['p-2'], 'vertical', { align: 'start', justify: 'between' });
    expect(screen.getByTestId('design-layout-space-between').getAttribute('aria-pressed')).toBe('true');
  });

  it('wrap toggles flex-wrap on and off', () => {
    const first = mountLayout(['flex-row'], 'horizontal');
    const toggle = screen.getByTestId('design-layout-wrap');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(first.onChange).toHaveBeenLastCalledWith(['flex-row', 'flex-wrap']);
  });

  it('wrap on reads pressed and turns off', () => {
    const { onChange } = mountLayout(['flex-row', 'flex-wrap'], 'horizontal');
    fireEvent.click(screen.getByTestId('design-layout-wrap'));
    expect(onChange).toHaveBeenLastCalledWith(['flex-row']);
  });
});

describe('DesignSelectionOverlay — click a spacing handle to type a value', () => {
  function click(testId: string) {
    const el = screen.getByTestId(testId);
    fireEvent.pointerDown(el, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 5, clientY: 5, pointerId: 1 });
  }

  it('clicking the gap opens a field with its current pixels; Enter writes the snapped class', () => {
    const { onChange } = mount(['gap-4'], true);
    click('design-gap-0');
    const field = screen.getByTestId('design-spacing-input') as HTMLInputElement;
    expect(field.value).toBe('16');
    fireEvent.change(field, { target: { value: '25' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['gap-6']);
    expect(screen.queryByTestId('design-spacing-input')).toBeNull();
  });

  it('clicking a padding band types that side', () => {
    const { onChange } = mount(['p-2'], true);
    click('design-padding-left');
    const field = screen.getByTestId('design-spacing-input') as HTMLInputElement;
    expect(field.value).toBe('8');
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['pt-2', 'pr-2', 'pb-2', 'pl-0']);
  });

  it('Esc closes the field without writing', () => {
    const { onChange } = mount(['gap-4'], true);
    click('design-gap-0');
    fireEvent.keyDown(screen.getByTestId('design-spacing-input'), { key: 'Escape' });
    expect(screen.queryByTestId('design-spacing-input')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a non-number or negative value writes nothing', () => {
    const { onChange } = mount(['gap-4'], true);
    click('design-gap-0');
    const field = screen.getByTestId('design-spacing-input');
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: '-8' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a drag still drags (no field)', () => {
    const { onChange } = mount(['gap-4'], true);
    drag('design-gap-0', 8, 0);
    expect(onChange).toHaveBeenCalledWith(['gap-6']);
    expect(screen.queryByTestId('design-spacing-input')).toBeNull();
  });
});

describe('DesignSelectionOverlay — pixels are what the theme renders', () => {
  // The base theme's --space-N tokens (not linear); other steps are rem.
  const THEME: Record<number, number> = { 0: 0, 1: 4, 2: 6, 3: 10, 4: 14, 5: 20, 6: 28, 7: 36, 8: 44, 9: 52, 10: 60, 11: 68, 12: 80 };
  const pxOfStep = (step: number) => THEME[step] ?? step * 4;

  it('the field shows the rendered gap and typed pixels snap to the step that renders nearest', () => {
    const onChange = vi.fn();
    render(
      <DesignSelectionOverlay rect={rect} childRects={rowChildren} axis="horizontal" classes={['gap-4']} zoom={1} pxOfStep={pxOfStep} onChange={onChange} />,
    );
    const band = screen.getByTestId('design-gap-0');
    fireEvent.pointerDown(band, { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerUp(band, { clientX: 1, clientY: 1, pointerId: 1 });
    const field = screen.getByTestId('design-spacing-input') as HTMLInputElement;
    expect(field.value).toBe('14');
    fireEvent.change(field, { target: { value: '60' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['gap-10']);
  });

  it('resizing snaps widths the same way', () => {
    const onChange = vi.fn();
    render(<DesignSelectionOverlay rect={rect} childRects={[]} axis={null} classes={[]} zoom={1} pxOfStep={pxOfStep} onChange={onChange} />);
    // 80px wide → dragged to 60px, which --space-10 renders.
    drag('design-resize-e', -20, 0);
    expect(onChange).toHaveBeenLastCalledWith(['w-10']);
  });
});

describe('DesignSelectionOverlay — spacing set by props, not classes', () => {
  // A stack's gap/padding often come from its props (gap="md"), so the
  // classes say nothing; what renders is the truth to start from.
  const rendered = { gap: 16, top: 8, right: 8, bottom: 8, left: 8 };

  function openField(testId: string, onChange = vi.fn()) {
    render(
      <DesignSelectionOverlay rect={rect} childRects={rowChildren} axis="horizontal" classes={[]} renderedSpacing={rendered} zoom={1} onChange={onChange} />,
    );
    const band = screen.getByTestId(testId);
    fireEvent.pointerDown(band, { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerUp(band, { clientX: 1, clientY: 1, pointerId: 1 });
    return { field: screen.getByTestId('design-spacing-input') as HTMLInputElement, onChange };
  }

  it('the field shows the rendered value', () => {
    expect(openField('design-gap-0').field.value).toBe('16');
  });

  it('editing one side keeps what the others render', () => {
    const { field, onChange } = openField('design-padding-left');
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['gap-4', 'pt-2', 'pr-2', 'pb-2', 'pl-0']);
  });

  it('dragging starts from the rendered gap', () => {
    const onChange = vi.fn();
    render(
      <DesignSelectionOverlay rect={rect} childRects={rowChildren} axis="horizontal" classes={[]} renderedSpacing={rendered} zoom={1} onChange={onChange} />,
    );
    drag('design-gap-0', 8, 0);
    expect(onChange).toHaveBeenLastCalledWith(['gap-6', 'p-2']);
  });
});
