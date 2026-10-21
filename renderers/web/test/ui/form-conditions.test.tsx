import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { installKernelEvaluator } from '@almadar/core';
import { Form, type FormSection, type SchemaField } from '../../src/components/core/organisms/Form';
import { ConditionalWrapper } from '../../src/core';
import { EventBusProvider } from '../../src/core';
import { loadTestKernel } from '../../src/test-support/kernel-engine';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

const fields: SchemaField[] = [
  { name: 'kind', label: 'Kind', type: 'string' },
  { name: 'license', label: 'License number', type: 'string' },
  { name: 'notes', label: 'Notes', type: 'string' },
];

const licenseWhenCommercial = ['=', '@entity.formValues.kind', 'commercial'];

async function countGuardCrossings() {
  const kernel = await loadTestKernel();
  const evaluateGuards = vi.fn((context: string, guards: string) => kernel.evaluateGuards(context, guards));
  installKernelEvaluator({ ...kernel, evaluateGuards });
  return evaluateGuards;
}

afterEach(async () => {
  installKernelEvaluator(await loadTestKernel());
});

describe('Form conditional fields on the kernel evaluator', () => {
  it('shows a conditional field when its condition holds and hides it when it does not', () => {
    wrap(<Form fields={fields} initialData={{ kind: 'commercial' }} conditionalFields={{ license: licenseWhenCommercial }} />);
    expect(screen.getByRole('textbox', { name: /License number/ })).toBeTruthy();
  });

  it('control: the same field is hidden for another value, and an unconditioned field always shows', () => {
    wrap(<Form fields={fields} initialData={{ kind: 'private' }} conditionalFields={{ license: licenseWhenCommercial }} />);
    expect(screen.queryByRole('textbox', { name: /License number/ })).toBeNull();
    expect(screen.getByRole('textbox', { name: /Notes/ })).toBeTruthy();
  });

  it('follows the form values as they change', () => {
    wrap(<Form fields={fields} conditionalFields={{ license: licenseWhenCommercial }} />);
    expect(screen.queryByRole('textbox', { name: /License number/ })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: /Kind/ }), { target: { value: 'commercial' } });
    expect(screen.getByRole('textbox', { name: /License number/ })).toBeTruthy();
  });

  it('decides every conditional field and section of a render in one kernel crossing', async () => {
    const crossings = await countGuardCrossings();
    const sections: FormSection[] = [
      { id: 'extra', title: 'Extra', fields: [{ name: 'extra', label: 'Extra field', type: 'string' }], condition: ['=', '@entity.formValues.kind', 'commercial'] },
    ];
    wrap(
      <Form
        fields={fields}
        sections={sections}
        initialData={{ kind: 'commercial' }}
        conditionalFields={{ license: licenseWhenCommercial, notes: ['not', ['=', '@entity.formValues.kind', 'x']] }}
      />,
    );
    expect(crossings).toHaveBeenCalledTimes(1);
    const guards = JSON.parse(crossings.mock.calls[0][1]);
    expect(guards).toHaveLength(3);
  });

  it('control: a form with no condition never crosses into the kernel', async () => {
    const crossings = await countGuardCrossings();
    wrap(<Form fields={fields} />);
    expect(crossings).not.toHaveBeenCalled();
  });
});

describe('ConditionalWrapper on the kernel evaluator', () => {
  const context = { formValues: { kind: 'commercial' }, globalVariables: { HG: 'DA' } };

  it('renders its children when the condition holds', () => {
    render(
      <ConditionalWrapper condition={['=', '@entity.formValues.kind', 'commercial']} context={context}>
        <span>shown</span>
      </ConditionalWrapper>,
    );
    expect(screen.getByText('shown')).toBeTruthy();
  });

  it('control: renders the fallback when it does not, and the children when no condition is given', () => {
    const { rerender } = render(
      <ConditionalWrapper condition={['=', '@entity.globalVariables.HG', 'NE']} context={context} fallback={<span>fallback</span>}>
        <span>shown</span>
      </ConditionalWrapper>,
    );
    expect(screen.getByText('fallback')).toBeTruthy();
    expect(screen.queryByText('shown')).toBeNull();
    act(() => {
      rerender(
        <ConditionalWrapper context={context}>
          <span>shown</span>
        </ConditionalWrapper>,
      );
    });
    expect(screen.getByText('shown')).toBeTruthy();
  });
});
