import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('GuestView routes an embedded trait\'s portal paint to its slot', () => {
  const mapPaints = () => [
    { slot: 'main', trait: 'Map', embedded: true, content: { type: 'typography', content: 'map failed' } },
    { slot: 'toast', trait: 'Map', embedded: true, content: { type: 'alert', variant: 'error', message: 'map toast' } },
  ];

  it('keeps the inline paint in the trait frame, shows the toast in its slot, and settles on an identical repaint', async () => {
    const { UISlotContext } = await import('../../../../providers/UISlotContext');
    const notified: string[] = [];
    const Probe = () => {
      const slots = React.useContext(UISlotContext);
      React.useEffect(() => slots?.subscribeTrait('Map', (content) => notified.push(content?.pattern ?? 'null')), [slots]);
      return <span>{`frame:${slots?.getTraitContent('Map')?.pattern ?? 'missing'}`}</span>;
    };
    const view = (paints: ReturnType<typeof mapPaints>) => (
      <EventBusProvider debug={false}>
        <GuestView guest="guest-1" source="Root" deliver="GUEST_CLICK" paints={paints}><Probe /></GuestView>
      </EventBusProvider>
    );
    const { container, rerender } = render(view(mapPaints()));
    rerender(view(mapPaints()));
    expect(container.textContent).toContain('frame:typography');
    expect(container.textContent).toContain('map toast');
    notified.length = 0;
    rerender(view(mapPaints()));
    expect(notified).toEqual([]);
  });

  it('edge: an embedded trait that paints only a toast leaves its frame empty', async () => {
    const { UISlotContext } = await import('../../../../providers/UISlotContext');
    const Probe = () => {
      const slots = React.useContext(UISlotContext);
      return <span>{`frame:${slots?.getTraitContent('Map')?.pattern ?? 'missing'}`}</span>;
    };
    const { container } = wrap(
      <GuestView guest="guest-1" source="Root" deliver="GUEST_CLICK" paints={[mapPaints()[1]]}><Probe /></GuestView>,
    );
    expect(container.textContent).toContain('map toast');
    expect(container.textContent).toContain('frame:missing');
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

describe('GuestView route', () => {
  it('the guest\'s route is the current page path of everything it paints, not the host router\'s', async () => {
    const { useCurrentPagePath } = await import('../../../../providers/CurrentPagePathContext');
    const Probe = () => <span>{`at:${useCurrentPagePath() ?? 'none'}`}</span>;
    render(
      <MemoryRouter initialEntries={['/']}>
        <EventBusProvider debug={false}>
          <GuestView guest="guest-1" source="T" deliver="GUEST_CLICK" route="/people"><Probe /></GuestView>
        </EventBusProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('at:/people')).toBeTruthy();
  });

  it('control: with no route the host\'s current page path stands', async () => {
    const { useCurrentPagePath, CurrentPagePathProvider } = await import('../../../../providers/CurrentPagePathContext');
    const Probe = () => <span>{`at:${useCurrentPagePath() ?? 'none'}`}</span>;
    render(
      <EventBusProvider debug={false}>
        <CurrentPagePathProvider value="/host">
          <GuestView guest="guest-1" source="T" deliver="GUEST_CLICK"><Probe /></GuestView>
        </CurrentPagePathProvider>
      </EventBusProvider>,
    );
    expect(await screen.findByText('at:/host')).toBeTruthy();
  });
});

describe('GuestView scopes each guest paint to its painter', () => {
  const keys: string[] = [];
  const Listen = () => {
    const bus = useEventBus();
    React.useEffect(() => bus.onAny?.((e) => { keys.push(e.type); }), [bus]);
    return null;
  };
  const Click = () => {
    const bus = useEventBus();
    return <button onClick={() => bus.emit('UI:CREATE', {})}>add</button>;
  };

  it('a control in the page-root paint emits under the guest trait that drew it', () => {
    keys.length = 0;
    wrap(
      <>
        <Listen />
        <GuestView guest="guest-1" source="BudgetLayout" deliver="GUEST_CLICK" paints={[{ slot: 'main', trait: 'BudgetLayout', orbital: 'Budgets', embedded: false, content: null }]}>
          <Click />
        </GuestView>
      </>,
    );
    screen.getByText('add').click();
    expect(keys).toContain('UI:Budgets.BudgetLayout.CREATE');
  });

  it('control: a paint whose orbital the guest did not name is not scoped', () => {
    keys.length = 0;
    wrap(
      <>
        <Listen />
        <GuestView guest="guest-1" source="BudgetLayout" deliver="GUEST_CLICK" paints={[{ slot: 'main', trait: 'BudgetLayout', embedded: false, content: null }]}>
          <Click />
        </GuestView>
      </>,
    );
    screen.getByText('add').click();
    expect(keys.some((key) => key.includes('BudgetLayout'))).toBe(false);
  });
});

describe('GuestView clears what the guest stopped painting', () => {
  const dialog = { slot: 'modal' as const, trait: 'Create', embedded: false, content: { type: 'typography', content: 'the form' } };
  const page = { slot: 'main' as const, trait: 'Root', embedded: false, content: { type: 'typography', content: 'page' } };

  it('a modal paint that leaves the paints is cleared from the view', async () => {
    const { container, rerender } = wrap(<GuestView guest="guest-1" source="Root" deliver="GUEST_CLICK" paints={[page, dialog]}><span>root</span></GuestView>);
    expect(container.textContent).toContain('the form');
    rerender(<EventBusProvider debug={false}><GuestView guest="guest-1" source="Root" deliver="GUEST_CLICK" paints={[page]}><span>root</span></GuestView></EventBusProvider>);
    await waitFor(() => expect(container.textContent).not.toContain('the form'));
  });

  it('control: a paint still held stays', () => {
    const { container, rerender } = wrap(<GuestView guest="guest-1" source="Root" deliver="GUEST_CLICK" paints={[page, dialog]}><span>root</span></GuestView>);
    rerender(<EventBusProvider debug={false}><GuestView guest="guest-1" source="Root" deliver="GUEST_CLICK" paints={[page, dialog]}><span>root</span></GuestView></EventBusProvider>);
    expect(container.textContent).toContain('the form');
  });
});
