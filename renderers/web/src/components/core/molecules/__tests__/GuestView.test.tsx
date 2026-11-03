import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuestView } from '../GuestView';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('GuestView', () => {
  it('paints its children', () => {
    wrap(<GuestView guest="guest-1" source="Counter" deliver="GUEST_CLICK"><span>painted</span></GuestView>);
    expect(screen.getByText('painted')).toBeTruthy();
  });

  it('control: guest, source and deliver are not rendered as text or attributes', () => {
    const { container } = wrap(<GuestView guest="guest-77" source="TraitSrc" deliver="GUEST_CLICK"><span>x</span></GuestView>);
    const html = container.innerHTML;
    for (const v of ['guest-77', 'TraitSrc', 'GUEST_CLICK']) expect(html).not.toContain(v);
  });
});
