import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SlotContentRenderer } from '../UISlotRenderer';
import { TraitFrame } from '../../atoms/TraitFrame';
import { UISlotProvider, useUISlots } from '../../../../providers/UISlotContext';
import type { SlotContent } from '../../../../hooks/useUISlots';

function Seed({ traits }: { traits: Record<string, string> }): null {
  const slots = useUISlots();
  React.useLayoutEffect(() => {
    for (const [trait, text] of Object.entries(traits)) {
      slots.updateTraitContent(trait, { pattern: 'typography', props: { content: text }, slot: 'main', priority: 0 });
    }
  }, [slots, traits]);
  return null;
}

const paint = (props: SlotContent['props']): SlotContent => ({ id: 'home', pattern: 'box', props, priority: 0, sourceTrait: 'HomeOverview' });

describe('SlotContentRenderer: @trait.X references nested below the first children level', () => {
  it('paints already-substituted TraitFrame children (a guest-view paints prop) as frames, never the unknown-pattern fallback', async () => {
    render(
      <UISlotProvider>
        <Seed traits={{ ListOne: 'first list', ListTwo: 'second list' }} />
        <SlotContentRenderer
          content={paint({ children: [{ type: 'stack', direction: 'vertical', className: '', children: [<TraitFrame key="a" traitName="ListOne" />, <TraitFrame key="b" traitName="ListTwo" />] }] })}
          onDismiss={() => {}}
        />
      </UISlotProvider>,
    );
    expect(await screen.findByText('first list')).toBeTruthy();
    expect(await screen.findByText('second list')).toBeTruthy();
    expect(screen.queryByText(/Unknown pattern:/)).toBeNull();
  });

  it('paints every embedded trait a nested stack lists by reference', async () => {
    render(
      <UISlotProvider>
        <Seed traits={{ ListOne: 'first list', ListTwo: 'second list' }} />
        <SlotContentRenderer
          content={paint({ children: [{ type: 'stack', direction: 'vertical', className: '', children: ['@trait.ListOne', '@trait.ListTwo'] }] })}
          onDismiss={() => {}}
        />
      </UISlotProvider>,
    );
    expect(await screen.findByText('first list')).toBeTruthy();
    expect(await screen.findByText('second list')).toBeTruthy();
    expect(screen.queryByText(/Unknown pattern:/)).toBeNull();
  });

  it('control: a reference directly in the first children level paints the trait too', async () => {
    render(
      <UISlotProvider>
        <Seed traits={{ ListOne: 'first list' }} />
        <SlotContentRenderer content={paint({ children: ['@trait.ListOne'] })} onDismiss={() => {}} />
      </UISlotProvider>,
    );
    expect(await screen.findByText('first list')).toBeTruthy();
    expect(screen.queryByText(/Unknown pattern:/)).toBeNull();
  });

  it('edge: a reference three levels down beside a plain pattern paints both', async () => {
    render(
      <UISlotProvider>
        <Seed traits={{ Deep: 'deep trait' }} />
        <SlotContentRenderer
          content={paint({ children: [{ type: 'box', children: [{ type: 'stack', className: 'x', children: [{ type: 'typography', content: 'plain' }, '@trait.Deep'] }] }] })}
          onDismiss={() => {}}
        />
      </UISlotProvider>,
    );
    expect(await screen.findByText('deep trait')).toBeTruthy();
    expect(screen.getByText('plain')).toBeTruthy();
    expect(screen.queryByText(/Unknown pattern:/)).toBeNull();
  });
});
