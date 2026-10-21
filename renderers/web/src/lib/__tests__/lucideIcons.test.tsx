import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Icon, resolveIcon } from '../../core';
import { resolveIconForFamily } from '../../core';
import { lucideIconKey } from '../../core';

describe('by-name lucide icons load on demand', () => {
  it.each([
    ['shopping-cart', 'lucide-shopping-cart'],
    ['trash-2', 'lucide-trash-2'],
    ['ShoppingCart', 'lucide-shopping-cart'],
    ['bell', 'lucide-bell'],
  ])('%s renders its icon once its module loads', async (name, className) => {
    const { container } = render(<Icon name={name} />);
    await waitFor(() => expect(container.querySelector(`svg.${className}`)).not.toBeNull());
  });

  it('an alias renders the aliased icon', async () => {
    const { container } = render(<Icon name="close" />);
    await waitFor(() => expect(container.querySelector('svg.lucide-x')).not.toBeNull());
  });

  it('control: an unknown name renders the help glyph, never nothing', async () => {
    const { container } = render(<Icon name="no-such-icon-zzz" />);
    await waitFor(() => expect(container.querySelector('svg[class*="lucide-"]')).not.toBeNull());
    expect(container.querySelector('svg.lucide-shopping-cart')).toBeNull();
  });

  it('the sync resolvers still hand back a renderable component for a name', async () => {
    const Resolved = resolveIcon('settings');
    const { container } = render(<Resolved className="w-4" />);
    await waitFor(() => expect(container.querySelector('svg.lucide-settings')).not.toBeNull());
    const Family = resolveIconForFamily('settings', 'lucide');
    const second = render(<Family className="w-4" />);
    await waitFor(() => expect(second.container.querySelector('svg.lucide-settings')).not.toBeNull());
  });

  it('keys: kebab and Pascal names map to the same icon; an unknown name has no key', () => {
    expect(lucideIconKey('shopping-cart')).toBe('shopping-cart');
    expect(lucideIconKey('ShoppingCart')).toBe('shopping-cart');
    expect(lucideIconKey('zzz-not-an-icon')).toBeUndefined();
  });
});
