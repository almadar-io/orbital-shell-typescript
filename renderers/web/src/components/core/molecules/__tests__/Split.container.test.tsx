/**
 * A split stacks by its own width, not the browser viewport: inside a
 * desktop-size demo scaled into a phone page it keeps its two columns, and on a
 * phone page at full width it still stacks (same 768px threshold for `md`: the
 * preset's container sizes match the viewport breakpoints).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Split } from '../Split';

describe('Split stacks by its own width', () => {
  it('the md breakpoint is a container query on the split', () => {
    const html = render(<Split ratio="2:1"><span>a</span><span>b</span></Split>).container.innerHTML;
    expect(html).toContain('@container');
    expect(html).toContain('@md:flex-row');
    expect(html).toContain('@md:w-2/3');
    expect(html).not.toMatch(/(^|\s)md:(flex-row|w-)/);
    expect(html).not.toContain('@3xl:');
  });

  it('control: without stacking the columns stay side by side at any width', () => {
    const html = render(<Split ratio="1:1" stackOnMobile={false}><span>a</span><span>b</span></Split>).container.innerHTML;
    expect(html).toContain('flex-row');
    expect(html).not.toContain('flex-col');
  });
});
