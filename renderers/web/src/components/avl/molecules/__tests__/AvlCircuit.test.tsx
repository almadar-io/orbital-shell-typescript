// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SExpr } from '@almadar/core';
import type { JsonObject } from '@almadar/core';
import { traced } from '../../../../../test/ui/helpers/traced';
import { AvlCircuit } from '../AvlCircuit';

const GUARD: SExpr = ['and', ['>', '@entity.qty', 0], ['=', '@entity.role', 'admin']];
const run = (expr: SExpr, entity: JsonObject = {}) => traced(expr, { entity }).trace;
const part = (key: string) => screen.getAllByTestId('avl-circuit-node').find((n) => n.getAttribute('data-key') === key);

describe('AvlCircuit', () => {
  it('draws the code and one part per node, each with its circuit form', () => {
    render(<AvlCircuit expr={GUARD} title="guard of SAVE" />);
    expect(screen.getByText('guard of SAVE')).toBeInTheDocument();
    expect(screen.getByTestId('avl-circuit-code').textContent).toBe('(and (> @entity.qty 0) (= @entity.role "admin"))');
    expect(part('')?.getAttribute('data-form')).toBe('series');
    expect(part('1')?.getAttribute('data-form')).toBe('block');
    expect(part('1.1')?.getAttribute('data-kind')).toBe('binding');
  });

  it('control: without a trace every part is idle and there is no narration', () => {
    render(<AvlCircuit expr={GUARD} />);
    expect(screen.getAllByTestId('avl-circuit-node').every((n) => n.getAttribute('data-status') === 'idle')).toBe(true);
    expect(screen.queryByTestId('avl-circuit-narration')).toBeNull();
  });

  it('shows the run at the cursor: the and breaks at the false comparison, values ride the wires', () => {
    const trace = run(GUARD, { qty: 3, role: 'viewer' });
    render(<AvlCircuit expr={GUARD} trace={trace} cursor={trace.length - 1} />);
    expect(part('1')?.getAttribute('data-status')).toBe('done');
    expect(part('2')?.getAttribute('data-status')).toBe('done');
    const chips = screen.getAllByTestId('avl-circuit-value').map((c) => c.textContent);
    expect(chips).toContain('3');
    expect(chips).toContain('"viewer"');
    expect(chips).toContain('false');
    expect(screen.getByTestId('avl-circuit-open-switch').getAttribute('data-key')).toBe('2');
    expect(screen.getByTestId('avl-circuit-narration').textContent).toContain('false');
  });

  it('mid-run: the running part is marked and the stack lists what is being evaluated', () => {
    const trace = run(GUARD, { qty: 3, role: 'viewer' });
    const cursor = trace.findIndex((t) => t.kind === 'enter' && t.path.join('.') === '2');
    render(<AvlCircuit expr={GUARD} trace={trace} cursor={cursor} />);
    expect(part('2')?.getAttribute('data-status')).toBe('active');
    expect(screen.getAllByTestId('avl-circuit-stack-frame').map((f) => f.textContent)).toEqual(['and', '=']);
  });

  it('dims a short-circuited branch', () => {
    const expr: SExpr = ['and', ['>', 0, 1], ['=', 1, 1]];
    const trace = run(expr);
    render(<AvlCircuit expr={expr} trace={trace} />);
    expect(part('2')?.getAttribute('data-status')).toBe('skipped');
  });

  it('does not mark an operand skipped when its operator reads it as a name (control for the and case)', () => {
    const expr: SExpr = ['set', '@entity.status', 'saving'];
    const trace = run(expr, { status: 'draft' });
    render(<AvlCircuit expr={expr} trace={trace} />);
    expect(part('1')?.getAttribute('data-status')).not.toBe('skipped');
    expect(screen.getByTestId('avl-circuit-zone').textContent).toContain('entity');
  });

  it('runs a lambda as a conveyor with one result per item', () => {
    const expr: SExpr = ['array/filter', ['list', 2, 0, 5], ['fn', 'x', ['>', '@x', 0]]];
    const trace = run(expr);
    render(<AvlCircuit expr={expr} trace={trace} />);
    expect(part('')?.getAttribute('data-form')).toBe('conveyor');
    expect(screen.getAllByTestId('avl-circuit-item').map((i) => i.getAttribute('data-result'))).toEqual(['true', 'false', 'true']);
  });
});
