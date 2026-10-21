/**
 * A theme that declares `illustration.loadingAsset` gets its own loader: the
 * Spinner paints `--illustration-loading` and hides the generic icon, through
 * the display switches the theme emits. Without them it keeps the icon.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Spinner } from '../../index';
import { I18nProvider, createTranslate } from '../../index';

const t = createTranslate({ 'aria.loading': 'Loading' });
const wrap = (ui: React.ReactElement) =>
  render(<I18nProvider value={{ locale: 'en', direction: 'ltr', t }}>{ui}</I18nProvider>);

describe('Spinner theme loader mark', () => {
  it.each([[false], [true]])('paints the theme artwork, hidden unless the theme switches it on (overlay=%s)', (overlay) => {
    const { container } = wrap(<Spinner overlay={overlay} size="lg" />);
    const mark = container.querySelector<HTMLElement>('[data-loader-mark]');
    expect(mark).not.toBeNull();
    expect(mark?.style.backgroundImage).toBe('var(--illustration-loading)');
    expect(mark?.style.display).toBe('var(--loader-mark-display, none)');
  });

  it('control: the generic icon stays visible unless the theme hides it', () => {
    const { container } = wrap(<Spinner />);
    const icon = container.querySelector<HTMLElement>('[data-loader-icon]');
    expect(icon?.style.display).toBe('var(--loader-icon-display, inline-flex)');
  });
});
