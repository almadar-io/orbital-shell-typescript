// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { Header } from '../../src/components/core/molecules/Header';

const mount = (el: React.ReactElement) => render(<EventBusProvider debug={false}>{el}</EventBusProvider>).container;
const LOGO = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><circle cx='5' cy='5' r='4'/></svg>";

// A brand logo is shown as itself: not framed like a user avatar, and never swapped for a person icon.
describe('Header brand logo', () => {
  it('logoSrc renders as an unframed image', () => {
    const img = mount(<Header brandName="Almadar" logoSrc={LOGO} />).querySelector('img');
    expect(img?.getAttribute('src')).toBe(LOGO);
    expect(img?.getAttribute('alt')).toBe('Almadar');
    expect(img?.closest('.bg-muted')).toBeNull();
  });

  it('control: a string logo renders the same way', () => {
    const img = mount(<Header brandName="Orb" logo={LOGO} />).querySelector('img');
    expect(img?.getAttribute('src')).toBe(LOGO);
    expect(img?.closest('.bg-muted')).toBeNull();
  });

  it('edge: a logo that fails to load leaves no person icon behind', () => {
    const c = mount(<Header brandName="Almadar" logoSrc="/missing.svg" />);
    const img = c.querySelector('img');
    if (img) fireEvent.error(img);
    expect(c.querySelector('svg.lucide-user')).toBeNull();
  });

  it('edge: no logo renders no image', () => {
    expect(mount(<Header brandName="Almadar" />).querySelector('img')).toBeNull();
  });
});
