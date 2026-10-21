import React from 'react';
import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { EventBusProvider } from '../../core';
import { TraitScopeProvider } from '../../core';
import { NavStackRouterBridge } from '../../core';
import { useEventBus } from '../../core';

function Emit({ type, payload }: { type: string; payload?: { url: string } }) {
  const bus = useEventBus();
  return <button type="button" onClick={() => bus.emit(type, payload)}>emit</button>;
}

function Listen({ type, onEvent }: { type: string; onEvent: () => void }) {
  const bus = useEventBus();
  React.useEffect(() => bus.on(type, onEvent), [bus, type, onEvent]);
  return null;
}

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

describe('UI:NAVIGATE from inside a trait scope', () => {
  it('reaches the host listener on the bare key', () => {
    const heard: string[] = [];
    render(
      <EventBusProvider isolated>
        <Listen type="UI:NAVIGATE" onEvent={() => heard.push('bare')} />
        <TraitScopeProvider orbital="Learn" trait="Body">
          <Emit type="UI:NAVIGATE" payload={{ url: '/start' }} />
        </TraitScopeProvider>
      </EventBusProvider>,
    );
    act(() => { fireEvent.click(screen.getByText('emit')); });
    expect(heard).toEqual(['bare']);
  });

  it('control: a trait event is still qualified to its trait', () => {
    const heard: string[] = [];
    render(
      <EventBusProvider isolated>
        <Listen type="UI:CREATE" onEvent={() => heard.push('bare')} />
        <Listen type="UI:Learn.Body.CREATE" onEvent={() => heard.push('qualified')} />
        <TraitScopeProvider orbital="Learn" trait="Body">
          <Emit type="UI:CREATE" />
        </TraitScopeProvider>
      </EventBusProvider>,
    );
    act(() => { fireEvent.click(screen.getByText('emit')); });
    expect(heard).toEqual(['qualified']);
  });

  it('moves the compiled-path router through NavStackRouterBridge', () => {
    render(
      <EventBusProvider isolated>
        <MemoryRouter initialEntries={['/']}>
          <NavStackRouterBridge pages={[{ path: '/', name: 'Home', orbital: 'Learn' }, { path: '/start', name: 'Start', orbital: 'Learn' }]}>
            <Where />
            <TraitScopeProvider orbital="Learn" trait="Body">
              <Emit type="UI:NAVIGATE" payload={{ url: '/start' }} />
            </TraitScopeProvider>
          </NavStackRouterBridge>
        </MemoryRouter>
      </EventBusProvider>,
    );
    expect(screen.getByTestId('where').textContent).toBe('/');
    act(() => { fireEvent.click(screen.getByText('emit')); });
    expect(screen.getByTestId('where').textContent).toBe('/start');
  });
});
