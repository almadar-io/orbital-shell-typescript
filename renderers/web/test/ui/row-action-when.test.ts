/**
 * `when` on a list action item: the explicit per-row condition authored in
 * `.lolo` as `when: (fn row <bool>)`. One evaluator owns it for every list
 * component; an action with no `when` is always shown.
 */
import { describe, it, expect } from 'vitest';
import type { EntityRow, SExpr } from '@almadar/core';
import {
  type RowActionCondition,
  isActionShownForRow,
  actionsShownForRow,
  ACTION_WHEN_KEY,
} from '../../src/lib/row-action-when';
import { convertFnFormLambdasInProps } from '../../src/lib/fn-form-lambda';
import type { SlotProps, SlotPropValue } from '../../src/providers/UISlotContext';

const ownerOnly: SExpr = ['fn', 'row', ['=', ['object/get', '@row', 'ownerId'], '@user.id']];
const ownerOrManager: SExpr = [
  'fn',
  'row',
  ['or', ['=', '@user.role', 'manager'], ['=', ['object/get', '@row', 'ownerId'], '@user.id']],
];

type Act = { readonly event: string; readonly when?: RowActionCondition; readonly roles?: readonly string[] };
const act = (a: Act): Act => a;

const alice = { id: 'u-alice', role: 'member', permissions: [] };
const bob = { id: 'u-bob', role: 'member', permissions: [] };
const boss = { id: 'u-boss', role: 'manager', permissions: [] };

describe('isActionShownForRow', () => {
  it('shows an action with no `when` for every row and viewer', () => {
    expect(isActionShownForRow(act({ event: 'EDIT' }), { id: '1' }, { user: alice })).toBe(true);
    expect(isActionShownForRow(act({ event: 'EDIT' }), { id: '1' }, { user: null })).toBe(true);
  });

  it('paired control: the owner sees the action on their own row and not on another row', () => {
    const action = act({ event: 'EDIT', when: ownerOnly });
    expect(isActionShownForRow(action, { id: '1', ownerId: 'u-alice' }, { user: alice })).toBe(true);
    expect(isActionShownForRow(action, { id: '2', ownerId: 'u-bob' }, { user: alice })).toBe(false);
  });

  it('paired control: the same row flips with the viewer', () => {
    const action = act({ event: 'EDIT', when: ownerOnly });
    const row = { id: '1', ownerId: 'u-alice' };
    expect(isActionShownForRow(action, row, { user: alice })).toBe(true);
    expect(isActionShownForRow(action, row, { user: bob })).toBe(false);
  });

  it('composes with viewer fields: a manager passes on rows they do not own', () => {
    const action = act({ event: 'EDIT', when: ownerOrManager });
    const row = { id: '1', ownerId: 'u-alice' };
    expect(isActionShownForRow(action, row, { user: boss })).toBe(true);
    expect(isActionShownForRow(action, row, { user: bob })).toBe(false);
  });

  it('accepts the grouped-parameter lambda form', () => {
    const action = act({ event: 'EDIT', when: ['fn', ['row'], ['=', ['object/get', '@row', 'ownerId'], '@user.id']] });
    expect(isActionShownForRow(action, { ownerId: 'u-alice' }, { user: alice })).toBe(true);
    expect(isActionShownForRow(action, { ownerId: 'u-bob' }, { user: alice })).toBe(false);
  });

  it('a row missing the compared field is not shown to a signed-in viewer', () => {
    const action = act({ event: 'EDIT', when: ownerOnly });
    expect(isActionShownForRow(action, { id: '1' }, { user: alice })).toBe(false);
  });

  it('a signed-out viewer binds as the anonymous viewer, never as a row owner', () => {
    const action = act({ event: 'EDIT', when: ownerOnly });
    expect(isActionShownForRow(action, { ownerId: 'u-alice' }, { user: null })).toBe(false);
    expect(isActionShownForRow(action, { ownerId: 'u-alice' }, {})).toBe(false);
  });

  it('a `when` that does not return boolean true hides the action', () => {
    const notBool: SExpr = ['fn', 'row', ['object/get', '@row', 'ownerId']];
    expect(isActionShownForRow(act({ event: 'EDIT', when: notBool }), { ownerId: 'u-alice' }, { user: alice })).toBe(false);
    const nothing: SExpr = ['fn', 'row', ['object/get', '@row', 'missing']];
    expect(isActionShownForRow(act({ event: 'EDIT', when: nothing }), { ownerId: 'x' }, { user: alice })).toBe(false);
  });

  it('a malformed `when` (not a lambda) hides the action instead of showing it', () => {
    expect(isActionShownForRow(act({ event: 'EDIT', when: 'true' }), { id: '1' }, { user: alice })).toBe(false);
    expect(isActionShownForRow(act({ event: 'EDIT', when: ['=', 1, 1] }), { id: '1' }, { user: alice })).toBe(false);
    expect(isActionShownForRow(act({ event: 'EDIT', when: true }), { id: '1' }, { user: alice })).toBe(false);
  });

  it('a `when` that throws hides the action', () => {
    const boom: SExpr = ['fn', 'row', ['no-such-operator-anywhere', '@row']];
    expect(isActionShownForRow(act({ event: 'EDIT', when: boom }), { id: '1' }, { user: alice })).toBe(false);
  });

  it('honours an explicit @config binding the host supplies', () => {
    const cfgGate: SExpr = ['fn', 'row', ['=', '@config.mode', 'edit']];
    expect(isActionShownForRow(act({ event: 'E', when: cfgGate }), {}, { config: { mode: 'edit' } })).toBe(true);
    expect(isActionShownForRow(act({ event: 'E', when: cfgGate }), {}, { config: { mode: 'view' } })).toBe(false);
  });
});

