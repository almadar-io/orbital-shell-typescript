/**
 * A verification run flips a canvas card to the state each played step reached: the card's
 * option for that exact transition when it has one, else the trait's other screen of that state.
 */
import { describe, it, expect } from 'vitest';
import { optionForPlayedStep, type CanvasStateOptions } from '../avl-preview-converter';

const opt = (trait: string, event: string, from: string, to: string) => ({
  id: `${trait}:${event}:${from}:${to}`,
  label: to,
  hint: trait,
  data: { orbitalName: 'Tasks', traitName: trait, transitionEvent: event, fromState: from, toState: to, patterns: [], eventSources: [] },
});

const options: CanvasStateOptions = {
  own: [opt('TaskList', 'INIT', 'idle', 'browsing'), opt('TaskList', 'OPEN', 'browsing', 'viewing'), opt('TaskList', 'EDIT', 'viewing', 'editing')],
  groups: [{ alias: 'Modal', behaviorName: 'std-modal', options: [opt('ModalRecord', 'OPEN', 'closed', 'open')] }],
};

describe('optionForPlayedStep', () => {
  it('picks the option for exactly the played transition', () => {
    expect(optionForPlayedStep(options, { trait: 'TaskList', event: 'OPEN', from: 'browsing', to: 'viewing' })).toBe('TaskList:OPEN:browsing:viewing');
  });

  it('finds a transition in an imported behavior group', () => {
    expect(optionForPlayedStep(options, { trait: 'ModalRecord', event: 'OPEN', from: 'closed', to: 'open' })).toBe('ModalRecord:OPEN:closed:open');
  });

  it('falls back to the trait\'s screen of the reached state when that transition renders nothing of its own', () => {
    expect(optionForPlayedStep(options, { trait: 'TaskList', event: 'REFRESH', from: 'viewing', to: 'viewing' })).toBe('TaskList:OPEN:browsing:viewing');
  });

  it('control: a state with no screen leaves the card as it is', () => {
    expect(optionForPlayedStep(options, { trait: 'TaskList', event: 'SAVE', from: 'editing', to: 'saving' })).toBeUndefined();
    expect(optionForPlayedStep(options, { trait: 'Other', event: 'OPEN', from: 'browsing', to: 'viewing' })).toBeUndefined();
  });
});
