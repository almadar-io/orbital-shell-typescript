import React from 'react';
import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { EventBusProvider } from '../../core';
import { TraitScopeProvider } from '../../core';
import { NavStackRouterBridge, useNavStack } from '../../core';
import { useEventBus } from '../../core';

function Go({ url }: { url: string }) {
  const navStack = useNavStack();
  return <button type="button" onClick={() => navStack.goTo(url)}>go</button>;
}

function Emit({ type }: { type: string }) {
  const bus = useEventBus();
  return <button type="button" onClick={() => bus.emit(type)}>emit</button>;
}

function Listen({ type, onEvent }: { type: string; onEvent: () => void }) {
  const bus = useEventBus();
  React.useEffect(() => bus.on(type, onEvent), [bus, type, onEvent]);
  return null;
}

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

describe('navigation from inside a trait scope', () => {
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

  it('moves the compiled-path router through the nav stack NavStackRouterBridge provides', () => {
    render(
      <EventBusProvider isolated>
        <MemoryRouter initialEntries={['/']}>
          <NavStackRouterBridge pages={[{ path: '/', name: 'Home', orbital: 'Learn' }, { path: '/start', name: 'Start', orbital: 'Learn' }]}>
            <Where />
            <TraitScopeProvider orbital="Learn" trait="Body">
              <Go url="/start" />
            </TraitScopeProvider>
          </NavStackRouterBridge>
        </MemoryRouter>
      </EventBusProvider>,
    );
    expect(screen.getByTestId('where').textContent).toBe('/');
    act(() => { fireEvent.click(screen.getByText('go')); });
    expect(screen.getByTestId('where').textContent).toBe('/start');
  });

  it('control: outside a nav stack provider a navigation does nothing', () => {
    render(
      <EventBusProvider isolated>
        <Go url="/start" />
      </EventBusProvider>,
    );
    act(() => { fireEvent.click(screen.getByText('go')); });
    expect(screen.getByText('go')).toBeTruthy();
  });
});
