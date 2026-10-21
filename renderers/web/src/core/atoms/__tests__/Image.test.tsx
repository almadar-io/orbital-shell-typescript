import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Image } from '../../index';

describe('Image', () => {
  it('renders the source with its alt text, lazily loaded', () => {
    render(<Image src="/img/home.png" alt="Home screen" />);
    const img = screen.getByRole('img', { name: 'Home screen' });
    expect(img.getAttribute('src')).toBe('/img/home.png');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('applies fit, aspect ratio and rounding', () => {
    render(<Image src="/a.png" alt="A" fit="contain" aspect="16/9" rounded="lg" />);
    const img = screen.getByRole('img', { name: 'A' });
    expect(img.className).toContain('object-contain');
    expect(img.className).toContain('aspect-video');
    expect(img.className).toContain('rounded-lg');
  });

  it('eager loading when asked (above-the-fold hero)', () => {
    render(<Image src="/hero.png" alt="Hero" loading="eager" />);
    expect(screen.getByRole('img', { name: 'Hero' }).getAttribute('loading')).toBe('eager');
  });

  it('renders nothing without a source', () => {
    const { container } = render(<Image src="" alt="Empty" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('decorative image (empty alt) is hidden from assistive tech', () => {
    const { container } = render(<Image src="/deco.svg" alt="" />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('role')).toBe('presentation');
  });
  it('marks the priority image eager and high priority', () => {
    const { container } = render(<Image src="/a.png" alt="" priority />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('fetchpriority')).toBe('high');
  });

  it('passes srcSet and sizes and positions the crop', () => {
    const { container } = render(<Image src="/a.png" alt="" srcSet="/a-640.png 640w, /a-1600.png 1600w" sizes="100vw" position="top" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('srcset')).toContain('640w');
    expect(img.getAttribute('sizes')).toBe('100vw');
    expect(img.className).toContain('object-top');
  });
});
