import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { AvlEffectChip } from '../AvlEffectChip';
import { AvlStateMachine } from '../AvlStateMachine';
import { MiniStateMachine } from '../MiniStateMachine';
import { ModuleCard } from '../ModuleCard';
import type { TraitLevelData } from '../../../../lib/avl-schema-parser';
import type { AvlAnnotations } from '../../../../lib/avl-annotations';
import type { AvlNodeData } from '../../../../lib/avl-flow-converter';

function findBy(selector: string): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el === null) throw new Error(`not rendered: ${selector}`);
    return el;
  }, { timeout: 3000 });
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 260)); });

async function hover(el: HTMLElement) {
  fireEvent.mouseEnter(el);
  fireEvent.focus(el);
  await settle();
}

const TRAIT: TraitLevelData = {
  name: 'Checkout',
  linkedEntity: 'Order',
  states: [
    { name: 'pending', isInitial: true, isTerminal: false },
    { name: 'paid', isInitial: false, isTerminal: false },
  ],
  transitions: [
    { from: 'pending', to: 'paid', event: 'PAY', guard: null, effects: [{ type: 'set', args: [] }, { type: 'persist', args: [] }], index: 0 },
    { from: 'paid', to: 'pending', event: 'RESET', guard: null, effects: [], index: 1 },
  ],
  emittedEvents: [],
  listenedEvents: [],
};

describe('AvlEffectChip', () => {
  it('names its effect for assistive tech and explains it on hover: name, plain category, std description', async () => {
    render(<AvlEffectChip effectType="persist" />);
    const chip = screen.getByLabelText('persist');
    await hover(chip);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('persist');
    expect(tip.textContent).toContain('Data');
    expect(tip.textContent).toContain('entity records');
  });

  it('an author note opens a popover with the note, keeping the built-in explanation', async () => {
    render(<AvlEffectChip effectType="persist" note={{ title: 'Saved for good', body: 'The order survives a reload.' }} />);
    await hover(screen.getByLabelText('persist'));
    const panel = screen.getByRole('dialog', { hidden: true });
    expect(panel.textContent).toContain('Saved for good');
    expect(panel.textContent).toContain('The order survives a reload.');
    expect(panel.textContent).toContain('Data');
  });

  it('an effect with its code opens a popover: the brief explanation, then the code, left to right and scrollable', async () => {
    render(<AvlEffectChip effectType="set" code="(set @entity.open true)" />);
    await hover(screen.getByLabelText('set'));
    const panel = screen.getByRole('dialog', { hidden: true });
    expect(panel.textContent).toContain('set');
    expect(panel.textContent).toContain('Data');
    const code = panel.querySelector<HTMLElement>('[data-testid="avl-explain-code"]');
    expect(code?.textContent).toBe('(set @entity.open true)');
    expect(code?.getAttribute('dir')).toBe('ltr');
    expect(code?.className).toContain('overflow-auto');
  });

  it('edge: an effect the registry does not know shows just its name', async () => {
    render(<AvlEffectChip effectType="zz/unknown" />);
    await hover(screen.getByLabelText('zz/unknown'));
    expect(screen.getByRole('tooltip').textContent).toBe('zz/unknown');
  });
});

