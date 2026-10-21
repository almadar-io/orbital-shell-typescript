/**
 * A Button with an `href` is a link: an in-app path goes through the nav
 * stack, an in-page `#anchor` scrolls, an absolute URL loads. Composed CTAs
 * (std-hero, std-cta-banner, …) rely on this instead of raw anchors.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '../../index';
import { NavStackProvider } from '../../index';
import { EventBusProvider } from '../../index';
import { useEventBus } from '../../index';

function mount(ui: React.ReactElement, navigate = vi.fn()) {
  render(
    <EventBusProvider debug={false}>
      <NavStackProvider pages={[]} currentPath="/" navigate={navigate}>
        {ui}
      </NavStackProvider>
    </EventBusProvider>,
  );
  return navigate;
}

describe('Button with href', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a link carrying the href', () => {
    mount(<Button label="Pricing" href="/pricing" />);
    const link = screen.getByRole('link', { name: /pricing/i });
    expect(link.getAttribute('href')).toBe('/pricing');
  });

  it('an in-app path navigates through the nav stack', () => {
    const navigate = mount(<Button label="Pricing" href="/pricing" />);
    fireEvent.click(screen.getByRole('link', { name: /pricing/i }));
    expect(navigate).toHaveBeenCalledWith('/pricing');
  });

  it('an in-page #anchor scrolls to its target without navigating', () => {
    const target = document.createElement('section');
    target.id = 'features';
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    document.body.appendChild(target);
    const navigate = mount(<Button label="Features" href="#features" />);
    fireEvent.click(screen.getByRole('link', { name: /features/i }));
    expect(scroll).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    target.remove();
  });

  it('an absolute URL loads the page instead of navigating in-app', () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign });
    const navigate = mount(<Button label="Studio" href="https://studio.almadar.io" />);
    fireEvent.click(screen.getByRole('link', { name: /studio/i }));
    expect(assign).toHaveBeenCalledWith('https://studio.almadar.io');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a modified click (new tab) is left to the browser', () => {
    const navigate = mount(<Button label="Pricing" href="/pricing" />);
    fireEvent.click(screen.getByRole('link', { name: /pricing/i }), { metaKey: true });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still emits its action alongside following the href', () => {
    const seen = vi.fn();
    const Listener: React.FC = () => {
      const bus = useEventBus();
      React.useEffect(() => bus.on('UI:CTA_CLICK', (e) => seen(e.payload)), [bus]);
      return null;
    };
    const navigate = mount(
      <>
        <Listener />
        <Button label="Start" href="/start" action="CTA_CLICK" actionPayload={{ href: '/start' }} />
      </>,
    );
    fireEvent.click(screen.getByRole('link', { name: /start/i }));
    expect(seen).toHaveBeenCalledWith({ href: '/start' });
    expect(navigate).toHaveBeenCalledWith('/start');
  });

  it('control: without href it stays a button', () => {
    mount(<Button label="Save" />);
    expect(screen.getByRole('button', { name: /save/i })).toBeInstanceOf(HTMLElement);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Button link variant', () => {
  it('renders as plain text-link styling (no button chrome)', () => {
    mount(<Button label="Docs" href="/docs" variant="link" />);
    const link = screen.getByRole('link', { name: /docs/i });
    expect(link.className).toContain('underline-offset-4');
    expect(link.className).not.toContain('bg-primary');
    expect(link.className).not.toContain('h-button-md');
    expect(link.className).not.toContain('chrome-button');
  });
});

describe('Button href outside an app nav stack (plain React / SSR sites)', () => {
  it('leaves an in-app path to the browser instead of swallowing the click', () => {
    render(<Button label="Pricing" href="/pricing" />);
    const link = screen.getByRole('link', { name: /pricing/i });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(true);
  });

  it('control: inside a nav stack the same click is handled in-app', () => {
    const navigate = mount(<Button label="Pricing" href="/pricing" />);
    const link = screen.getByRole('link', { name: /pricing/i });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/pricing');
  });
});

describe('Button link with an onClick', () => {
  it('runs its onClick on activation and still follows the href', () => {
    const onClick = vi.fn();
    const navigate = mount(<Button label="Docs" href="/docs" onClick={onClick} />);
    fireEvent.click(screen.getByRole('link', { name: /docs/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/docs');
  });

  it('an onClick that prevents the default keeps the viewer where they are', () => {
    const navigate = mount(<Button label="Docs" href="/docs" onClick={(e) => e.preventDefault()} />);
    fireEvent.click(screen.getByRole('link', { name: /docs/i }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('edge: a modified click runs onClick and leaves opening to the browser', () => {
    const onClick = vi.fn();
    const navigate = mount(<Button label="Docs" href="/docs" onClick={onClick} />);
    fireEvent.click(screen.getByRole('link', { name: /docs/i }), { ctrlKey: true });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('control: a disabled link runs neither its onClick nor the navigation', () => {
    const onClick = vi.fn();
    const navigate = mount(<Button label="Docs" href="/docs" onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('link', { name: /docs/i }));
    expect(onClick).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
