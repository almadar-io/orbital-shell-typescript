/**
 * Every numeric field type the language declares (`int`, `i8`…`i64`, `u8`…`u64`, `f32`, `f64`) renders a number box,
 * and an unsigned type cannot go below zero: Project Friday's contracted hours accepted -1.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Form, type SchemaField } from '../Form';
import { EventBusProvider } from '../../../../core';

function input(type: string): HTMLInputElement {
  const fields: SchemaField[] = [{ name: 'n', label: 'N', type }];
  const { container } = render(
    <EventBusProvider debug={false}>
      <Form fields={fields} submitEvent="SAVE" />
    </EventBusProvider>,
  );
  return container.querySelector('input[name="n"]') as HTMLInputElement;
}

describe('Form numeric field types', () => {
  it.each(['int', 'i32', 'i64', 'u32', 'u64', 'f32', 'f64'])('%s renders a number box', (type) => {
    expect(input(type).type).toBe('number');
  });

  it('an unsigned type has a minimum of zero', () => {
    expect(input('u32').min).toBe('0');
  });

  it('control: a signed type has no minimum', () => {
    expect(input('i32').min).toBe('');
  });

  it('an integer type steps by whole numbers; control: a float does not', () => {
    expect(input('u32').step).toBe('1');
    expect(input('f64').step).toBe('');
  });
});
