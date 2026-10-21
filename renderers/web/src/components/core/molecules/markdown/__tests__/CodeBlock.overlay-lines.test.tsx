/**
 * The editable CodeBlock paints highlighted text under a transparent textarea.
 * The two must hold the same lines: a textarea ending in a newline shows an empty
 * last line, while a block element drops a trailing newline — so the overlay was
 * one line shorter, and at the bottom of a scrolled file the caret sat one line
 * off the text it edits.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CodeBlock, overlayText } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';

describe('overlayText', () => {
  it('a trailing newline keeps its (empty) last line in the overlay', () => {
    expect(overlayText('a\n')).toBe('a\n ');
    expect(overlayText('a\nb\n\n')).toBe('a\nb\n\n ');
  });

  it('control: text without a trailing newline is painted as is', () => {
    expect(overlayText('a\nb')).toBe('a\nb');
  });

  it('edge: empty text still paints one line', () => {
    expect(overlayText('')).toBe(' ');
  });
});

describe('editable CodeBlock overlay', () => {
  it('paints the same number of lines as the textarea holds', () => {
    const { container } = render(
      <EventBusProvider debug={false}>
        <CodeBlock code={'x\n'} language="text" editable onChange={() => {}} />
      </EventBusProvider>,
    );
    const overlay = container.querySelector('textarea')?.previousElementSibling;
    expect(overlay?.textContent).toBe('x\n ');
  });
});
