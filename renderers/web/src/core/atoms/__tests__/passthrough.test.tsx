import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBusProvider } from '../../index';
import { HStack, VStack } from '../../index';
import { Typography } from '../../index';
import { Box } from '../../index';
import { Button } from '../../index';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('primitives forward accessibility and data attributes', () => {
  it('HStack forwards as, role, aria-*, id and data-*', () => {
    wrap(<HStack as="nav" aria-label="Pages" id="pager" data-testid="pager" aria-describedby="hint">x</HStack>);
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(nav.id).toBe('pager');
    expect(nav.getAttribute('data-testid')).toBe('pager');
    expect(nav.getAttribute('aria-describedby')).toBe('hint');
  });

  it('VStack forwards role and aria-live', () => {
    wrap(<VStack role="status" aria-live="polite">Saved</VStack>);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('Typography forwards role, aria-hidden and data-*', () => {
    wrap(<><Typography role="alert">Error</Typography><Typography aria-hidden="true" data-x="1">…</Typography></>);
    expect(screen.getByRole('alert').textContent).toBe('Error');
    const deco = screen.getByText('…');
    expect(deco.getAttribute('aria-hidden')).toBe('true');
    expect(deco.getAttribute('data-x')).toBe('1');
  });

  it('Stack and Typography forward lang, dir and tabIndex (A11yProps global attributes)', () => {
    wrap(<><VStack role="region" aria-label="Quote" lang="ar" dir="rtl" tabIndex={-1}>نص</VStack><Typography lang="sl" dir="ltr">besedilo</Typography></>);
    const region = screen.getByRole('region', { name: 'Quote' });
    expect(region.getAttribute('lang')).toBe('ar');
    expect(region.getAttribute('dir')).toBe('rtl');
    expect(region.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText('besedilo').getAttribute('lang')).toBe('sl');
  });

  it('Box and Button forward aria-current and aria-pressed', () => {
    wrap(<><Box as="nav" aria-label="Main" aria-current="page">x</Box><Button aria-pressed={true}>Bold</Button></>);
    expect(screen.getByRole('navigation', { name: 'Main' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('control: layout classes still apply alongside forwarded attributes', () => {
    wrap(<HStack gap="sm" aria-label="Row" role="group">x</HStack>);
    expect(screen.getByRole('group', { name: 'Row' }).className).toContain('gap-2');
  });
});

describe('primitives keep non-DOM schema props off the element', () => {
  it('control: an unknown prop spread by the renderer is not forwarded', () => {
    const props: Record<string, string> = { event: 'SAVE', label: 'x', 'aria-label': 'Named' };
    wrap(<HStack role="group" {...props}>x</HStack>);
    const el = screen.getByRole('group', { name: 'Named' });
    expect(el.hasAttribute('event')).toBe(false);
    expect(el.hasAttribute('label')).toBe(false);
  });
});
