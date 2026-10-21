import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip } from '../Tooltip';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const open = async (describedBy?: string) => {
  const utils = render(
    <Tooltip content="Helpful hint" delay={0}>
      <button aria-describedby={describedBy}>Trigger</button>
    </Tooltip>,
  );
  const trigger = screen.getByRole('button', { name: 'Trigger' });
  fireEvent.focus(trigger);
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  return { ...utils, trigger };
};

describe('Tooltip a11y', () => {
  it('control: the trigger has no description while the tooltip is hidden', () => {
    render(<Tooltip content="Helpful hint"><button>Trigger</button></Tooltip>);
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBeNull();
  });

  it('shown: the trigger is described by the tooltip', async () => {
    const { trigger } = await open();
    const tip = screen.getByRole('tooltip');
    expect(tip.id).not.toBe('');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);
    expect(trigger).toHaveAccessibleDescription('Helpful hint');
  });

  it('keeps a description the trigger already had', async () => {
    const { trigger } = await open('own-desc');
    const tip = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(`own-desc ${tip.id}`);
  });

  it('Escape dismisses it and drops the description', async () => {
    const { trigger } = await open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });

  it('edge: Escape with no tooltip shown is inert', () => {
    render(<Tooltip content="Helpful hint"><button>Trigger</button></Tooltip>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('has no axe violations while shown', async () => {
    await open();
    expect(describeViolations(await axeViolations(document.body))).toEqual([]);
  });
});
