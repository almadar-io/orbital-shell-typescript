// @vitest-environment jsdom
import React from 'react';
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OrbitalSchema, StateMachine, TraitDescription, TraitValue, TransitionTrace } from '@almadar/core';
import { MachinePanel, type DescribeTrait } from '../MachinePanel';

const doorMachine: StateMachine = {
  states: [{ name: 'closed', isInitial: true }, { name: 'opened' }],
  events: [{ key: 'OPEN', name: 'Open' }, { key: 'CLOSE', name: 'Close' }],
  transitions: [
    { from: 'closed', to: 'opened', event: 'OPEN' },
    { from: 'opened', to: 'closed', event: 'CLOSE' },
  ],
};
const lampMachine: StateMachine = {
  states: [{ name: 'off', isInitial: true }, { name: 'on' }],
  events: [{ key: 'TOGGLE', name: 'Toggle' }],
  transitions: [{ from: 'off', to: 'on', event: 'TOGGLE' }, { from: 'on', to: 'off', event: 'TOGGLE' }],
};

const schema: OrbitalSchema = {
  name: 'House',
  orbitals: [{
    name: 'HouseOrbital',
    entity: { name: 'Room', fields: [{ name: 'open', type: 'boolean' }] },
    traits: [
      { name: 'HouseDoor', stateMachine: doorMachine, sourceBehavior: { behavior: 'std/std-door', alias: 'Door', originalName: 'DoorLife' } },
      { name: 'Lamp', stateMachine: lampMachine },
    ],
    pages: [],
  }],
};

const hop = (traitName: string, from: string, event: string, to: string): TransitionTrace => ({
  id: `${traitName}-${from}-${event}`, traitName, from, to, event, effects: [], timestamp: 0,
});

const doorSource: TraitDescription = {
  value: { behavior: 'std/std-door', trait: 'DoorLife' },
  knobs: [],
  events: { emits: [], listens: [], transitions: ['OPEN', 'CLOSE'] },
  machine: { linkedEntity: 'Room', stateMachine: doorMachine },
  source: { text: 'trait DoorLife -> Room {\n  state closed {\n    OPEN -> opened\n  }\n  state opened {\n    CLOSE -> closed\n  }\n}', transitions: [{ index: 0, start: 3, end: 3 }, { index: 1, start: 6, end: 6 }] },
  model: '',
};

function recordingDescribe(answer: (value: TraitValue) => Promise<TraitDescription>): { describe: DescribeTrait; asked: TraitValue[] } {
  const asked: TraitValue[] = [];
  return { asked, describe: (value) => { asked.push(value); return answer(value); } };
}

// jsdom has no element scrolling; the code block and the diagram scroll their highlight into view.
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

