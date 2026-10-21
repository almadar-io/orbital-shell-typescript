/**
 * G-UI-018: every icon renders through Lucide (a stroke family). A theme
 * naming a fill family (`kiosk`: fa-solid, `terminal`: phosphor-fill) sets that
 * family's `--icon-stroke-width: 0`, which must not reach a Lucide glyph —
 * the token applies only when the theme's family is the one rendering.
 */
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Icon } from '../../index';

function themed(family: string | null, stroke: string | null): void {
  const root = document.documentElement.style;
  if (family === null) root.removeProperty('--icon-family'); else root.setProperty('--icon-family', family);
  if (stroke === null) root.removeProperty('--icon-stroke-width'); else root.setProperty('--icon-stroke-width', stroke);
}

function strokeStyleOf(container: HTMLElement): string {
  return container.querySelector('svg')?.style.strokeWidth ?? '';
}

afterEach(() => {
  themed(null, null);
  vi.restoreAllMocks();
});

describe('Icon stroke under a theme icon family', () => {
  it.each(['fa-solid', 'phosphor-fill'])('a %s theme does not zero the Lucide stroke', async (family) => {
    themed(family, '0');
    await new Promise((r) => setTimeout(r, 0));
    const { container } = render(<Icon name="flame" />);
    await waitFor(() => expect(strokeStyleOf(container)).not.toContain('--icon-stroke-width'));
  });

  it('control: a lucide theme still drives the stroke token', async () => {
    themed('lucide', '1.5');
    await new Promise((r) => setTimeout(r, 0));
    const { container } = render(<Icon name="flame" />);
    await waitFor(() => expect(strokeStyleOf(container)).toContain('--icon-stroke-width'));
  });

  it('edge: no theme family set keeps the token (the default family renders)', async () => {
    await new Promise((r) => setTimeout(r, 0));
    const { container } = render(<Icon name="flame" />);
    await waitFor(() => expect(strokeStyleOf(container)).toContain('--icon-stroke-width'));
  });

  it('G-UI-033: a fill-family theme scoped to a subtree does not zero the stroke under a lucide <html>', async () => {
    themed('lucide', '1.5');
    const { container } = render(
      <div data-theme="kiosk-light" style={{ ['--icon-family' as string]: 'fa-solid', ['--icon-stroke-width' as string]: '0' }}>
        <Icon name="flame" />
      </div>,
    );
    await waitFor(() => expect(strokeStyleOf(container)).not.toContain('--icon-stroke-width'));
  });

  it('G-UI-033 control: a lucide theme scoped under a fill-family <html> drives the stroke', async () => {
    themed('fa-solid', '0');
    const { container } = render(
      <div data-theme="linear-clean-light" style={{ ['--icon-family' as string]: 'lucide', ['--icon-stroke-width' as string]: '1.5' }}>
        <Icon name="flame" />
      </div>,
    );
    await waitFor(() => expect(strokeStyleOf(container)).toContain('--icon-stroke-width'));
  });

  it('G-UI-033 edge: switching the scoped theme re-evaluates the stroke', async () => {
    themed('lucide', '1.5');
    const { container } = render(
      <div data-theme="linear-clean-light" style={{ ['--icon-family' as string]: 'lucide' }}>
        <Icon name="flame" />
      </div>,
    );
    await waitFor(() => expect(strokeStyleOf(container)).toContain('--icon-stroke-width'));
    const scope = container.firstElementChild as HTMLElement;
    scope.style.setProperty('--icon-family', 'fa-solid');
    scope.setAttribute('data-theme', 'kiosk-light');
    await waitFor(() => expect(strokeStyleOf(container)).not.toContain('--icon-stroke-width'));
  });

  it('edge: an explicit strokeWidth prop always wins', () => {
    themed('fa-solid', '0');
    const { container } = render(<Icon name="flame" strokeWidth={3} />);
    expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe('3');
  });

  it('an icon outside any scoped theme reads no ancestor style: the document value applies', async () => {
    themed('lucide', '1.5');
    const spy = vi.spyOn(window, 'getComputedStyle');
    const { container } = render(<div><div><div><section><Icon name="flame" /></section></div></div></div>);
    await waitFor(() => expect(strokeStyleOf(container)).toContain('--icon-stroke-width'));
    const ancestors = new Set<Element>(Array.from(container.querySelectorAll('div, section')));
    expect(spy.mock.calls.filter(([el]) => ancestors.has(el))).toHaveLength(0);
  });

  it('control: an icon in a scoped theme reads that scope once, not every ancestor', async () => {
    themed('lucide', '1.5');
    const spy = vi.spyOn(window, 'getComputedStyle');
    const { container } = render(
      <div data-theme="kiosk-light" style={{ ['--icon-family' as string]: 'fa-solid' }}>
        <div><div><Icon name="flame" /></div></div>
      </div>,
    );
    await waitFor(() => expect(strokeStyleOf(container)).not.toContain('--icon-stroke-width'));
    const scope = container.firstElementChild;
    const inner = new Set<Element>(Array.from(scope?.querySelectorAll('div') ?? []));
    expect(spy.mock.calls.filter(([el]) => el === scope).length).toBeGreaterThan(0);
    expect(spy.mock.calls.filter(([el]) => inner.has(el))).toHaveLength(0);
  });

  it('many icons in one scoped theme read that scope once, not once per icon', async () => {
    themed('lucide', '1.5');
    const spy = vi.spyOn(window, 'getComputedStyle');
    const { container } = render(
      <div data-theme="kiosk-light" style={{ ['--icon-family' as string]: 'fa-solid' }}>
        {Array.from({ length: 8 }, (_, i) => <Icon key={i} name="flame" />)}
      </div>,
    );
    await waitFor(() => expect(strokeStyleOf(container)).not.toContain('--icon-stroke-width'));
    expect(spy.mock.calls.filter(([el]) => el === container.firstElementChild)).toHaveLength(1);
  });
});
