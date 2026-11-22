/**
 * The brand (logo + name) links home when `brandHref` is set: a real link that
 * follows the nav stack like every other header link.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Header } from '../Header';
import { NavStackProvider } from '../../../../core';

function mount(props: Partial<React.ComponentProps<typeof Header>>, navigate = vi.fn()) {
  render(
    <MemoryRouter>
      <NavStackProvider pages={[]} currentPath="/docs" navigate={navigate}>
        <Header variant="desktop" brandName="Orb" logoSrc="/img/orb.svg" {...props} />
      </NavStackProvider>
    </MemoryRouter>,
  );
  return navigate;
}

describe('Header brand link', () => {
  it('brandHref renders the brand as a link that navigates through the nav stack', () => {
    const navigate = mount({ brandHref: '/ar' });
    const link = screen.getByRole('link', { name: /orb/i });
    expect(link.getAttribute('href')).toBe('/ar');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/ar');
  });

  it('the mobile variant links the brand too', () => {
    const navigate = mount({ brandHref: '/', variant: 'mobile' });
    fireEvent.click(screen.getByRole('link', { name: /orb/i }));
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('control: without brandHref the brand is not a link', () => {
    mount({});
    expect(screen.queryByRole('link', { name: /orb/i })).toBeNull();
    expect(screen.getByText('Orb')).toBeTruthy();
  });

  it('control: onLogoClick without brandHref still fires and does not navigate', () => {
    const onLogoClick = vi.fn();
    const navigate = mount({ onLogoClick });
    fireEvent.click(screen.getByRole('button', { name: /orb/i }));
    expect(onLogoClick).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('Header brand logo', () => {
  it('a logo beside the brand name is decorative: the name names the link once', () => {
    mount({ brandHref: '/' });
    const link = screen.getByRole('link', { name: 'Orb' });
    expect(link.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('control: the brand name is still shown beside the logo', () => {
    mount({ brandHref: '/' });
    expect(screen.getByRole('link', { name: 'Orb' }).textContent).toContain('Orb');
  });
});

describe('Header brand name', () => {
  it('the brand name is text, not a heading: the page owns its headings, from h1', () => {
    mount({ brandHref: '/' });
    expect(screen.queryByRole('heading', { name: 'Orb' })).toBeNull();
  });

  it('control: the brand name is still shown', () => {
    mount({ brandHref: '/' });
    expect(screen.getByText('Orb')).toBeTruthy();
  });
});
