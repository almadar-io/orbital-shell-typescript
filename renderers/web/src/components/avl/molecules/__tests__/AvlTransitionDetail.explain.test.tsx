import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AvlTransitionDetail } from '../AvlTransitionDetail';
import { EventBusProvider } from '../../../../core';
import type { TraitTransitionInfo } from '../../../../lib/avl-schema-parser';
import type { AvlAnnotations } from '../../../../lib/avl-annotations';

const transition: TraitTransitionInfo = {
  from: 'pending',
  to: 'paid',
  event: 'PAY',
  guard: ['>', '@payload.amount', 0],
  effects: [{ type: 'set', args: ['@entity.total', '@payload.amount'] }, { type: 'persist', args: ['update', 'Order', '@entity'] }],
  index: 0,
};

const renderDetail = (annotations?: AvlAnnotations, guard: TraitTransitionInfo['guard'] = transition.guard) =>
  render(
    <EventBusProvider debug={false}>
      <AvlTransitionDetail orbital="Orders" trait="Checkout" transition={{ ...transition, guard }} annotations={annotations} />
    </EventBusProvider>,
  );

async function hover(el: HTMLElement) {
  fireEvent.mouseEnter(el);
  fireEvent.focus(el);
  await act(async () => { await new Promise((r) => setTimeout(r, 260)); });
}

describe('AvlTransitionDetail explanations', () => {
  it('each effect header names and explains its effect on hover', async () => {
    renderDetail();
    await hover(screen.getByLabelText('persist'));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Data');
    expect(tip.textContent).toContain('entity records');
  });

  it('the guard and effects sections say in plain words what they are', () => {
    renderDetail();
    expect(screen.getByTestId('avl-td-guard-caption').textContent).toMatch(/only/i);
    expect(screen.getByTestId('avl-td-effects-caption').textContent).toMatch(/order/i);
  });

  it('edge: with no guard there is no guard caption', () => {
    renderDetail(undefined, null);
    expect(screen.queryByTestId('avl-td-guard-caption')).toBeNull();
    expect(screen.getByTestId('avl-td-effects-caption')).toBeTruthy();
  });

  it('a transition note opens on hover of the event', async () => {
    renderDetail({ transitions: { PAY: { title: 'Paying', body: 'The customer pays the order total.' } } });
    await hover(screen.getByTestId('avl-td-event'));
    expect(screen.getByRole('dialog', { hidden: true }).textContent).toContain('The customer pays the order total.');
  });

  it('an effect note reaches that effect header', async () => {
    renderDetail({ effects: { set: { body: 'Copies the amount onto the order.' } } });
    await hover(screen.getByLabelText('set'));
    expect(screen.getByRole('dialog', { hidden: true }).textContent).toContain('Copies the amount onto the order.');
  });

  it('control: without annotations the event is plain text', () => {
    renderDetail();
    expect(screen.getByTestId('avl-td-event').getAttribute('tabindex')).toBeNull();
  });
});

describe('AvlTransitionExplainer (the render-ui pattern)', () => {
  it('renders the transition with its notes and no play controls', async () => {
    const { AvlTransitionExplainer } = await import('../AvlTransitionExplainer');
    render(
      <EventBusProvider debug={false}>
        <AvlTransitionExplainer orbitalName="Orders" traitName="Checkout" transition={transition} annotations={{ transitions: { PAY: { body: 'Pays the total.' } } }} />
      </EventBusProvider>,
    );
    expect(screen.getByTestId('avl-transition-detail')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /step/i })).toBeNull();
    await hover(screen.getByTestId('avl-td-event'));
    expect(screen.getByRole('dialog', { hidden: true }).textContent).toContain('Pays the total.');
  });
});

describe('AvlTransitionExplainer without a guard key', () => {
  it('edge: .lolo data that omits guard renders with no guard section and no crash', async () => {
    const { AvlTransitionExplainer } = await import('../AvlTransitionExplainer');
    const { guard: _omitted, ...noGuard } = transition;
    render(
      <EventBusProvider debug={false}>
        <AvlTransitionExplainer orbitalName="Orders" traitName="Checkout" transition={noGuard} />
      </EventBusProvider>,
    );
    expect(screen.getByTestId('avl-transition-detail')).toBeTruthy();
    expect(screen.queryByTestId('avl-td-guard-caption')).toBeNull();
  });
});
