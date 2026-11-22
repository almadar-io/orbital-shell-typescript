/**
 * A stat's number is a value, not a section title: it keeps its size but adds no heading to the page it sits on.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatDisplay } from '../StatDisplay';
import { EventBusProvider } from '../../../../core';

const draw = (props: Partial<React.ComponentProps<typeof StatDisplay>> = {}) =>
  render(
    <EventBusProvider debug={false}>
      <StatDisplay label="Open orders" value={42} {...props} />
    </EventBusProvider>,
  );

describe('StatDisplay document outline', () => {
  it('the card value adds no heading', () => {
    const { container } = draw();
    expect(container.querySelectorAll('h1, h2, h3, h4, h5, h6').length).toBe(0);
  });

  it('the compact value adds no heading', () => {
    const { container } = draw({ compact: true });
    expect(container.querySelectorAll('h1, h2, h3, h4, h5, h6').length).toBe(0);
  });

  it('control: the value and label still render', () => {
    draw();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Open orders')).toBeTruthy();
  });
});
