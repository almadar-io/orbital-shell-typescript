/**
 * Components mark the element that shows a text prop (`data-inline-text`),
 * so the canvas and the live preview can edit that text in place.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Typography } from '../../src/core';
import { Button } from '../../src/core';
import { Badge } from '../../src/core';
import { INLINE_TEXT_ATTR } from '../../src/core';

const marked = (container: HTMLElement) => container.querySelector(`[${INLINE_TEXT_ATTR}]`);

describe('inline text markers', () => {
  it('Typography marks its content text', () => {
    const { container } = render(<Typography content="Hello" />);
    expect(marked(container)?.getAttribute(INLINE_TEXT_ATTR)).toBe('content');
    expect(marked(container)?.textContent).toBe('Hello');
  });

  it('Typography with children is not editable text', () => {
    const { container } = render(<Typography><span>child</span></Typography>);
    expect(marked(container)).toBeNull();
  });

  it('Button marks its label, and only the label', () => {
    const { container } = render(<Button label="Save" leftIcon="check" />);
    expect(marked(container)?.getAttribute(INLINE_TEXT_ATTR)).toBe('label');
    expect(marked(container)?.textContent).toBe('Save');
  });

  it('Badge marks its label', () => {
    const { container } = render(<Badge label="New" />);
    expect(marked(container)?.getAttribute(INLINE_TEXT_ATTR)).toBe('label');
    expect(marked(container)?.textContent).toBe('New');
  });
});
