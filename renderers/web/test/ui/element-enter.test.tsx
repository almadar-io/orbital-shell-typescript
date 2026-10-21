// @vitest-environment jsdom
/**
 * Element entry: a slot's content plays the theme-default entry unless its root
 * node declares its own `enter`; any node's `enter` becomes a class on its own
 * element (runtime and compiled paths share lib/enter).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { UISlotProvider, useUISlots } from '../../src/providers/UISlotContext';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { UISlotComponent } from '../../src/components/core/organisms/UISlotRenderer';
import { enterClassName, ENTER_SLOT_CLASS } from '../../src/lib/enter';

function ManagerGrabber({ onReady }: { onReady: (manager: UISlotManager) => void }): null {
  onReady(useUISlots());
  return null;
}

function harness(children: React.ReactNode) {
  let manager!: UISlotManager;
  const utils = render(
    <EventBusProvider isolated>
      <UISlotProvider>
        <ManagerGrabber onReady={(m) => { manager = m; }} />
        {children}
      </UISlotProvider>
    </EventBusProvider>,
  );
  return { ...utils, manager: () => manager };
}

const slotBox = (): HTMLElement => {
  const el = document.getElementById('slot-main');
  if (!el) throw new Error('slot-main not rendered');
  return el;
};

describe('enterClassName', () => {
  it('maps an entry to its class, adding the stagger step when declared', () => {
    expect(enterClassName('rise')).toBe('almadar-enter-rise');
    expect(enterClassName('scale', 3)).toBe('almadar-enter-scale almadar-enter-delay-3');
  });
  it('control: none and an unset entry add no class', () => {
    expect(enterClassName('none')).toBeUndefined();
    expect(enterClassName(undefined)).toBeUndefined();
  });
  it('edge: a stagger step outside 1..8 keeps the entry without a delay', () => {
    expect(enterClassName('fade', 9)).toBe('almadar-enter-fade');
    expect(enterClassName('fade', 0)).toBe('almadar-enter-fade');
  });
});

describe('slot entry — runtime path', () => {
  it('slot content with no declared enter plays the theme default on the slot box', () => {
    const h = harness(<UISlotComponent slot="main" />);
    act(() => { h.manager().render({ target: 'main', pattern: 'typography', props: { content: 'hello' } }); });
    expect(slotBox().className).toContain(ENTER_SLOT_CLASS);
  });

  it('a root node declaring enter animates its own element and the slot plays no default', () => {
    const h = harness(<UISlotComponent slot="main" />);
    act(() => { h.manager().render({ target: 'main', pattern: 'typography', props: { content: 'hello', enter: 'rise', enterDelay: 2 } }); });
    expect(slotBox().className).not.toContain(ENTER_SLOT_CLASS);
    const el = screen.getByText('hello');
    expect(el.className).toContain('almadar-enter-rise');
    expect(el.className).toContain('almadar-enter-delay-2');
    expect(el.getAttribute('enter')).toBeNull();
  });

  it('enter: none on the root opts the slot out entirely', () => {
    const h = harness(<UISlotComponent slot="main" />);
    act(() => { h.manager().render({ target: 'main', pattern: 'typography', props: { content: 'hello', enter: 'none' } }); });
    expect(slotBox().className).not.toContain(ENTER_SLOT_CLASS);
    expect(screen.getByText('hello').className).not.toContain('almadar-enter-');
  });

  it('control: a region mount (fallback) has no box to animate', () => {
    const h = harness(<UISlotComponent slot="main" fallback={<span>stock</span>} />);
    act(() => { h.manager().render({ target: 'main', pattern: 'typography', props: { content: 'hello' } }); });
    expect(slotBox().className).not.toContain(ENTER_SLOT_CLASS);
  });
});

describe('slot entry — compiled path', () => {
  it('compiled children play the theme default on the slot box', () => {
    harness(<UISlotComponent slot="main" pattern="typography" sourceTrait="T"><span>body</span></UISlotComponent>);
    expect(slotBox().className).toContain(ENTER_SLOT_CLASS);
  });
  it('a compiled root that declares enter turns the slot default off', () => {
    harness(<UISlotComponent slot="main" pattern="typography" sourceTrait="T" enter="rise"><span>body</span></UISlotComponent>);
    expect(slotBox().className).not.toContain(ENTER_SLOT_CLASS);
  });
});
