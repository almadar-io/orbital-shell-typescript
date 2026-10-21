// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { followHref } from '../../core';
import type { NavStackApi } from '../../core';

const inertStack: NavStackApi = { entries: [], canGoBack: false, beginNavigate: vi.fn(), back: vi.fn(), goTo: vi.fn(), setCurrentLabel: vi.fn(), registerNavItems: vi.fn() };

function focusStart(): void {
  const start = document.getElementById('start');
  if (start instanceof HTMLButtonElement) start.focus();
}

afterEach(() => { document.body.innerHTML = ''; });

function mount(html: string): void {
  document.body.innerHTML = html;
  Element.prototype.scrollIntoView = () => undefined;
}

describe('followHref to an in-page anchor', () => {
  it('moves focus to a focusable target (skip link → main)', () => {
    mount('<button id="start">x</button><main id="main-content" tabindex="-1">c</main>');
    focusStart();
    followHref('#main-content', inertStack);
    expect(document.activeElement?.id).toBe('main-content');
  });

  it('control: an unfocusable target leaves focus where it was', () => {
    mount('<button id="start">x</button><section id="plain">c</section>');
    focusStart();
    followHref('#plain', inertStack);
    expect(document.activeElement?.id).toBe('start');
  });

  it('edge: a missing target is a no-op', () => {
    mount('<button id="start">x</button>');
    focusStart();
    expect(() => followHref('#nowhere', inertStack)).not.toThrow();
    expect(document.activeElement?.id).toBe('start');
  });
});