describe('a `when` delivered as a compiled closure', () => {
  const closure = (row: EntityRow): boolean => row.ownerId === 'u-alice';

  it('is called with the row and its boolean true shows the action', () => {
    expect(isActionShownForRow(act({ event: 'EDIT', when: closure }), { ownerId: 'u-alice' }, {})).toBe(true);
  });

  it('control: the same closure hides the action on another row', () => {
    expect(isActionShownForRow(act({ event: 'EDIT', when: closure }), { ownerId: 'u-bob' }, {})).toBe(false);
  });

  it('a closure that throws hides the action', () => {
    const boom = (): boolean => {
      throw new Error('bad rule');
    };
    expect(isActionShownForRow(act({ event: 'EDIT', when: boom }), { id: '1' }, {})).toBe(false);
  });
});

describe('actionsShownForRow', () => {
  const actions: readonly Act[] = [
    { event: 'VIEW' },
    { event: 'EDIT', when: ownerOnly },
    { event: 'DELETE', roles: ['manager'], when: ownerOrManager },
  ];

  it('keeps order and unconditional actions, drops only the failing ones', () => {
    const own = actionsShownForRow(actions, { ownerId: 'u-alice' }, { user: alice });
    expect(own.map((a) => a.event)).toEqual(['VIEW', 'EDIT', 'DELETE']);
    const other = actionsShownForRow(actions, { ownerId: 'u-bob' }, { user: alice });
    expect(other.map((a) => a.event)).toEqual(['VIEW']);
  });

  it('returns the same array when nothing carries a `when` (identity kept for memoised consumers)', () => {
    const plain: readonly Act[] = [{ event: 'A' }, { event: 'B' }];
    expect(actionsShownForRow(plain, { id: '1' }, { user: alice })).toBe(plain);
  });

  it('handles an empty list', () => {
    expect(actionsShownForRow<Act>([], { id: '1' }, { user: alice })).toEqual([]);
  });
});

describe('the `when` lambda survives the render-prop lambda conversion', () => {
  it('leaves a registry-declared sexpr member raw while still converting renderItem', () => {
    const props: SlotProps = {
      itemActions: [{ event: 'EDIT', label: 'Edit', [ACTION_WHEN_KEY]: ownerOnly }],
      renderItem: ['fn', 'item', { type: 'typography', content: '@item.name' }],
    };
    const out = convertFnFormLambdasInProps(props, 'data-list');
    if (typeof out === 'string') throw new Error('expected object props');
    const actions = out.itemActions as ReadonlyArray<{ when: SExpr }>;
    expect(actions[0].when).toBe(ownerOnly);
    expect(typeof out.renderItem).toBe('function');
  });

  it('reads the schema of a nested pattern node from its own `type`', () => {
    const props: SlotProps = {
      children: [{ type: 'data-list', itemActions: [{ event: 'EDIT', label: 'Edit', [ACTION_WHEN_KEY]: ownerOnly }] }],
    };
    const out = convertFnFormLambdasInProps(props, 'stack');
    if (typeof out === 'string') throw new Error('expected object props');
    const children = out.children as ReadonlyArray<{ itemActions: ReadonlyArray<{ when: SExpr }> }>;
    expect(children[0].itemActions[0].when).toBe(ownerOnly);
  });

  it('control: a lambda under a member the registry does not declare sexpr is compiled', () => {
    const props: SlotProps = { itemActions: [{ event: 'EDIT', label: 'Edit', decorate: ownerOnly }] };
    const out = convertFnFormLambdasInProps(props, 'data-list');
    if (typeof out === 'string') throw new Error('expected object props');
    const actions = out.itemActions as ReadonlyArray<{ decorate: SlotPropValue }>;
    expect(typeof actions[0].decorate).toBe('function');
  });

  it('control: with no pattern schema the member name alone keeps nothing raw', () => {
    const props: SlotProps = { itemActions: [{ event: 'EDIT', label: 'Edit', [ACTION_WHEN_KEY]: ownerOnly }] };
    const out = convertFnFormLambdasInProps(props);
    if (typeof out === 'string') throw new Error('expected object props');
    const actions = out.itemActions as ReadonlyArray<{ when: SlotPropValue }>;
    expect(typeof actions[0].when).toBe('function');
  });
});
