import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuestView } from '../GuestView';
import { EventBusProvider } from '../../../../core';

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
