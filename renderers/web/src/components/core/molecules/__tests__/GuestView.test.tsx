import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { GuestView } from '../GuestView';
import { EventBusProvider, useEventBus } from '../../../../core';

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

describe('GuestView embedded paints', () => {
  it('seeds a scoped slot manager with the guest paints', async () => {
    const { UISlotContext } = await import('../../../../providers/UISlotContext');
    const Probe = () => {
      const slots = React.useContext(UISlotContext);
      const [seen, setSeen] = React.useState('none');
      React.useEffect(() => setSeen(slots?.getTraitContent('Child')?.pattern ?? 'missing'), [slots]);
      return <span>{`seen:${seen}`}</span>;
    };
    wrap(
      <GuestView
        guest="guest-1"
        source="Root"
        deliver="GUEST_CLICK"
        paints={[{ slot: 'main', trait: 'Child', embedded: true, content: { type: 'typography', content: 'child' } }]}
      >
        <Probe />
      </GuestView>,
    );
    expect(screen.getByText('seen:typography')).toBeTruthy();
  });
});

describe('GuestView keeps the guest inside its frame', () => {
  it('renders a slot the guest paints besides main inside the view, never the host portal root', () => {
    const { container } = wrap(
      <GuestView guest="guest-1" source="Root" deliver="GUEST_CLICK" paints={[{ slot: 'modal', trait: 'Dialog', embedded: false, content: { type: 'typography', content: 'guest dialog' } }]}>
        <span>page</span>
      </GuestView>,
    );
    expect(container.textContent).toContain('guest dialog');
    expect(document.getElementById('ui-slot-portal-root')?.textContent ?? '').not.toContain('guest dialog');
  });

  it('control: the main paint shows once, from children', () => {
    const { container } = wrap(
      <GuestView guest="guest-1" source="Root" deliver="GUEST_CLICK" paints={[{ slot: 'main', trait: 'Root', embedded: false, content: { type: 'typography', content: 'root paint' } }]}>
        <span>page</span>
      </GuestView>,
    );
    expect(screen.getAllByText('page')).toHaveLength(1);
    expect(container.textContent).not.toContain('root paint');
  });
});

describe('GuestView navigation', () => {
  const seen: Array<{ type: string; payload: unknown }> = [];
  const Listen = () => {
    const bus = useEventBus();
    React.useEffect(() => bus.onAny?.((e) => { seen.push({ type: e.type, payload: e.payload }); }), [bus]);
    return null;
  };
  const renderLinks = (navigate?: string) => {
    seen.length = 0;
    return wrap(
      <MemoryRouter initialEntries={['/catalog']}>
        <Listen />
        <GuestView guest="guest-9" source="Root" deliver="GUEST_CLICK" navigate={navigate}>
          <a href="/pages">pages</a>
          <a href="https://example.com/x">external</a>
        </GuestView>
      </MemoryRouter>,
    );
  };

  it('an in-app link inside the guest emits navigate with the guest and route', () => {
    renderLinks('GUEST_ROUTE');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByText('pages').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(seen.filter((e) => e.type === 'UI:GUEST_ROUTE').map((e) => e.payload)).toEqual([{ guest: 'guest-9', route: '/pages' }]);
  });

  it('control: an external link emits no navigate and opens a new tab instead of the host page', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderLinks('GUEST_ROUTE');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByText('external').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
    expect(seen.some((e) => e.type === 'UI:GUEST_ROUTE')).toBe(false);
    open.mockRestore();
  });

  it('edge: without a navigate event an in-app link still never navigates the host', () => {
    renderLinks(undefined);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByText('pages').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(seen.some((e) => e.type.startsWith('UI:GUEST'))).toBe(false);
  });
});
