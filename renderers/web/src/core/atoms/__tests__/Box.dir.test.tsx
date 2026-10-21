import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Box } from '../../index';

describe('Box dir', () => {
  it('sets the text direction on its root', () => {
    const { container } = render(<Box dir="rtl">نص</Box>);
    expect((container.firstChild as HTMLElement).getAttribute('dir')).toBe('rtl');
  });

  it('control: no dir attribute unless given', () => {
    const { container } = render(<Box>text</Box>);
    expect((container.firstChild as HTMLElement).hasAttribute('dir')).toBe(false);
  });
});
