// @vitest-environment jsdom
/**
 * The `dock` slot: a right panel that pushes the page. Desktop (≥1024px): an
 * inline-feeling fixed panel (a `complementary` landmark) that sets
 * `--almadar-dock-inset` so the page shrinks beside it. Compact (<1024px): the
 * same content in the right `Drawer`. Runtime content and compiled children
 * behave alike; the content brings its own close control.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { UISlotProvider, useUISlots } from '../../src/providers/UISlotContext';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { UISlotComponent, UISlotRenderer } from '../../src/components/core/organisms/UISlotRenderer';
import { useEventBus } from '../../src/core';

function stubCompact(compact: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: compact && query.includes('max-width: 1023.98px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function ManagerGrabber({ onReady }: { onReady: (manager: UISlotManager) => void }): null {
  onReady(useUISlots());
  return null;
}

function BusSpy({ seen }: { seen: string[] }): null {
  const bus = useEventBus();
  React.useEffect(() => bus.onAny?.((event) => { seen.push(event.type); }), [bus]);
  return null;
}

function harness(children: React.ReactNode) {
  let manager!: UISlotManager;
  const seen: string[] = [];
  const utils = render(
    <EventBusProvider isolated>
      <UISlotProvider>
        <ManagerGrabber onReady={(m) => { manager = m; }} />
        <BusSpy seen={seen} />
        {children}
      </UISlotProvider>
    </EventBusProvider>,
  );
  return { ...utils, manager: () => manager, seen };
}

const inset = () => document.documentElement.style.getPropertyValue('--almadar-dock-inset');

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--almadar-dock-inset');
});

describe('dock slot — desktop', () => {
  it('runtime content renders as a complementary panel and pushes the page', () => {
    stubCompact(false);
    const h = harness(<UISlotRenderer />);
    act(() => h.manager().render({ target: 'dock', pattern: 'typography', props: { content: 'assistant body' } }));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.getByText('assistant body')).toBeInTheDocument();
    expect(document.getElementById('slot-dock')).not.toBeNull();
    expect(inset()).toBe('384px');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clearing the slot removes the panel and the push', () => {
    stubCompact(false);
    const h = harness(<UISlotRenderer />);
    act(() => h.manager().render({ target: 'dock', pattern: 'typography', props: { content: 'assistant body' } }));
    act(() => h.manager().clear('dock'));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(inset()).toBe('');
  });

  it('compiled children dock the same way', () => {
    stubCompact(false);
    harness(<UISlotComponent slot="dock" pattern="stack" sourceTrait="AssistantDock">compiled body</UISlotComponent>);
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.getByText('compiled body')).toBeInTheDocument();
    expect(inset()).toBe('384px');
  });

  it('brings no close control of its own — the content declares one', () => {
    stubCompact(false);
    const h = harness(<UISlotRenderer />);
    act(() => h.manager().render({ target: 'dock', pattern: 'typography', props: { content: 'assistant body' } }));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('control: an empty dock renders nothing and pushes nothing', () => {
    stubCompact(false);
    harness(<UISlotRenderer />);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(inset()).toBe('');
  });
});

describe('dock slot — compact', () => {
  it('below 1024px the content opens in the right drawer and the page is not pushed', () => {
    stubCompact(true);
    const h = harness(<UISlotRenderer />);
    act(() => h.manager().render({ target: 'dock', pattern: 'typography', props: { content: 'assistant body' } }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('assistant body')).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(inset()).toBe('');
  });

  it('the content gets the sheet\'s full height, so a full-height panel scrolls inside itself instead of scrolling the sheet', () => {
    stubCompact(true);
    const h = harness(<UISlotRenderer />);
    act(() => h.manager().render({ target: 'dock', pattern: 'typography', props: { content: 'assistant body' } }));
    const fill = screen.getByTestId('dock-sheet-fill');
    expect(screen.getByRole('dialog').contains(fill)).toBe(true);
    expect(fill.className).toMatch(/\bh-full\b/);
    expect(fill.className).toMatch(/\bflex-col\b/);
    expect(fill.contains(screen.getByText('assistant body'))).toBe(true);
  });

  it('Escape on the sheet asks the owning trait to CLOSE', () => {
    stubCompact(true);
    const h = harness(<UISlotRenderer />);
    act(() => h.manager().render({ target: 'dock', pattern: 'typography', props: { content: 'assistant body' } }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(h.seen).toContain('UI:CLOSE');
  });
});

describe('dock slot — contained (preview) renderer', () => {
  const containedInset = () => (document.querySelector('.ui-slot-renderer') as HTMLElement | null)?.style.getPropertyValue('--almadar-dock-contained-inset') ?? '';

  it('pushes the preview it lives in, as a panel, not a modal', () => {
    stubCompact(false);
    const h = harness(<UISlotRenderer hudMode="inline" />);
    act(() => h.manager().render({ target: 'dock', pattern: 'typography', props: { content: 'assistant body' } }));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(containedInset()).toBe('384px');
    expect(inset()).toBe('');
  });

  it('clearing it restores the preview width', () => {
    stubCompact(false);
    const h = harness(<UISlotRenderer hudMode="inline" />);
    act(() => h.manager().render({ target: 'dock', pattern: 'typography', props: { content: 'assistant body' } }));
    act(() => h.manager().clear('dock'));
    expect(containedInset()).toBe('');
  });
});

describe('floating slot', () => {
  it('is mounted on every page, not only where includeFloating is set', () => {
    stubCompact(false);
    const h = harness(<UISlotRenderer />);
    act(() => h.manager().render({ target: 'floating', pattern: 'typography', props: { content: 'fab here' } }));
    expect(screen.getByText('fab here')).toBeInTheDocument();
  });
});