describe('MachinePanel — the debugger shows the followed trait\'s code beside its live machine', () => {
  it('follows the latest hop: draws that trait, lights the state it entered and the printed lines of the transition', async () => {
    const { describe: describeTrait, asked } = recordingDescribe(async () => doorSource);
    render(<MachinePanel schema={schema} transitions={[hop('Lamp', 'off', 'TOGGLE', 'on'), hop('HouseDoor', 'closed', 'OPEN', 'opened')]} describe={describeTrait} />);
    expect(screen.getByTestId('machine-panel').dataset.trait).toBe('HouseDoor');
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(2));
    expect(screen.getAllByTestId('avl-sm-state').find((n) => n.dataset.state === 'opened')?.dataset.active).toBe('true');
    expect(asked).toEqual([{ behavior: 'std/std-door', trait: 'DoorLife' }]);
    await waitFor(() => expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(1));
    expect(document.querySelector('[data-highlighted="true"]')?.textContent).toContain('OPEN -> opened');
  });

  const unit = async (id: string): Promise<HTMLElement> => waitFor(() => {
    const node = screen.getAllByTestId('avl-dependency-node').find((n) => n.getAttribute('data-dependency') === id);
    expect(node).toBeDefined();
    return node!;
  });

  it('the first column is the orbital\'s flow, lit on the unit of the latest hop', async () => {
    render(<MachinePanel schema={schema} transitions={[hop('HouseDoor', 'closed', 'OPEN', 'opened'), hop('Lamp', 'off', 'TOGGLE', 'on')]} />);
    expect((await unit('behavior:std-door')).textContent).toBe('std-door · 1 trait');
    await waitFor(async () => expect((await unit('trait:Lamp')).getAttribute('data-role')).toBe('selected'));
    expect(screen.queryByTestId('machine-panel-follow')).toBeNull();
  });

  it('clicking a unit pins its trait and replays that trait\'s hops from the first, through to the latest', async () => {
    const { describe: describeTrait } = recordingDescribe(async () => doorSource);
    const transitions = [hop('HouseDoor', 'closed', 'OPEN', 'opened'), hop('HouseDoor', 'opened', 'CLOSE', 'closed'), hop('Lamp', 'off', 'TOGGLE', 'on')];
    render(<MachinePanel schema={schema} transitions={transitions} describe={describeTrait} replayStepMs={20} />);
    fireEvent.click(await unit('behavior:std-door'));
    const panel = screen.getByTestId('machine-panel');
    expect([panel.dataset.trait, panel.dataset.following, panel.dataset.replayStep, panel.dataset.replaying]).toEqual(['HouseDoor', 'false', '0', 'true']);
    await waitFor(() => expect(panel.dataset.replaying).toBe('false'));
    expect(panel.dataset.replayStep).toBe('1');
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state').find((n) => n.dataset.state === 'closed')?.dataset.active).toBe('true'));
  });

  it('a pinned trait stays while others run; clicking its unit again goes back to following the run', async () => {
    const transitions = [hop('HouseDoor', 'closed', 'OPEN', 'opened'), hop('Lamp', 'off', 'TOGGLE', 'on')];
    const { rerender } = render(<MachinePanel schema={schema} transitions={transitions} replayStepMs={60_000} />);
    fireEvent.click(await unit('behavior:std-door'));
    rerender(<MachinePanel schema={schema} transitions={[...transitions, hop('Lamp', 'on', 'TOGGLE', 'off')]} replayStepMs={60_000} />);
    expect(screen.getByTestId('machine-panel').dataset.trait).toBe('HouseDoor');
    fireEvent.click(await unit('behavior:std-door'));
    expect([screen.getByTestId('machine-panel').dataset.trait, screen.getByTestId('machine-panel').dataset.following]).toEqual(['Lamp', 'true']);
  });

  it('the scrubber steps the replay: the machine and the code follow the step', async () => {
    const { describe: describeTrait } = recordingDescribe(async () => doorSource);
    const transitions = [hop('HouseDoor', 'closed', 'OPEN', 'opened'), hop('HouseDoor', 'opened', 'CLOSE', 'closed')];
    render(<MachinePanel schema={schema} transitions={transitions} describe={describeTrait} replayStepMs={60_000} />);
    fireEvent.click(await unit('behavior:std-door'));
    fireEvent.click(screen.getByTestId('machine-panel-replay-toggle'));
    const panel = screen.getByTestId('machine-panel');
    expect(panel.dataset.replaying).toBe('false');
    await waitFor(() => expect(document.querySelector('[data-highlighted="true"]')?.textContent).toContain('OPEN -> opened'));
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state').find((n) => n.dataset.state === 'opened')?.dataset.active).toBe('true'));
    fireEvent.click(screen.getByTestId('machine-panel-replay-forward'));
    expect(panel.dataset.replayStep).toBe('1');
    await waitFor(() => expect(document.querySelector('[data-highlighted="true"]')?.textContent).toContain('CLOSE -> closed'));
    fireEvent.click(screen.getByTestId('machine-panel-replay-back'));
    expect(panel.dataset.replayStep).toBe('0');
  });

  it('a dispatch verdict entry (`server:<Orbital>`) is no hop: it is not followed', () => {
    render(<MachinePanel schema={schema} transitions={[hop('Lamp', 'off', 'TOGGLE', 'on'), hop('server:HouseOrbital', 'idle', 'INIT', 'idle')]} />);
    expect(screen.getByTestId('machine-panel').dataset.trait).toBe('Lamp');
  });

  it('control: following the run replays nothing and shows the latest hop', () => {
    render(<MachinePanel schema={schema} transitions={[hop('HouseDoor', 'closed', 'OPEN', 'opened'), hop('HouseDoor', 'opened', 'CLOSE', 'closed')]} />);
    const panel = screen.getByTestId('machine-panel');
    expect([panel.dataset.following, panel.dataset.replayStep, panel.dataset.replaying]).toEqual(['true', undefined, undefined]);
    expect(screen.queryByTestId('machine-panel-replay-toggle')).toBeNull();
  });

  it('control: before any hop the first machine is drawn and no unit is lit', async () => {
    render(<MachinePanel schema={schema} transitions={[]} />);
    expect(screen.getByTestId('machine-panel').dataset.trait).toBe('HouseDoor');
    await unit('trait:Lamp');
    expect(screen.getAllByTestId('avl-dependency-node').map((n) => n.getAttribute('data-role'))).not.toContain('selected');
  });

  it('control: without a describer the machine is drawn alone, with no code', async () => {
    render(<MachinePanel schema={schema} transitions={[hop('Lamp', 'off', 'TOGGLE', 'on')]} />);
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(2));
    expect(screen.queryByTestId('code-block-header')).toBeNull();
  });

  it('control: a failed describe shows its error beside the machine', async () => {
    const { describe: describeTrait } = recordingDescribe(async () => { throw new Error('orb exited 1'); });
    render(<MachinePanel schema={schema} transitions={[]} describe={describeTrait} />);
    await waitFor(() => expect(screen.getByText('orb exited 1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(2));
  });

  it('control: a program with no state machines shows the empty note', () => {
    render(<MachinePanel schema={{ name: 'Empty', orbitals: [] }} transitions={[]} />);
    expect(screen.getByTestId('machine-panel-empty')).toBeInTheDocument();
  });
});