describe('AvlStateMachine effect labels and annotations', () => {
  const renderSm = (annotations?: AvlAnnotations) => render(<AvlStateMachine trait={TRAIT} annotations={annotations} />);

  it('each transition shows one labelled chip per effect instead of a bare count', async () => {
    renderSm();
    const pay = await findBy('[data-testid="avl-sm-label"][data-event="PAY"]');
    const chips = [...pay.querySelectorAll('[data-testid="avl-effect-chip"]')].map((c) => c.getAttribute('aria-label'));
    expect(chips).toEqual(['set', 'persist']);
    expect(pay.textContent).not.toMatch(/·\d/);
  });

  it('each effect chip carries its own code from the transition', async () => {
    const withArgs: TraitLevelData = {
      ...TRAIT,
      transitions: [{ ...TRAIT.transitions[0]!, effects: [{ type: 'set', args: ['@entity.status', 'paid'] }, { type: 'persist', args: [] }] }, TRAIT.transitions[1]!],
    };
    render(<AvlStateMachine trait={withArgs} />);
    const pay = await findBy('[data-testid="avl-sm-label"][data-event="PAY"]');
    await hover(pay.querySelector<HTMLElement>('[aria-label="set"]')!);
    const code = screen.getByRole('dialog', { hidden: true }).querySelector('[data-testid="avl-explain-code"]');
    expect(code?.textContent).toBe('(set @entity.status "paid")');
  });

  it('control: an effect known only by its type (no arguments) keeps the plain explanation', async () => {
    renderSm();
    const pay = await findBy('[data-testid="avl-sm-label"][data-event="PAY"]');
    await hover(pay.querySelector<HTMLElement>('[aria-label="persist"]')!);
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(screen.getByRole('tooltip').textContent).toContain('persist');
  });

  it('control: a transition with no effects has no chips', async () => {
    renderSm();
    const reset = await findBy('[data-testid="avl-sm-label"][data-event="RESET"]');
    expect(reset.querySelectorAll('[data-testid="avl-effect-chip"]')).toHaveLength(0);
  });

  it('a state note opens on hover of that state', async () => {
    renderSm({ states: { pending: { body: 'An order starts unpaid.' } } });
    const state = await findBy('[data-explain="state:pending"]');
    await hover(state);
    expect(screen.getByRole('dialog', { hidden: true }).textContent).toContain('An order starts unpaid.');
  });

  it('a transition note opens on hover of its label', async () => {
    renderSm({ transitions: { PAY: { title: 'Paying', body: 'Only a positive amount is accepted.' } } });
    const label = await findBy('[data-explain="transition:PAY"]');
    await hover(label);
    expect(screen.getByRole('dialog', { hidden: true }).textContent).toContain('Only a positive amount is accepted.');
  });

  it('edge: an effect note keyed by type reaches that effect chip', async () => {
    renderSm({ effects: { persist: { body: 'Written to the orders table.' } } });
    const pay = await findBy('[data-testid="avl-sm-label"][data-event="PAY"]');
    const chip = pay.querySelector('[aria-label="persist"]') as HTMLElement;
    await hover(chip);
    expect(screen.getByRole('dialog', { hidden: true }).textContent).toContain('Written to the orders table.');
  });
});

describe('MiniStateMachine explanations', () => {
  it('a state shows its name on hover, since the mini pills carry no text', async () => {
    render(<MiniStateMachine data={TRAIT} />);
    await hover(screen.getByLabelText('pending'));
    expect(screen.getByRole('tooltip').textContent).toContain('pending');
  });

  it('each effect in the row is a labelled chip that explains itself', async () => {
    render(<MiniStateMachine data={TRAIT} />);
    await hover(screen.getByLabelText('set'));
    expect(screen.getByRole('tooltip').textContent).toContain('Data');
  });

  it('annotations reach the mini machine', async () => {
    render(<MiniStateMachine data={TRAIT} annotations={{ states: { paid: { body: 'Money received.' } } }} />);
    await hover(screen.getByLabelText('paid'));
    expect(screen.getByRole('dialog', { hidden: true }).textContent).toContain('Money received.');
  });
});

describe('ModuleCard explanations', () => {
  const data: AvlNodeData = {
    orbitalName: 'Orders',
    entityName: 'Order',
    persistence: 'persistent',
    fields: [{ name: 'total', type: 'number', required: true, hasDefault: false }],
    traits: [{ name: 'Checkout', stateCount: 2, eventCount: 2, transitionCount: 2, emits: [], listens: [] }],
    pages: [],
    traitDetails: { Checkout: TRAIT },
    externalLinks: [],
  };

  it('a field glyph names its type on hover', async () => {
    render(<ModuleCard data={data} />);
    await hover(screen.getByLabelText('total: number'));
    expect(screen.getByRole('tooltip').textContent).toContain('number');
  });

  it('annotations keyed by trait reach that trait mini machine', async () => {
    render(<ModuleCard data={data} annotations={{ Checkout: { effects: { persist: { body: 'Saved to the orders table.' } } } }} />);
    await hover(screen.getByLabelText('persist'));
    expect(screen.getByRole('dialog', { hidden: true }).textContent).toContain('Saved to the orders table.');
  });

  it('control: an annotation for another trait does not apply', async () => {
    render(<ModuleCard data={data} annotations={{ Other: { effects: { persist: { body: 'Wrong trait.' } } } }} />);
    await hover(screen.getByLabelText('persist'));
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(screen.getByRole('tooltip').textContent).toContain('persist');
  });
});
