import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button, EventBusProvider } from '../../index';

describe('G-ORBITAL-SHELL-TYPESCRIPT-086 wrapped button labels', () => {
  it('grows to fit a wrapped label instead of holding a fixed height', () => {
    render(<EventBusProvider debug={false}><Button label="Add a Book a demo button" size="sm" /></EventBusProvider>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('min-h-button-sm');
    expect(cls).not.toMatch(/(^|\s)h-button-sm/);
  });
});
